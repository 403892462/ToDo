#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createMetricStore, redactMetricError } from "./lib/metrics.mjs";

function projectJson(root, path) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (isAbsolute(path) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || !target.endsWith(".json")) throw new Error("输入必须是项目内 JSON 文件。");
  return JSON.parse(readFileSync(target, "utf8"));
}

try {
  const root = process.cwd();
  const [command, ...args] = process.argv.slice(2);
  let output;
  if (command === "collect" && args.length === 1) {
    const event = projectJson(root, args[0]);
    output = createMetricStore(root, event.cycleId).collect(event);
  } else if (command === "validate" && args.length === 2) {
    output = createMetricStore(root, args[0]).validate(args[1]);
  } else throw new Error("用法：node scripts/project-metrics.mjs collect <项目内事件.json> | validate <周期编号> <事件编号>");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status === "REJECTED" || output.valid === false) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${redactMetricError(error)}\n`);
  process.exitCode = 1;
}
