import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, moduleSub, consumerSub, contract, pinBumpFile, FAKE } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import { CheckVerdict } from '../domain/classification.ts';
import { applyOverride } from '../app/override.ts';
import { buildDeepLinks } from '../app/deep-link.ts';

async function breakingReport(h: ReturnType<typeof makeHarness>) {
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }, { name: 'new_required' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'main.tf', line: 2 }] },
  ]);
  return h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });
}

// Scenario 9: overriding a failing check is audited (actor, reason, timestamp, target).
test('scenario 9: override of a BLOCK verdict is audited', async () => {
  const h = makeHarness();
  const report = await breakingReport(h);
  assert.equal(report.verdict, CheckVerdict.BLOCK);

  const overridden = await applyOverride(
    report,
    { actor: 'example-approver', reason: 'accepted risk for example maintenance window' },
    { audit: h.audit, reports: h.reports },
  );

  assert.equal(overridden.verdict, CheckVerdict.WARN);
  assert.equal(overridden.override?.actor, 'example-approver');
  assert.equal(overridden.override?.previousVerdict, CheckVerdict.BLOCK);
  assert.ok(overridden.override?.at);

  const entries = await h.audit.list();
  const entry = entries.find((e) => e.action === 'impact check override');
  assert.ok(entry);
  assert.equal(entry.actor, 'example-approver');
  assert.equal(entry.target, report.reportId);
  assert.ok(entry.reason && entry.at);
});

test('override refuses non-blocking verdicts and requires actor + reason', async () => {
  const h = makeHarness();
  const report = await breakingReport(h);
  await assert.rejects(() => applyOverride(report, { actor: '', reason: 'x' }, { audit: h.audit, reports: h.reports }));
  const passing = { ...report, verdict: CheckVerdict.PASS };
  await assert.rejects(() => applyOverride(passing, { actor: 'a', reason: 'b' }, { audit: h.audit, reports: h.reports }));
});

// Scenario 10: deep-link payload generation from a report.
test('scenario 10: deep links are generated from config base URL', async () => {
  const h = makeHarness({ deepLinkBaseUrl: 'https://infragraph.example.invalid/' });
  const report = await breakingReport(h);

  const links = buildDeepLinks(h.config.deepLinkBaseUrl, report);
  assert.equal(links.report, `https://infragraph.example.invalid/impact/reports/${encodeURIComponent(report.reportId)}`);
  assert.equal(links.module, `https://infragraph.example.invalid/impact/${encodeURIComponent(FAKE.moduleId)}`);
  const consumerLink = links.consumers[FAKE.consumerId];
  assert.ok(consumerLink.includes('slice=lineage'));
  assert.ok(consumerLink.includes(`repoId=${encodeURIComponent(FAKE.consumerId)}`));

  // Notifications carry deep links too.
  const authorNote = h.notifier.sent.find((n) => n.role === 'pr_author');
  assert.ok(authorNote?.deepLink.startsWith('https://infragraph.example.invalid/'));
});
