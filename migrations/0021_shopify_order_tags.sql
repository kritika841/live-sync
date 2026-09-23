CREATE OR REPLACE FUNCTION dashboard_order_tags(payload TEXT) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT COALESCE(array_agg(DISTINCT TRIM(tag_value)) FILTER(WHERE TRIM(tag_value)<>''),'{}'::text[]) FROM jsonb_array_elements(jsonb_build_array(payload::jsonb->'shopify_tags',payload::jsonb->'tags',payload::jsonb->'order_tag',payload::jsonb->'sr_tags')) source(value) CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE to_jsonb(string_to_array(COALESCE(value #>> '{}',''),',')) END) tags(tag_value)
$$;
CREATE OR REPLACE FUNCTION dashboard_shopify_risk(payload TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN NOT (payload::jsonb ? 'shopify_tags') THEN 'unknown' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(payload::jsonb->'shopify_tags')='array' THEN payload::jsonb->'shopify_tags' ELSE to_jsonb(string_to_array(COALESCE(payload::jsonb->>'shopify_tags',''),',')) END) t(tag) WHERE REGEXP_REPLACE(LOWER(TRIM(tag)),'[ _-]+',' ','g') IN ('high','rto prediction high')) THEN 'high' ELSE 'low' END
$$;
SET lock_timeout='5s';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_tags TEXT[] GENERATED ALWAYS AS (dashboard_order_tags(raw_json)) STORED, ADD COLUMN IF NOT EXISTS shopify_risk_level TEXT GENERATED ALWAYS AS (dashboard_shopify_risk(raw_json)) STORED;
CREATE INDEX IF NOT EXISTS idx_orders_shopify_risk_date ON orders(shopify_risk_level,order_date);
CREATE INDEX IF NOT EXISTS idx_orders_tags ON orders USING GIN(order_tags);
