import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_CSV_MAX_ROWS, auditRowsToCsv } from "../lib/admin-audit-csv.mjs";

test("admin audit CSV is BOM-prefixed, RFC 4180 quoted, and KST-labelled", () => {
  const csv = auditRowsToCsv([{
    admin_email: "admin@example.com",
    action: "server.updated",
    target_type: "server",
    target_id: "abc",
    details: "첫째 줄\n둘째 줄, \"인용\"",
    created_at: 0,
  }]);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /^﻿"생성시각\(KST\)"/);
  assert.match(csv, /"1970-01-01 09:00:00 \+09:00"/);
  assert.match(csv, /""인용""/);
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(AUDIT_CSV_MAX_ROWS, 10_000);
});

test("admin audit CSV neutralizes spreadsheet formula prefixes", () => {
  const csv = auditRowsToCsv([{
    admin_email: "=HYPERLINK(\"https://example.invalid\")",
    action: "+cmd",
    target_type: "-1+1",
    target_id: "\t@SUM(1,1)",
    details: "@malicious",
    created_at: 1,
  }]);

  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\+cmd"/);
  assert.match(csv, /"'-1\+1"/);
  assert.match(csv, /"'\t@SUM/);
  assert.match(csv, /"'@malicious"/);
});
