#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { decideRecovery, executeControlledAction } from "./lib/orchestrator-executor.mjs";
import { decideNextAction, loadOrchestratorFacts } from "./lib/project-orchestrator.mjs";
import { createFileActionLog, createFileOrchestratorLock, createRuntimePorts, projectStateSnapshot } from "./lib/orchestrator-runtime.mjs";
import { buildSchedule } from "./lib/work-scheduler.mjs";
import { evaluateDrift } from "./lib/parallel-safety.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  if (["status", "next"].includes(command) && args.length === 0) {
    const facts = loadOrchestratorFacts(root);
    const output = command === "status" ? { ...facts, runtimeState: projectStateSnapshot(root) } : decideNextAction(facts);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (command === "next" && output.status === "BLOCKED") process.exitCode = 2;
    return;
  }
  if (["run", "retry"].includes(command) && args.length === 1) {
    const requestPath = resolve(root, args[0]);
    const rel = relative(root, requestPath);
    if (isAbsolute(args[0]) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || !requestPath.endsWith(".json")) {
      throw new Error("动作请求必须是项目内 JSON 文件。");
    }
    const request = JSON.parse(readFileSync(requestPath, "utf8"));
    const result = await executeControlledAction(request, createRuntimePorts(root, request.cycleId), { allowSafeRetry: command === "retry" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "SUCCEEDED") process.exitCode = 2;
    return;
  }
  if (command === "schedule" && args.length === 1) {
    const schedulePath = resolve(root, args[0]);
    const rel = relative(root, schedulePath);
    if (isAbsolute(args[0]) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || !schedulePath.endsWith(".json")) {
      throw new Error("调度请求必须是项目内 JSON 文件。");
    }
    const output = buildSchedule(JSON.parse(readFileSync(schedulePath, "utf8")));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.status === "BLOCKED") process.exitCode = 2;
    return;
  }
  if (command === "check-drift" && args.length === 1) {
    const driftPath = resolve(root, args[0]);
    const rel = relative(root, driftPath);
    if (isAbsolute(args[0]) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || !driftPath.endsWith(".json")) {
      throw new Error("漂移检查请求必须是项目内 JSON 文件。");
    }
    const output = evaluateDrift(JSON.parse(readFileSync(driftPath, "utf8")));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.status === "STOPPED") process.exitCode = 2;
    return;
  }
  if (command === "recover" && args.length === 2) {
    const [cycleId, key] = args;
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("动作幂等键格式无效。");
    const log = await createFileActionLog(root, cycleId).get(key);
    if (!log) throw new Error("找不到动作日志。");
    const output = { key, lockExists: await createFileOrchestratorLock(root).exists(), ...decideRecovery({ log, currentState: projectStateSnapshot(root) }) };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.decision === "MANUAL_RECOVERY") process.exitCode = 2;
    return;
  }
  fail("用法：node scripts/project-orchestrator.mjs status | next | schedule <项目内请求.json> | check-drift <项目内请求.json> | run <项目内请求.json> | retry <项目内请求.json> | recover <周期编号> <幂等键>");
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
