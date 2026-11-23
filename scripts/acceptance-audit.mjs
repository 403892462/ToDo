#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  evaluateAcceptanceAudit,
  hashProtectedPaths,
  loadIndependentFixtures,
  renderAuditReport,
} from "./lib/acceptance-audit.mjs";
import { recordReaudit, validateReauditLink } from "./lib/audit-loop.mjs";

const [command, manifestPath, reportPath] = process.argv.slice(2);
let exitCode = 2;
try {
  if (command !== "audit" || !manifestPath || !reportPath) throw new Error("用法：node scripts/acceptance-audit.mjs audit <manifest.json> <report.md>");
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const loopPath = resolve(root, ".project/audit-loop.json");
  let loop = null;
  if (manifest.previousAuditId || manifest.repairRunId || manifest.repairEvidence) {
    if (!existsSync(loopPath)) throw new Error("复验缺少审计循环记录。")
    loop = JSON.parse(readFileSync(loopPath, "utf8"));
    validateReauditLink(manifest, loop, root);
  }
  const before = hashProtectedPaths(root, manifest.protectedPaths);
  let fixtures = [];
  let loadError = null;
  try {
    fixtures = loadIndependentFixtures(root, manifest.independentFixtures);
  } catch (error) {
    loadError = error;
  }
  const after = hashProtectedPaths(root, manifest.protectedPaths);
  const audit = loadError
    ? { result: "AUDIT_ERROR", failedChecks: [], failedFixtures: [], failedAcceptanceIds: [], changedFiles: [], auditDefects: [loadError.message] }
    : evaluateAcceptanceAudit(manifest, fixtures, before, after);
  const target = resolve(reportPath);
  if (existsSync(target)) throw new Error(`审计报告已存在，禁止覆盖：${reportPath}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderAuditReport(manifest, fixtures, audit), "utf8");
  if (loop) {
    const updatedLoop = recordReaudit(loop, readFileSync(target, "utf8"), reportPath, new Date().toISOString());
    writeFileSync(loopPath, `${JSON.stringify(updatedLoop, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`独立验收结果：${audit.result}；报告：${reportPath}\n`);
  exitCode = audit.result === "PASS" ? 0 : audit.result === "FAIL" ? 1 : 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
process.exitCode = exitCode;
