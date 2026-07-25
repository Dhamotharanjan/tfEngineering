import type { Narrator, Narration, NarrationRequest } from './port.ts';
import { NARRATION_SYSTEM_PROMPT, buildNarrationUserPayload } from './port.ts';
import { TemplateNarrator } from './template.ts';
import type { ImpactClass } from '../domain/classification.ts';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface HttpAiNarratorOptions {
  /** AI service base URL (e.g. from AI_SERVICE_URL). Empty → always fallback. */
  baseUrl: string;
  /** Path under the AI service. Default: /impact/narrate */
  path?: string;
  fallback?: Narrator;
  fetch?: FetchLike;
  /** Request timeout. Default 8s. */
  timeoutMs?: number;
}

/**
 * Evidence-only HTTP narrator. POSTs system prompt + evidence payload to the AI
 * service. Never invents BREAKING/NON_BREAKING — class is echoed from the request.
 * On missing config / HTTP failure → TemplateNarrator.
 */
export class HttpAiNarrator implements Narrator {
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly fallback: Narrator;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: HttpAiNarratorOptions) {
    this.baseUrl = (opts.baseUrl || '').replace(/\/$/, '');
    this.path = opts.path || '/impact/narrate';
    this.fallback = opts.fallback ?? new TemplateNarrator();
    this.fetchFn = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async narrate(req: NarrationRequest): Promise<Narration> {
    if (!this.baseUrl) {
      return this.fallback.narrate(req);
    }

    const url = `${this.baseUrl}${this.path.startsWith('/') ? this.path : `/${this.path}`}`;
    const payload = {
      system: NARRATION_SYSTEM_PROMPT,
      evidence: buildNarrationUserPayload(req),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        return this.fallback.narrate(req);
      }

      const parsed = (await res.json()) as Record<string, unknown>;
      const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
      const detail = typeof parsed.detail === 'string' ? parsed.detail.trim() : '';
      if (!headline || !detail) {
        return this.fallback.narrate(req);
      }

      return {
        // Class is authoritative from the classifier — always echo; ignore LLM drift.
        class: echoClass(parsed.class, req.class),
        headline,
        detail,
        grounded: true,
        source: 'llm',
      };
    } catch {
      return this.fallback.narrate(req);
    } finally {
      clearTimeout(timer);
    }
  }
}

function echoClass(_raw: unknown, authoritative: ImpactClass): ImpactClass {
  return authoritative;
}

/** Build a Narrator from env: AI_SERVICE_URL / PLATFORM_AI_SERVICE_URL → HTTP, else template. */
export function createNarratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<HttpAiNarratorOptions> = {},
): Narrator {
  const baseUrl =
    overrides.baseUrl ??
    (env.PLATFORM_AI_SERVICE_URL || env.AI_SERVICE_URL || '').trim();
  if (!baseUrl) {
    return overrides.fallback ?? new TemplateNarrator();
  }
  return new HttpAiNarrator({
    baseUrl,
    path: overrides.path,
    fallback: overrides.fallback ?? new TemplateNarrator(),
    fetch: overrides.fetch,
    timeoutMs: overrides.timeoutMs,
  });
}
