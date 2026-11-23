#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCycleRegistry, startCycle } from "./lib/project-cycle.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

try {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  if (command === "start" && args.length === 1) {
    const request = JSON.parse(readFileSync(resolve(args[0]), "utf8"));
    const result = startCycle(root, request);
    process.stdout.write(`新周期已启动：${result.cycleId}；上一周期：${result.previousCycleId}\n`);
  } else if (command === "status" && args.length === 0) {
    const registry = parseCycleRegistry(readFileSync(resolve(root, ".project/cycles/index.json"), "utf8"));
    const active = registry.cycles.find((cycle) => cycle.cycleId === registry.activeCycleId);
    process.stdout.write(`${JSON.stringify({ activeCycleId: registry.activeCycleId, active }, null, 2)}\n`);
  } else {
    fail("用法：node scripts/project-cycle.mjs start <request.json> | status");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
