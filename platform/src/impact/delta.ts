import type { FileChange } from '../domain/events.ts';
import type { PinDelta } from '../domain/impact.ts';

// IaC relevance is config-driven at the edges, but the built-in default matches
// the worker (listIaCRel): .tf and .hcl only.
export function isIaCFile(path: string, extensions: string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function hasIaCChange(files: FileChange[] | undefined, extensions: string[]): boolean {
  if (!files || !files.length) return false;
  return files.some((f) => isIaCFile(f.path, extensions));
}

// Extract module source + ref from a source string, e.g.
//   git::https://host/<org>/<module>.git//<sub>?ref=<ref>  -> { source: <...>//<sub>, ref: <ref> }
//   <registry-host>/<org>/<name>/<provider> (with a separate version = "...")
// Mirrors worker extractRef (?ref= / ref=).
export function extractRef(source: string): string | null {
  const q = source.indexOf('?ref=');
  if (q >= 0) return source.slice(q + 5).replace(/"/g, '') || null;
  const r = source.indexOf('ref=');
  if (r >= 0) return source.slice(r + 4) || null;
  return null;
}

export function stripRef(source: string): string {
  const q = source.indexOf('?');
  return q >= 0 ? source.slice(0, q) : source;
}

interface ParsedPin {
  source: string; // ref stripped
  ref: string | null;
  line: number;
}

const SOURCE_RE = /source\s*=\s*"([^"]+)"/g;
const VERSION_RE = /version\s*=\s*"([^"]+)"/;

// Parse pins from HCL-ish content. Deterministic, offline, regex-based.
// (The authoritative parser is the Go worker; this only needs pin deltas.)
export function parsePins(content: string | null | undefined): ParsedPin[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const pins: ParsedPin[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SOURCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SOURCE_RE.exec(line)) !== null) {
      const rawSource = m[1];
      let ref = extractRef(rawSource);
      // Registry-style: version pinned on a nearby line.
      if (ref === null) {
        const vm = VERSION_RE.exec(line) || VERSION_RE.exec(lines[i + 1] ?? '') || VERSION_RE.exec(lines[i - 1] ?? '');
        if (vm) ref = vm[1];
      }
      pins.push({ source: stripRef(rawSource), ref, line: i + 1 });
    }
  }
  return pins;
}

// Compute pin deltas between previous and new content of a changed file.
export function pinDeltasForFile(file: FileChange): PinDelta[] {
  const before = new Map(parsePins(file.previousContent).map((p) => [p.source, p]));
  const after = parsePins(file.newContent);
  const deltas: PinDelta[] = [];
  for (const a of after) {
    const b = before.get(a.source);
    const fromRef = b ? b.ref : null;
    if (fromRef !== a.ref) {
      deltas.push({ moduleSource: a.source, fromRef, toRef: a.ref, file: file.path, line: a.line });
    }
  }
  return deltas;
}

export function pinDeltas(files: FileChange[] | undefined, extensions: string[]): PinDelta[] {
  if (!files) return [];
  const out: PinDelta[] = [];
  for (const f of files) {
    if (!isIaCFile(f.path, extensions)) continue;
    out.push(...pinDeltasForFile(f));
  }
  return out;
}
