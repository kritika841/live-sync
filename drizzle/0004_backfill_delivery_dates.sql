UPDATE `orders`
SET `delivered_at` = `updated_at`
WHERE `delivered_at` = ''
  AND UPPER(TRIM(`status`)) IN ('DELIVERED', 'DELIVERED TO CUSTOMER');
