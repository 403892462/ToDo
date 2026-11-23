#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { assertStageTransition, parseProjectState } from "./lib/project-contract.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "transition" && args.length === 2) {
    assertStageTransition(args[0], args[1]);
    process.stdout.write(`合法阶段转换：${args[0]} → ${args[1]}\n`);
  } else if (command === "state" && args.length === 1) {
    const parsed = parseProjectState(readFileSync(args[0], "utf8"));
    process.stdout.write(`状态契约通过：${parsed.currentStage}\n`);
  } else {
    fail("用法：node scripts/project-contract.mjs transition <from> <to> | state <path>");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
