INSERT INTO `sync_reports` (
  `mode`, `source`, `checked`, `new_orders`, `changed_orders`, `unchanged_orders`,
  `discrepancies_total`, `ndr_records`, `ndr_enriched`, `fields_json`, `changes_json`, `created_at`
)
SELECT
  COALESCE(json_extract(`value`, '$.mode'), 'full'),
  'historic reconciliation',
  COALESCE(json_extract(`value`, '$.checked'), 0),
  COALESCE(json_extract(`value`, '$.newOrders'), 0),
  COALESCE(json_extract(`value`, '$.changedOrders'), 0),
  COALESCE(json_extract(`value`, '$.unchangedOrders'), 0),
  COALESCE(json_extract(`value`, '$.discrepanciesTotal'), 0),
  COALESCE(json_extract(`value`, '$.ndrRecords'), 0),
  COALESCE(json_extract(`value`, '$.ndrEnriched'), 0),
  COALESCE(json_extract(`value`, '$.fields'), '{}'),
  COALESCE(json_extract(`value`, '$.changes'), '[]'),
  COALESCE(json_extract(`value`, '$.completedAt'), `updated_at`)
FROM `sync_state`
WHERE `key` = 'last_sync_report_json'
  AND json_valid(`value`)
  AND NOT EXISTS (SELECT 1 FROM `sync_reports`);
