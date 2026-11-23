#!/usr/bin/env node
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { buildRetrospective, decideSuggestion, writeRetrospectiveOutputs } from "./lib/delivery-retrospective.mjs";

function projectPath(root, value, extension) {
  const path = resolve(root, value); const rel = relative(root, path);
  if (isAbsolute(value) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || !path.endsWith(extension)) throw new Error(`路径必须是项目内 ${extension} 文件。`);
  return path;
}

try {
  const root = process.cwd(); const [command, ...args] = process.argv.slice(2);
  if (command === "render" && args.length === 3) {
    const input = JSON.parse(readFileSync(projectPath(root, args[0], ".json"), "utf8"));
    const result = buildRetrospective(input);
    if (result.status !== "READY") { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = 2; }
    else { writeRetrospectiveOutputs(projectPath(root, args[1], ".json"), projectPath(root, args[2], ".md"), result); process.stdout.write("复盘输出已生成。\n"); }
  } else if (command === "decide" && (args.length === 3 || args.length === 4)) {
    const suggestion = JSON.parse(readFileSync(projectPath(root, args[0], ".json"), "utf8"));
    const decided = decideSuggestion(suggestion, args[1], args.length === 4 ? args[2] : null);
    const output = projectPath(root, args.at(-1), ".json"); const descriptor = openSync(output, "wx");
    try { writeFileSync(descriptor, `${JSON.stringify(decided, null, 2)}\n`, "utf8"); } finally { closeSync(descriptor); }
    process.stdout.write(`${JSON.stringify(decided, null, 2)}\n`);
  } else throw new Error("用法：render <输入.json> <摘要.json> <报告.md> | decide <建议.json> <决定> [变更或周期引用] <输出.json>");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
}
