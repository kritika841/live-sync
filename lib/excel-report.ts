import { strToU8, zipSync } from "fflate";

export type StoredSyncReport = {
  id: number; mode: string; source: string; checked: number; newOrders: number;
  changedOrders: number; unchangedOrders: number; discrepanciesTotal: number;
  ndrRecords: number; ndrEnriched: number; fields: Record<string, number>;
  changes: Array<{ orderId: number; channelOrderId: string; fields: string[]; statusBefore?: string; statusAfter?: string }>;
  createdAt: string;
};

const xml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] || character);
const columnName = (index: number) => { let value = ""; for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) value = String.fromCharCode(65 + ((number - 1) % 26)) + value; return value; };

type Cell = string | number;
function worksheet(rows: Cell[][], widths: number[], freezeRow = 1) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? 2 : typeof value === "number" ? 3 : 0;
    return typeof value === "number"
      ? `<c r="${ref}" s="${style}"><v>${value}</v></c>`
      : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const lastColumn = columnName(Math.max(0, ...rows.map((row) => row.length - 1)));
  const lastRow = Math.max(1, rows.length);
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

export function buildSyncReportWorkbook(report: StoredSyncReport) {
  const summary: Cell[][] = [
    ["Metric", "Value"], ["Report ID", report.id], ["Completed at", report.createdAt],
    ["Sync mode", report.mode], ["Source", report.source], ["Orders checked", report.checked],
    ["New orders", report.newOrders], ["Orders changed", report.changedOrders],
    ["Orders unchanged", report.unchangedOrders], ["Field discrepancies repaired", report.discrepanciesTotal],
    ["NDR records checked", report.ndrRecords], ["NDR details filled", report.ndrEnriched],
  ];
  const fields: Cell[][] = [["Field", "Discrepancy count"], ...Object.entries(report.fields).sort((left, right) => right[1] - left[1]).map(([field, count]) => [field, count])];
  const changes: Cell[][] = [["Channel order ID", "Shiprocket order ID", "Fields changed", "Status before", "Status after"], ...report.changes.map((change) => [change.channelOrderId || String(change.orderId), change.orderId, change.fields.join(", "), change.statusBefore || "", change.statusAfter || ""])];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Discrepancies by Field" sheetId="2" r:id="rId2"/><sheet name="Affected Orders" sheetId="3" r:id="rId3"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Aptos"/><color rgb="FF1F2937"/></font><font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B4D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheet(summary, [30, 24])),
    "xl/worksheets/sheet2.xml": strToU8(worksheet(fields, [28, 20])),
    "xl/worksheets/sheet3.xml": strToU8(worksheet(changes, [24, 22, 48, 24, 24])),
  };
  return zipSync(files, { level: 6 });
}
