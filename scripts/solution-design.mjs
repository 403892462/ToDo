#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { assertSolutionGate, assessSolutionDesign } from "./lib/solution-design.mjs";

function fail(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

try {
  const [command, path] = process.argv.slice(2);
  if (!path || !["assess", "gate"].includes(command)) {
    throw new Error("用法：node scripts/solution-design.mjs assess <assessment.json> | gate <solution.md>");
  }
  const content = readFileSync(path, "utf8");
  if (command === "assess") {
    process.stdout.write(`${JSON.stringify(assessSolutionDesign(JSON.parse(content)), null, 2)}\n`);
  } else {
    const result = assertSolutionGate(content);
    process.stdout.write(`方案门通过：${result.designDepth} / ${result.riskLevel}\n`);
  }
} catch (error) {
  fail(error);
}

