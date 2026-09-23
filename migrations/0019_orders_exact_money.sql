-- Monetary aggregation must not use PostgreSQL's single-precision REAL.
-- Run during deployment with a bounded lock timeout; retry if busy.
SET lock_timeout='5s';
ALTER TABLE orders ALTER COLUMN total TYPE NUMERIC(14,2) USING ROUND(total::numeric,2), ALTER COLUMN shipping_cost TYPE NUMERIC(14,2) USING ROUND(shipping_cost::numeric,2);
