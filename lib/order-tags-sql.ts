export const tagRowsSql = `SELECT TRIM(tag_value) AS tag FROM jsonb_array_elements(
    jsonb_build_array(raw_json::jsonb->'shopify_tags', raw_json::jsonb->'tags', raw_json::jsonb->'order_tag', raw_json::jsonb->'sr_tags')
  ) source(value) CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(value)='array' THEN value ELSE to_jsonb(string_to_array(COALESCE(value #>> '{}',''), ',')) END
  ) tags(tag_value)`;
