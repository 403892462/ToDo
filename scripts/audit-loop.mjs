#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  completeAuditRepair,
  recordReaudit,
  returnAuditFailure,
  startAuditRepair,
} from "./lib/audit-loop.mjs";

const root = process.cwd();
const statePath = resolve(root, ".project/state.md");
const loopPath = resolve(root, ".project/audit-loop.json");
const recoveryPath = resolve(root, ".project/recovery.md");
const lockPath = resolve(root, ".project/lock.md");
const now = () => new Date().toISOString();
const saveJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

try {
  const [command, ...args] = process.argv.slice(2);
  const state = readFileSync(statePath, "utf8");
  if (command === "return-failure") {
    const reportPath = args[0];
    if (!reportPath || existsSync(lockPath)) throw new Error("退回失败需要报告，且不得存在项目锁。")
    const existingLoop = existsSync(loopPath) ? JSON.parse(readFileSync(loopPath, "utf8")) : null;
    if (existingLoop && existingLoop.status !== "REAUDIT_FAILED") throw new Error("已有未完成的审计循环，不能再次退回。")
    const result = returnAuditFailure(
      state,
      readFileSync(resolve(root, reportPath), "utf8"),
      reportPath,
      now(),
      existingLoop,
    );
    writeFileSync(statePath, result.state, "utf8");
    saveJson(loopPath, result.loop);
    writeFileSync(recoveryPath, result.recovery, "utf8");
    process.stdout.write(`审计失败已退回 ${result.loop.returnWorkItem}。\n`);
  } else if (command === "start-fix") {
    const runId = args[0];
    if (!runId || existsSync(lockPath)) throw new Error("启动修复需要运行编号，且不得存在项目锁。")
    const loop = JSON.parse(readFileSync(loopPath, "utf8"));
    const result = startAuditRepair(state, loop, runId, now());
    const runPath = resolve(root, `.project/runs/${runId}.md`);
    mkdirSync(dirname(runPath), { recursive: true });
    writeFileSync(statePath, result.state, "utf8");
    saveJson(loopPath, result.loop);
    writeFileSync(lockPath, `# 项目锁\n\n- 运行编号：${runId}\n- 工作项：${loop.returnWorkItem}\n- 类型：AUDIT_FIX\n- 状态：IN_PROGRESS\n`, "utf8");
    writeFileSync(runPath, `# 审计修复运行 ${runId}\n\n- 工作项：${loop.returnWorkItem}\n- 原审计：${loop.originalAuditId}\n- 状态：IN_PROGRESS\n`, "utf8");
    process.stdout.write(`审计修复运行已启动：${runId}。\n`);
  } else if (command === "complete-fix") {
    const [runId, evidencePath] = args;
    const loop = JSON.parse(readFileSync(loopPath, "utf8"));
    if (runId !== loop.repairRunId || !existsSync(lockPath)) throw new Error("修复运行或项目锁不匹配。")
    const evidence = readFileSync(resolve(root, evidencePath), "utf8");
    const result = completeAuditRepair(state, loop, evidencePath, evidence, now());
    const runPath = resolve(root, `.project/runs/${runId}.md`);
    const run = readFileSync(runPath, "utf8");
    if (!/^- 状态：IN_PROGRESS\s*$/m.test(run)) throw new Error("修复运行记录不是 IN_PROGRESS。")
    const completedRun =
      run.replace(/^- 状态：IN_PROGRESS\s*$/m, "- 状态：DONE") +
      `\n- 验证证据：${evidencePath}\n- 最终结果：PASS\n`;
    writeFileSync(statePath, result.state, "utf8");
    saveJson(loopPath, result.loop);
    writeFileSync(recoveryPath, result.recovery, "utf8");
    writeFileSync(runPath, completedRun, "utf8");
    rmSync(lockPath);
    process.stdout.write(`审计修复已完成，等待独立复验：${runId}。\n`);
  } else if (command === "record-reaudit") {
    const reportPath = args[0];
    const loop = JSON.parse(readFileSync(loopPath, "utf8"));
    const updated = recordReaudit(loop, readFileSync(resolve(root, reportPath), "utf8"), reportPath, now());
    saveJson(loopPath, updated);
    process.stdout.write(`复验已记录：${updated.reaudits.at(-1).auditId} / ${updated.status}。\n`);
  } else {
    throw new Error("用法：audit-loop.mjs return-failure <报告> | start-fix <RUN-ID> | complete-fix <RUN-ID> <证据> | record-reaudit <报告>");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
