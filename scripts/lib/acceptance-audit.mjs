import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const CHECK_NAMES = ["coverage", "risk", "contract", "finalVerification"];

function listFiles(root, inputPath) {
  const absolute = resolve(root, inputPath);
  if (!existsSync(absolute)) throw new Error(`受保护路径不存在：${inputPath}`);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    listFiles(root, relative(root, resolve(absolute, entry.name))),
  );
}

export function hashProtectedPaths(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("审计清单缺少 protectedPaths。")
  const result = {};
  for (const path of paths) {
    for (const file of listFiles(root, path)) {
      const key = relative(root, file).replaceAll("\\", "/");
      result[key] = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

export function compareHashes(before, after) {
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...files].filter((file) => before[file] !== after[file]).sort();
}

export function loadIndependentFixtures(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("审计清单缺少 independentFixtures。")
  return paths.map((path) => {
    const fixture = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    const acceptanceIds = Array.isArray(fixture.acceptanceIds) ? fixture.acceptanceIds : [fixture.acceptanceId];
    if (
      !/^FIXTURE-\d{3}$/.test(fixture.fixtureId ?? "") ||
      acceptanceIds.length === 0 ||
      acceptanceIds.some((id) => !/^AC-\d{3}$/.test(id ?? ""))
    ) {
      throw new Error(`独立夹具编号无法解析：${path}`);
    }
    if (fixture.source !== "INDEPENDENT") throw new Error(`审计夹具自身缺陷：${fixture.fixtureId} 的 source 不是 INDEPENDENT。`);
    if (!["PASS", "FAIL"].includes(fixture.status) || typeof fixture.evidence !== "string" || fixture.evidence.trim() === "") {
      throw new Error(`审计夹具自身缺陷：${fixture.fixtureId} 缺少有效状态或证据。`);
    }
    return { ...fixture, acceptanceIds };
  });
}

function validateManifest(manifest) {
  if (!/^AUDIT-\d{8}-\d{6}$/.test(manifest?.auditId ?? "")) throw new Error("审计清单缺少有效 auditId。")
  if (!/^v\d+\.\d+$/.test(manifest.baseline ?? "")) throw new Error("审计清单缺少有效需求基线。")
  if (!Array.isArray(manifest.acceptanceIds) || manifest.acceptanceIds.length === 0) throw new Error("审计清单缺少 acceptanceIds。")
  if (!/^WI-\d{3}$/.test(manifest.returnWorkItem ?? "")) throw new Error("审计清单缺少退回工作项。")
  for (const name of CHECK_NAMES) {
    const check = manifest.checks?.[name];
    if (!check || !["PASS", "FAIL"].includes(check.status) || typeof check.evidence !== "string" || check.evidence.trim() === "") {
      throw new Error(`审计清单中的 ${name} 检查无效。`);
    }
  }
  if (!Array.isArray(manifest.retestConditions) || manifest.retestConditions.length === 0) throw new Error("审计清单缺少复验条件。")
}

export function evaluateAcceptanceAudit(manifest, fixtures, beforeHashes, afterHashes) {
  try {
    validateManifest(manifest);
    if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error("审计缺少已验证的独立样例。")
    for (const fixture of fixtures) {
      if (fixture.source !== "INDEPENDENT") throw new Error(`审计夹具自身缺陷：${fixture.fixtureId ?? "UNKNOWN"} 不是独立来源。`)
    }
    const changedFiles = compareHashes(beforeHashes, afterHashes);
    const failedChecks = CHECK_NAMES.filter((name) => manifest.checks[name].status !== "PASS");
    const failedFixtures = fixtures.filter((fixture) => fixture.status !== "PASS");
    const failedAcceptanceIds = [...new Set(failedFixtures.flatMap((fixture) => fixture.acceptanceIds ?? [fixture.acceptanceId]))];
    const result = failedChecks.length === 0 && failedFixtures.length === 0 && changedFiles.length === 0 ? "PASS" : "FAIL";
    return { result, failedChecks, failedFixtures, failedAcceptanceIds, changedFiles, auditDefects: [] };
  } catch (error) {
    return {
      result: "AUDIT_ERROR",
      failedChecks: [],
      failedFixtures: [],
      failedAcceptanceIds: [],
      changedFiles: compareHashes(beforeHashes, afterHashes),
      auditDefects: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function show(items) {
  return items.length > 0 ? items.join("、") : "无";
}

export function renderAuditReport(manifest, fixtures, audit) {
  const rows = CHECK_NAMES.map((name) => `| ${name} | ${manifest.checks?.[name]?.status ?? "ERROR"} | ${manifest.checks?.[name]?.evidence ?? "缺失"} |`).join("\n");
  const fixtureRows =
    fixtures
      .map(
        (fixture) =>
          `| ${fixture.fixtureId} | ${(fixture.acceptanceIds ?? [fixture.acceptanceId]).join("、")} | ${fixture.status} | ${fixture.evidence} |`,
      )
      .join("\n") || "| 无 | 无 | ERROR | 独立夹具无法读取 |";
  return `# 独立验收审计报告

- 审计编号：${manifest.auditId ?? "UNKNOWN"}
- 需求基线：${manifest.baseline ?? "UNKNOWN"}
- 审计结果：${audit.result}
- 退回工作项：${manifest.returnWorkItem ?? "UNKNOWN"}

## 审计检查

| 检查项 | 结果 | 证据 |
|---|---|---|
${rows}

## 独立样例

| 样例 | 验收项 | 结果 | 证据 |
|---|---|---|---|
${fixtureRows}

## 失败与复验

- 失败验收项：${show(audit.failedAcceptanceIds)}
- 失败检查：${show(audit.failedChecks)}
- 失败证据：${show(audit.failedFixtures.map((fixture) => fixture.evidence))}
- 复验条件：${show(manifest.retestConditions ?? [])}

## 只读边界

- 生产实现与实现测试摘要：${audit.changedFiles.length === 0 ? "UNCHANGED" : "CHANGED"}
- 违规文件：${show(audit.changedFiles)}

## 审计自身缺陷

- ${show(audit.auditDefects)}
`;
}
