import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function value(markdown, label) {
  const match = markdown.match(new RegExp(`^- ${label}：([^\\r\\n]+)$`, "m"));
  if (!match) throw new Error(`审计报告缺少字段：${label}`);
  return match[1].trim();
}

function replaceState(markdown, name, next) {
  const pattern = new RegExp(`^${name}:\\s*[^\\r\\n]+$`, "m");
  if (!pattern.test(markdown)) throw new Error(`状态缺少字段：${name}`);
  return markdown.replace(pattern, `${name}: ${next}`);
}

function replaceStage(markdown, name, next) {
  const pattern = new RegExp(`^  ${name}:\\s*[A-Z_]+$`, "m");
  if (!pattern.test(markdown)) throw new Error(`状态缺少阶段：${name}`);
  return markdown.replace(pattern, `  ${name}: ${next}`);
}

export function parseAuditReport(markdown) {
  return {
    auditId: value(markdown, "审计编号"),
    baseline: value(markdown, "需求基线"),
    result: value(markdown, "审计结果"),
    returnWorkItem: value(markdown, "退回工作项"),
    readonlySummary: value(markdown, "生产实现与实现测试摘要"),
  };
}

export function returnAuditFailure(state, report, reportPath, timestamp, existingLoop = null) {
  if (!/^current_stage:\s*ACCEPTANCE_AUDIT\s*$/m.test(state)) throw new Error("只有 ACCEPTANCE_AUDIT 阶段可以退回审计失败。")
  const audit = parseAuditReport(report);
  if (audit.result !== "FAIL") throw new Error("只有 FAIL 审计可以退回执行。")
  if (!/^WI-\d{3}$/.test(audit.returnWorkItem)) throw new Error("FAIL 报告缺少有效退回工作项。")
  let updated = replaceState(state, "current_stage", "IMPLEMENTATION");
  updated = replaceState(updated, "active_work_item", `"${audit.returnWorkItem}"`);
  updated = replaceState(updated, "active_run", "null");
  updated = replaceState(updated, "updated_at", `"${timestamp}"`);
  updated = replaceStage(updated, "IMPLEMENTATION", "IN_PROGRESS");
  updated = replaceStage(updated, "ACCEPTANCE_AUDIT", "INVALIDATED");
  updated = replaceStage(updated, "DELIVERY", "INVALIDATED");
  const loop = {
    schemaVersion: 1,
    status: "AWAITING_FIX",
    originalAuditId: audit.auditId,
    originalReport: reportPath,
    returnWorkItem: audit.returnWorkItem,
    readonlyViolation: audit.readonlySummary !== "UNCHANGED",
    repairRunId: null,
    repairEvidence: null,
    reaudits: [],
    cycles: existingLoop
      ? [
          ...(existingLoop.cycles ?? []),
          {
            originalAuditId: existingLoop.originalAuditId,
            originalReport: existingLoop.originalReport,
            repairRunId: existingLoop.repairRunId,
            repairEvidence: existingLoop.repairEvidence,
            reaudits: existingLoop.reaudits,
          },
        ]
      : [],
    returnedAt: timestamp,
  };
  const recovery = `# 恢复记录\n\n- 类型：AUDIT_FIX\n- 原审计：${audit.auditId}\n- 退回工作项：${audit.returnWorkItem}\n- 状态：AWAITING_FIX\n- 恢复入口：node scripts/audit-loop.mjs start-fix <RUN-ID>\n`;
  return { state: updated, loop, recovery };
}

export function startAuditRepair(state, loop, runId, timestamp) {
  if (loop.status !== "AWAITING_FIX") throw new Error("审计循环当前不能启动修复。")
  if (!new RegExp(`^active_work_item:\\s*"${loop.returnWorkItem}"\\s*$`, "m").test(state)) throw new Error("活动工作项与审计退回目标不一致。")
  if (!/^active_run:\s*null\s*$/m.test(state)) throw new Error("已有活动运行。")
  if (!new RegExp(`^RUN-\\d{8}-\\d{6}-${loop.returnWorkItem.replace("-", "")}$$`).test(runId)) throw new Error("修复运行编号与退回工作项不一致。")
  let updated = replaceState(state, "active_run", `"${runId}"`);
  updated = replaceState(updated, "updated_at", `"${timestamp}"`);
  return { state: updated, loop: { ...loop, status: "FIX_IN_PROGRESS", repairRunId: runId, repairStartedAt: timestamp } };
}

export function completeAuditRepair(state, loop, evidencePath, evidence, timestamp) {
  if (loop.status !== "FIX_IN_PROGRESS" || !loop.repairRunId) throw new Error("没有正在执行的审计修复运行。")
  if (!new RegExp(`^active_run:\\s*"${loop.repairRunId}"\\s*$`, "m").test(state)) throw new Error("活动运行与审计修复记录不一致。")
  if (!/^- 最终结果：PASS\s*$/m.test(evidence)) throw new Error("修复证据未通过。")
  if (!/验证|测试|verify|test/i.test(evidence)) throw new Error("修复证据缺少受影响验证记录。")
  let updated = replaceState(state, "current_stage", "ACCEPTANCE_AUDIT");
  updated = replaceState(updated, "active_work_item", "null");
  updated = replaceState(updated, "active_run", "null");
  updated = replaceState(updated, "last_successful_run", `"${loop.repairRunId}"`);
  updated = replaceState(updated, "updated_at", `"${timestamp}"`);
  updated = replaceStage(updated, "IMPLEMENTATION", "COMPLETED");
  updated = replaceStage(updated, "ACCEPTANCE_AUDIT", "IN_PROGRESS");
  return {
    state: updated,
    loop: { ...loop, status: "READY_FOR_REAUDIT", repairEvidence: evidencePath, repairCompletedAt: timestamp },
    recovery: "# 恢复记录\n\n当前没有待恢复执行运行；等待独立复验。\n",
  };
}

export function validateReauditLink(manifest, loop, root) {
  if (!manifest.previousAuditId && !manifest.repairRunId && !manifest.repairEvidence) return;
  if (loop?.status !== "READY_FOR_REAUDIT") throw new Error("审计循环尚未完成执行修复验证。")
  if (manifest.previousAuditId !== loop.originalAuditId) throw new Error("复验未关联原失败审计。")
  if (manifest.repairRunId !== loop.repairRunId || manifest.repairEvidence !== loop.repairEvidence) throw new Error("复验未关联正确的修复运行与证据。")
  for (const path of [loop.originalReport, loop.repairEvidence]) {
    if (!existsSync(resolve(root, path))) throw new Error(`复验关联文件不存在：${path}`);
  }
  const evidence = readFileSync(resolve(root, loop.repairEvidence), "utf8");
  if (!/^- 最终结果：PASS\s*$/m.test(evidence)) throw new Error("复验关联的修复证据未通过。")
}

export function recordReaudit(loop, report, reportPath, timestamp) {
  const audit = parseAuditReport(report);
  if (loop.status !== "READY_FOR_REAUDIT") throw new Error("审计循环当前不能记录复验。")
  if (audit.auditId === loop.originalAuditId || reportPath === loop.originalReport) throw new Error("复验不得覆盖原失败审计。")
  const reaudits = [...loop.reaudits, { auditId: audit.auditId, report: reportPath, result: audit.result, auditedAt: timestamp }];
  return { ...loop, status: audit.result === "PASS" ? "CLOSED" : "REAUDIT_FAILED", reaudits };
}
