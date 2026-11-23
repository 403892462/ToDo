#!/usr/bin/env node
import { validateRepositoryContract, readRepositoryFiles } from "./lib/traceability.mjs";

try {
  const root = process.cwd();
  const result = validateRepositoryContract(readRepositoryFiles(root), { root });
  process.stdout.write(`契约检查 PASS：${result.requirementCount} 项需求，${result.artifactCount} 个产物，${result.definitionCount} 个稳定定义。\n`);
} catch (error) {
  process.stderr.write(`契约检查 FAIL：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

