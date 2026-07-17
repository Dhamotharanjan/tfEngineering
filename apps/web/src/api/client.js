const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `API ${path}: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) {
        message = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  health: () => fetchJSON('/health'),
  dashboardStats: () => fetchJSON('/dashboard/stats'),
  subscriptions: () => fetchJSON('/subscriptions'),
  syncSubscriptions: () => fetchJSON('/subscriptions/sync', { method: 'POST' }),
  triggerScan: (repoId) => fetchJSON(`/subscriptions/${repoId}/scan`, { method: 'POST' }),
  blastRadius: (moduleId) => fetchJSON(`/blast-radius/${moduleId}`),
  blastRadiusGraph: (moduleId, params = {}) => {
    const qs = new URLSearchParams();
    if (params.slice) qs.set('slice', params.slice);
    if (params.repoId) qs.set('repoId', params.repoId);
    if (params.depth != null) qs.set('depth', String(params.depth));
    const q = qs.toString();
    return fetchJSON(`/blast-radius/${encodeURIComponent(moduleId)}/graph${q ? `?${q}` : ''}`);
  },
  orgGraph: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.include) qs.set('include', params.include);
    const q = qs.toString();
    return fetchJSON(`/graph/org${q ? `?${q}` : ''}`);
  },
  patternsGraph: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.include) qs.set('include', params.include);
    if (params.family) qs.set('family', params.family);
    if (params.patternId) qs.set('patternId', params.patternId);
    const q = qs.toString();
    return fetchJSON(`/graph/patterns${q ? `?${q}` : ''}`);
  },
  patternFamilies: () => fetchJSON('/graph/patterns/families'),
  patternCatalog: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.family) qs.set('family', params.family);
    if (params.patternId) qs.set('patternId', params.patternId);
    const q = qs.toString();
    return fetchJSON(`/graph/patterns/catalog${q ? `?${q}` : ''}`);
  },
  patternDetail: (patternId) => fetchJSON(`/graph/patterns/${encodeURIComponent(patternId)}`),
  patternCoverage: (patternId) =>
    fetchJSON(`/graph/patterns/${encodeURIComponent(patternId)}/coverage`),
  patternGraph: (patternId, params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return fetchJSON(`/graph/patterns/${encodeURIComponent(patternId)}/graph${q ? `?${q}` : ''}`);
  },
  patternArchitecture: (patternId) =>
    fetchJSON(`/graph/patterns/${encodeURIComponent(patternId)}/architecture`),
  stampPattern: (patternId, body) =>
    fetchJSON(`/graph/patterns/${encodeURIComponent(patternId)}/stamp`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applicationGraph: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.appsvn) qs.set('appsvn', params.appsvn);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.include) qs.set('include', params.include);
    const q = qs.toString();
    return fetchJSON(`/graph/application${q ? `?${q}` : ''}`);
  },
  listApps: () => fetchJSON('/graph/apps'),
  updateSubscription: (repoId, body) =>
    fetchJSON(`/subscriptions/${encodeURIComponent(repoId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  repoResources: (repoId) => fetchJSON(`/subscriptions/${repoId}/resources`),
  repoUpstreamLayers: (repoId) => fetchJSON(`/subscriptions/${repoId}/upstream-layers`),
  repoDependencies: (repoId) => fetchJSON(`/subscriptions/${repoId}/dependencies`),
  changePlan: (id) => fetchJSON(`/plans/change${id ? `?id=${id}` : ''}`),
  rolloutPlan: (changePlanId) => fetchJSON(`/plans/rollout${changePlanId ? `?change_plan_id=${changePlanId}` : ''}`),
  rolloutPlans: () => fetchJSON('/plans/rollout/all'),
  jobs: () => fetchJSON('/jobs'),
  eol: () => fetchJSON('/dashboard/eol'),
  audit: () => fetchJSON('/dashboard/audit'),
  triggerImpact: (body) => fetchJSON('/webhooks/impact/trigger', { method: 'POST', body: JSON.stringify(body) }),
  releaseCompareModules: () => fetchJSON('/release-compare/modules'),
  releaseCompareReleases: (moduleId) =>
    fetchJSON(`/release-compare/modules/${encodeURIComponent(moduleId)}/releases`),
  releaseCompare: ({ moduleId, fromVersion, toVersion }) => {
    const qs = new URLSearchParams({
      moduleId,
      from: fromVersion,
      to: toVersion,
    });
    return fetchJSON(`/release-compare/compare?${qs}`);
  },
  raiseReleasePr: (body) =>
    fetchJSON('/release-compare/raise-pr', { method: 'POST', body: JSON.stringify(body) }),
  raiseReleasePrBulk: (body) =>
    fetchJSON('/release-compare/raise-pr/bulk', { method: 'POST', body: JSON.stringify(body) }),
  releasePrRequests: () => fetchJSON('/release-compare/pr-requests'),
  releasePrRequest: (id) => fetchJSON(`/release-compare/pr-requests/${encodeURIComponent(id)}`),
  releaseCompareApprovers: () => fetchJSON('/release-compare/approvers'),
  approveReleasePr: (id, body) =>
    fetchJSON(`/release-compare/pr-requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rejectReleasePr: (id, body) =>
    fetchJSON(`/release-compare/pr-requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  proceedReleasePr: (id) =>
    fetchJSON(`/release-compare/pr-requests/${encodeURIComponent(id)}/proceed`, { method: 'POST' }),
  releasePrChat: (id, body) =>
    fetchJSON(`/release-compare/pr-requests/${encodeURIComponent(id)}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetTestData: () =>
    fetchJSON('/admin/reset-test-data', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'RESET' }),
    }),
};

export function useLiveData(fetcher, fallback) {
  return async function load(setData, setError, setLoading) {
    setLoading?.(true);
    try {
      const data = await fetcher();
      setData(data);
      setError?.(null);
    } catch (e) {
      setError?.(e.message);
      if (fallback) setData(fallback);
    } finally {
      setLoading?.(false);
    }
  };
}
