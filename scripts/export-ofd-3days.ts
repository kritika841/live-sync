import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords, type OfdOrderRecord } from "../lib/ofd";
import { determineDeliveryOutcome, getIndiaTime } from "../lib/ofd-audit";

type Cell = string | number;

const xmlEscape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      }[char] || char)
  );

const columnName = (index: number) => {
  let value = "";
  for (let num = index + 1; num > 0; num = Math.floor((num - 1) / 26)) {
    value = String.fromCharCode(65 + ((num - 1) % 26)) + value;
  }
  return value;
};

function buildWorksheetXml(rows: Cell[][], widths: number[], freezeRow = 1) {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
            const style = rowIndex === 0 ? 2 : typeof value === "number" ? 3 : 0;
            return typeof value === "number"
              ? `<c r="${ref}" s="${style}"><v>${value}</v></c>`
              : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
          })
          .join("")}</row>`
    )
    .join("");

  const lastColumn = columnName(Math.max(0, ...rows.map((row) => row.length - 1)));
  const lastRow = Math.max(1, rows.length);
  const columns = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="1">
      <pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>${columns}</cols>
  <sheetData>${body}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

export function buildMultiSheetWorkbook(
  sheets: Array<{ name: string; rows: Cell[][]; widths: number[] }>
): Uint8Array {
  const contentTypesOverrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  const workbookSheetsXml = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${xmlEscape(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("");

  const workbookRelsXml = [
    ...sheets.map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ),
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join("");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${contentTypesOverrides}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheetsXml}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelsXml}
</Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><name val="Segoe UI"/><color rgb="FF1F2937"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`),
  };

  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      buildWorksheetXml(sheet.rows, sheet.widths)
    );
  });

  return zipSync(files, { level: 6 });
}

function escapeCsv(val: unknown): string {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export async function generateOfdSheets() {
  const runtime = getRuntimeEnv();
  const db = runtime.DB;

  // The past 3 days (plus 4th day to cover both definitions: Oct 11-13 or Oct 10-12)
  const dates = ["2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10"];

  const outDir = path.resolve(process.cwd(), "outputs/ofd-exports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const headers = [
    "Order ID",
    "Channel Order ID",
    "Customer Name",
    "Customer Phone",
    "Customer City",
    "Customer State",
    "Current Status",
    "Delivery Outcome",
    "Attempt Number",
    "Order Total (INR)",
    "Payment Method",
    "Courier",
    "AWB Number",
    "First OFD Time (IST)",
    "Latest OFD Time (IST)",
    "Delivered At (IST)",
    "NDR Reason",
    "NDR Attempts",
    "Products Summary",
    "Product SKUs",
    "Shipped At (IST)",
  ];

  const columnWidths = [
    16, // Order ID
    18, // Channel Order ID
    22, // Customer Name
    16, // Customer Phone
    16, // City
    18, // State
    20, // Current Status
    16, // Outcome
    14, // Attempt Number
    16, // Total
    14, // Payment Method
    20, // Courier
    20, // AWB
    22, // First OFD
    22, // Latest OFD
    22, // Delivered At
    26, // NDR Reason
    14, // NDR Attempts
    45, // Products
    25, // SKUs
    22, // Shipped At
  ];

  const summaryRows: Cell[][] = [
    ["Metric", "2026-10-13 (Today)", "2026-10-12", "2026-10-11", "2026-10-10", "Total / Average"],
  ];

  const daySheets: Array<{ name: string; rows: Cell[][]; widths: number[] }> = [];
  const dayStats: Array<{
    date: string;
    total: number;
    delivered: number;
    stillOfd: number;
    undelivered: number;
    rto: number;
    value: number;
  }> = [];

  for (const date of dates) {
    console.log(`Processing OFD orders for ${date}...`);
    const ofdResult = await loadOfdRecords(db, date);
    const orderRecords: OfdOrderRecord[] = ofdResult.results || [];
    const orderIds = orderRecords.map((r) => r.id);

    // Fetch products_json and raw_json for these orders
    const productsMap = new Map<string, { products_json: string; raw_json: string }>();
    if (orderIds.length > 0) {
      const prods = await db
        .prepare(
          `SELECT id, products_json, raw_json FROM orders WHERE id IN (${orderIds.map(() => "?").join(",")})`
        )
        .bind(...orderIds)
        .all<{ id: number; products_json: string; raw_json: string }>();

      for (const p of prods.results || []) {
        productsMap.set(String(p.id), p);
      }
    }

    let deliveredCount = 0;
    let stillOfdCount = 0;
    let undeliveredCount = 0;
    let rtoCount = 0;
    let totalRevenue = 0;

    const sheetRows: Cell[][] = [headers];
    const csvRows: string[] = [headers.map((h) => escapeCsv(h)).join(",")];

    for (const o of orderRecords) {
      const outcome = determineDeliveryOutcome(o.status, o.deliveredAt, date, o.ndrRaisedAt);
      if (outcome === "delivered") deliveredCount++;
      else if (outcome === "still_ofd") stillOfdCount++;
      else if (outcome === "undelivered") undeliveredCount++;
      else if (outcome === "rto") rtoCount++;

      totalRevenue += Number(o.total || 0);

      const dbData = productsMap.get(String(o.id));
      let productsList: Array<{ name?: string; quantity?: number; sku?: string; channel_sku?: string }> = [];
      try {
        if (dbData?.products_json) {
          productsList = JSON.parse(dbData.products_json);
        }
      } catch {
        productsList = [];
      }

      const productsSummary = productsList
        .map((p) => `${p.name || "Product"} (x${p.quantity || 1})`)
        .join("; ");
      const productSkus = productsList
        .map((p) => p.sku || p.channel_sku || "")
        .filter(Boolean)
        .join(", ");

      let rawPhone = o.customerPhone || "";
      if (!rawPhone && dbData?.raw_json) {
        try {
          const raw = JSON.parse(dbData.raw_json);
          rawPhone = raw.customer_phone || raw.billing_phone || "";
        } catch {
          // ignore
        }
      }

      const rowValues: Cell[] = [
        String(o.id),
        o.channelOrderId || String(o.id),
        o.customerName || "—",
        rawPhone || "—",
        o.customerCity || "—",
        o.customerState || "—",
        o.status || "OUT FOR DELIVERY",
        outcome.toUpperCase(),
        Number(o.attemptNumber || 1),
        Number(o.total || 0),
        (o.paymentMethod || "COD").toUpperCase(),
        o.courier || "—",
        o.awb || "—",
        getIndiaTime(o.firstOutForDeliveryAt) || "—",
        getIndiaTime(o.outForDeliveryAt) || "—",
        getIndiaTime(o.deliveredAt) || "—",
        o.ndrReason || "—",
        Number(o.ndrAttempts || 0),
        productsSummary || "—",
        productSkus || "—",
        getIndiaTime(o.shippedAt) || "—",
      ];

      sheetRows.push(rowValues);
      csvRows.push(rowValues.map((v) => escapeCsv(v)).join(","));
    }

    dayStats.push({
      date,
      total: orderRecords.length,
      delivered: deliveredCount,
      stillOfd: stillOfdCount,
      undelivered: undeliveredCount,
      rto: rtoCount,
      value: totalRevenue,
    });

    const dayName = date === "2026-10-13" ? `${date} (Today)` : date;
    daySheets.push({
      name: dayName,
      rows: sheetRows,
      widths: columnWidths,
    });

    // Write individual CSV file for this day
    const csvPath = path.join(outDir, `ofd_orders_${date}.csv`);
    fs.writeFileSync(csvPath, csvRows.join("\n"), "utf-8");
    console.log(`Saved CSV: ${csvPath} (${orderRecords.length} orders)`);
  }

  // Populate summary sheet
  const grandTotal = dayStats.reduce((acc, s) => acc + s.total, 0);
  const grandDelivered = dayStats.reduce((acc, s) => acc + s.delivered, 0);
  const grandStillOfd = dayStats.reduce((acc, s) => acc + s.stillOfd, 0);
  const grandUndelivered = dayStats.reduce((acc, s) => acc + s.undelivered, 0);
  const grandRto = dayStats.reduce((acc, s) => acc + s.rto, 0);
  const grandValue = dayStats.reduce((acc, s) => acc + s.value, 0);

  summaryRows.push(
    ["Total OFD Orders", ...dayStats.map((s) => s.total), grandTotal],
    ["Delivered Successfully", ...dayStats.map((s) => s.delivered), grandDelivered],
    ["Still Out for Delivery", ...dayStats.map((s) => s.stillOfd), grandStillOfd],
    ["Undelivered / NDR", ...dayStats.map((s) => s.undelivered), grandUndelivered],
    ["RTO (Returned to Origin)", ...dayStats.map((s) => s.rto), grandRto],
    [
      "Delivery Success Rate %",
      ...dayStats.map((s) => (s.total ? Number(((s.delivered / s.total) * 100).toFixed(1)) : 0)),
      Number(((grandDelivered / grandTotal) * 100).toFixed(1)),
    ],
    ["Total Order Value (INR)", ...dayStats.map((s) => Number(s.value.toFixed(2))), Number(grandValue.toFixed(2))]
  );

  const allSheets = [
    {
      name: "Summary",
      rows: summaryRows,
      widths: [28, 22, 18, 18, 18, 22],
    },
    ...daySheets,
  ];

  // Build combined Excel workbook
  const workbookBytes = buildMultiSheetWorkbook(allSheets);
  const excelPath = path.join(outDir, "ofd_orders_past_3_days.xlsx");
  fs.writeFileSync(excelPath, workbookBytes);
  console.log(`Saved Multi-Sheet Excel Workbook: ${excelPath}`);

  // Also write summary CSV
  const summaryCsv = summaryRows.map((r) => r.map((c) => escapeCsv(c)).join(",")).join("\n");
  fs.writeFileSync(path.join(outDir, "ofd_summary_past_3_days.csv"), summaryCsv, "utf-8");

  return {
    excelPath,
    dayStats,
    grandTotal,
    grandValue,
  };
}

if (process.argv[1] && process.argv[1].endsWith("export-ofd-3days.ts")) {
  generateOfdSheets()
    .then((res) => {
      console.log("\nExport completed successfully!");
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Export error:", err);
      process.exit(1);
    });
}
