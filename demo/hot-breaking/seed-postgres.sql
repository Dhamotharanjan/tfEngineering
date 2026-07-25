-- HOT breaking-impact demo seed (subscriptions + contracts). Safe to re-run.
UPDATE subscriptions
SET subscribed = true,
    role = 'module_source',
    last_scanned_sha = COALESCE(NULLIF(last_scanned_sha, ''), 'demo-indexed-sha-001'),
    indexed_at = COALESCE(indexed_at, now()),
    contacts = COALESCE(contacts, '{}'::jsonb) || '{"owners":"@Dhamotharanjan","primary_team":"@Dhamotharanjan"}'::jsonb,
    updated_at = now()
WHERE id = 'dhamotharanjan-tfengineering';

UPDATE subscriptions
SET last_event_sha = last_scanned_sha
WHERE id = 'dhamotharanjan-tfengineering';

INSERT INTO subscriptions (
  id, github_full_name, role, subscribed, module_sources_watched, contacts
) VALUES
(
  'demo-consumer-payments',
  'Dhamotharanjan/demo-consumer-payments',
  'downstream_consumer',
  true,
  '["Dhamotharanjan/tfEngineering"]'::jsonb,
  '{"owners":"@Dhamotharanjan","primary_team":"payments-platform"}'::jsonb
),
(
  'demo-consumer-checkout',
  'Dhamotharanjan/demo-consumer-checkout',
  'downstream_consumer',
  true,
  '["Dhamotharanjan/tfEngineering"]'::jsonb,
  '{"owners":"@Dhamotharanjan","oncall":"checkout-oncall"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  subscribed = EXCLUDED.subscribed,
  role = EXCLUDED.role,
  module_sources_watched = EXCLUDED.module_sources_watched,
  contacts = EXCLUDED.contacts,
  updated_at = now();

INSERT INTO module_release_contracts (id, module_id, module_source, version, variables, outputs, source_kind)
VALUES
(
  'dhamotharanjan-tfengineering@demo-v1',
  'dhamotharanjan-tfengineering',
  'git::https://github.com/Dhamotharanjan/tfEngineering.git//modules/hot-demo',
  'demo-v1',
  '[{"name":"old_param","type":"string"},{"name":"required_a","type":"string"}]'::jsonb,
  '[{"name":"id"}]'::jsonb,
  'platform'
),
(
  'dhamotharanjan-tfengineering@demo-v2',
  'dhamotharanjan-tfengineering',
  'git::https://github.com/Dhamotharanjan/tfEngineering.git//modules/hot-demo',
  'demo-v2',
  '[{"name":"required_a","type":"string"},{"name":"new_required","type":"string"}]'::jsonb,
  '[{"name":"id"}]'::jsonb,
  'platform'
)
ON CONFLICT (module_id, version) DO UPDATE SET
  variables = EXCLUDED.variables,
  outputs = EXCLUDED.outputs,
  module_source = EXCLUDED.module_source;

SELECT id, role, subscribed,
       left(COALESCE(last_scanned_sha,''), 24) AS indexed,
       left(COALESCE(last_event_sha,''), 24) AS event
FROM subscriptions
WHERE id IN ('dhamotharanjan-tfengineering','demo-consumer-payments','demo-consumer-checkout');

SELECT module_id, version, jsonb_array_length(variables) AS vars
FROM module_release_contracts
WHERE module_id = 'dhamotharanjan-tfengineering' AND version IN ('demo-v1','demo-v2');
