UPDATE `orders`
SET `out_for_delivery_at` = COALESCE(
  CASE
    WHEN json_extract(`raw_json`, '$.out_for_delivery_date') GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]*'
    THEN substr(json_extract(`raw_json`, '$.out_for_delivery_date'), 7, 4) || '-' ||
         substr(json_extract(`raw_json`, '$.out_for_delivery_date'), 4, 2) || '-' ||
         substr(json_extract(`raw_json`, '$.out_for_delivery_date'), 1, 2) || 'T' ||
         COALESCE(NULLIF(substr(json_extract(`raw_json`, '$.out_for_delivery_date'), 12, 8), ''), '00:00:00') || '+05:30'
  END,
  CASE WHEN UPPER(TRIM(`status`)) = 'OUT FOR DELIVERY' THEN `updated_at` END,
  ''
)
WHERE `out_for_delivery_at` = '';
