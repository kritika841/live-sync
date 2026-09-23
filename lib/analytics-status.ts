export const deliveredSql = "UPPER(TRIM(status)) IN ('DELIVERED', 'DELIVERED TO CUSTOMER')";
export const rtoSql = "(UPPER(TRIM(status)) LIKE 'RTO%' OR UPPER(TRIM(status)) LIKE '%RETURN TO ORIGIN%')";
export const ndrSql = "(UPPER(TRIM(status)) IN ('UNDELIVERED', 'NDR', 'NDR PENDING') OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%')";
export const cancelledSql = "UPPER(TRIM(status)) IN ('CANCELED', 'CANCELLED', 'ORDER CANCELED', 'ORDER CANCELLED')";
export const nonShippedSql = `UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING', 'READY TO SHIP', 'AWB ASSIGNED', 'PICKUP SCHEDULED', 'MANIFEST GENERATED', 'OUT FOR PICKUP', 'PICKUP EXCEPTION')`;
export const inTransitSql = `UPPER(TRIM(status)) IN ('SHIPPED', 'IN TRANSIT', 'IN TRANSIT-EN-ROUTE', 'IN TRANSIT-AT DESTINATION HUB', 'REACHED AT DESTINATION HUB', 'REACHED DESTINATION HUB', 'PICKED UP', 'MISROUTED', 'UNTRACEABLE', 'OUT FOR DELIVERY')`;
export const shopifyHighRiskSql = "shopify_risk_level = 'high'";
export const shiprocketHighRiskSql = "rto_risk_level IN ('high', 'very high')";
// Shopify tags are the preferred live signal, while Shiprocket retains older
// risk assessments that are no longer present on the Shopify order. Treat an
// order as high when either source explicitly says high; never infer high risk.
export const highRiskSql = `(${shopifyHighRiskSql} OR ${shiprocketHighRiskSql})`;
export const lowRiskSql = `(NOT ${highRiskSql} AND (shopify_risk_level = 'low' OR rto_risk_level = 'low'))`;
export const closedSql = `(${deliveredSql} OR ${rtoSql} OR ${ndrSql} OR UPPER(TRIM(status)) = 'OUT FOR DELIVERY')`;
export const openPopulationSql = `(${closedSql} OR ${inTransitSql} OR UPPER(TRIM(status)) = 'LOST')`;
export const shippedHistorySql = openPopulationSql;
