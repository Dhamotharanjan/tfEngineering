import type { ImpactReport } from '../domain/impact.ts';

// Deep-link payload generation. Base URL comes from config/UI, never hardcoded.
// Paths mirror the shapes used in apps (e.g. /impact/:moduleId, slice=lineage).
export interface DeepLinks {
  report: string;
  module: string;
  consumers: Record<string, string>; // consumerRepoId -> lineage deep link
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

function joinBase(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  return `${b}${path}`;
}

export function buildDeepLinks(baseUrl: string, report: ImpactReport): DeepLinks {
  const module = joinBase(baseUrl, `/impact/${enc(report.moduleRepoId)}`);
  const reportLink = joinBase(baseUrl, `/impact/reports/${enc(report.reportId)}`);
  const consumers: Record<string, string> = {};
  for (const c of report.consumers) {
    consumers[c.consumerRepoId] = joinBase(
      baseUrl,
      `/impact/${enc(report.moduleRepoId)}?slice=lineage&repoId=${enc(c.consumerRepoId)}`,
    );
  }
  return { report: reportLink, module, consumers };
}

export function consumerDeepLink(baseUrl: string, moduleRepoId: string, consumerRepoId: string): string {
  return joinBase(baseUrl, `/impact/${enc(moduleRepoId)}?slice=lineage&repoId=${enc(consumerRepoId)}`);
}
