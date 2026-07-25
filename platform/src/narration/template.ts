import type { Narrator, NarrationRequest, Narration } from './port.ts';
import { ImpactClass } from '../domain/classification.ts';

// Deterministic, LLM-free narrator. The system works fully with no LLM
// configured. Output is grounded strictly in the evidence record.
export class TemplateNarrator implements Narrator {
  async narrate(req: NarrationRequest): Promise<Narration> {
    const ev = req.evidence;
    const loc = ev.locations
      .map((l) => (l.line ? `${l.file}:${l.line}` : l.file))
      .join(', ');

    if (req.class === ImpactClass.UNKNOWN) {
      const reason = ev.staleness?.reason ?? 'insufficient_evidence';
      return {
        class: ImpactClass.UNKNOWN,
        headline: `UNKNOWN impact for ${ev.consumerRepoId} on ${ev.moduleId} → ${ev.targetVersion}`,
        detail:
          `Cannot classify (${reason}). Contracts or graph are not trustworthy for this analysis. ` +
          `An async refresh has been requested; re-run after it completes. No guess is made.`,
        grounded: true,
        source: 'template',
      };
    }

    if (req.class === ImpactClass.BREAKING) {
      const reasons = ev.breakingReasons
        .map((r) => `${r.kind.replace(/_/g, ' ')}: ${r.input}`)
        .join('; ');
      return {
        class: ImpactClass.BREAKING,
        headline: `BREAKING for ${ev.consumerRepoId}: ${ev.currentPin ?? 'unpinned'} → ${ev.targetVersion}`,
        detail:
          `${ev.moduleId} interface change breaks this consumer. Evidence: ${reasons}.` +
          (loc ? ` Locations: ${loc}.` : ''),
        grounded: true,
        source: 'template',
      };
    }

    const summary = ev.contractDiff?.summary;
    const optional = summary ? `${summary.added} added, ${summary.changed} changed, ${summary.outputsAdded} outputs added` : 'no interface change';
    return {
      class: ImpactClass.NON_BREAKING,
      headline: `NON_BREAKING for ${ev.consumerRepoId}: ${ev.currentPin ?? 'unpinned'} → ${ev.targetVersion}`,
      detail: `${ev.moduleId} change is compatible with this consumer's provided inputs (${optional}).` + (loc ? ` Locations: ${loc}.` : ''),
      grounded: true,
      source: 'template',
    };
  }
}
