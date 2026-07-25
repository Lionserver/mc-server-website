export const AUDIT_CSV_MAX_ROWS = 10_000;
export const AUDIT_CSV_BATCH_ROWS = 500;

/**
 * @typedef {{
 *   admin_email: string;
 *   action: string;
 *   target_type: string;
 *   target_id: string;
 *   details: string;
 *   created_at: number;
 * }} AuditCsvRow
 */

/**
 * Build an Excel-compatible UTF-8 CSV without allowing untrusted values to
 * become spreadsheet formulas.
 * @param {AuditCsvRow[]} rows
 */
export function auditRowsToCsv(rows) {
  return `${auditCsvDocumentStart()}${auditRowsToCsvChunk(rows)}`;
}

export function auditCsvDocumentStart() {
  const header = ["생성시각(KST)", "생성시각(UTC)", "관리자", "작업", "대상 유형", "대상 ID", "상세(JSON)"];
  return `\uFEFF${header.map(csvCell).join(",")}\r\n`;
}

/**
 * @param {AuditCsvRow[]} rows
 */
export function auditRowsToCsvChunk(rows) {
  if (rows.length === 0) return "";
  const lines = rows.map((row) => [
      kstTimestamp(row.created_at),
      new Date(row.created_at * 1000).toISOString(),
      row.admin_email,
      row.action,
      row.target_type,
      row.target_id,
      row.details,
    ].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * @param {unknown} value
 */
function csvCell(value) {
  const raw = String(value ?? "").replaceAll("\u0000", "");
  const safe = /^[\u0001-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll("\"", "\"\"")}"`;
}

/**
 * Korea has no daylight-saving transition, so applying the fixed offset keeps
 * export formatting deterministic in Workers and local Node runtimes.
 * @param {number} unixSeconds
 */
function kstTimestamp(unixSeconds) {
  return `${new Date((unixSeconds + 9 * 3600) * 1000).toISOString().slice(0, 19).replace("T", " ")} +09:00`;
}
