#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeChangeImpact, applyChangeImpact, renderImpactReport, saveJson, saveText, validateTraceability } from "./lib/traceability.mjs";

try {
  const [command, specificationPath, matrixPath = ".project/traceability.json", reportPath] = process.argv.slice(2);
  if (!specificationPath || !["analyze", "apply"].includes(command)) throw new Error("用法：node scripts/change-impact.mjs analyze|apply <impact.json> [matrix.json]");
  const resolvedMatrix = resolve(matrixPath);
  const matrix = JSON.parse(readFileSync(resolvedMatrix, "utf8"));
  const specification = JSON.parse(readFileSync(resolve(specificationPath), "utf8"));
  const analysis = analyzeChangeImpact(matrix, specification);
  analysis.artifacts = analysis.affectedArtifactIds.map((id) => matrix.artifacts.find((artifact) => artifact.id === id));
  if (reportPath) saveText(resolve(reportPath), renderImpactReport(analysis));
  if (command === "analyze") {
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    if (analysis.status !== "READY") process.exitCode = 2;
  } else {
    const updated = applyChangeImpact(matrix, analysis);
    validateTraceability(updated, { allowInvalidated: true });
    saveJson(resolvedMatrix, updated);
    process.stdout.write(`已按 ${analysis.changeId} 失效 ${analysis.affectedArtifactIds.length} 个下游产物。\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
