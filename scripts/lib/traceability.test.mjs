import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeChangeImpact,
  applyChangeImpact,
  renderImpactReport,
  validateRepositoryContract,
  validateTraceability,
} from "./traceability.mjs";

function matrix() {
  return {
    schemaVersion: 1,
    baseline: "v2.0",
    requirements: [
      { id: "FR-100", solutions: ["SOL-100"], workItems: ["WI-100"], tests: ["TEST-100"], evidence: ["EVIDENCE-100"] },
    ],
    artifacts: [
      { id: "SOL-100", type: "solution", path: "solution.md", status: "VALID", requirements: ["FR-100"] },
      { id: "WI-100", type: "work-item", path: "plan.md", status: "VALID", requirements: ["FR-100"] },
      { id: "TEST-100", type: "test", path: "test.mjs", status: "VALID", requirements: ["FR-100"] },
      { id: "EVIDENCE-100", type: "evidence", path: "evidence.md", status: "VALID", requirements: ["FR-100"] },
    ],
  };
}

function rootWithArtifacts() {
  const root = mkdtempSync(join(tmpdir(), "traceability-"));
  for (const path of ["solution.md", "plan.md", "test.mjs", "evidence.md"]) writeFileSync(join(root, path), "ok", "utf8");
  return root;
}

describe("双向追踪矩阵", () => {
  it("接受正向与反向链接完整的矩阵", () => {
    expect(validateTraceability(matrix(), { root: rootWithArtifacts(), strict: true })).toEqual({ requirementCount: 1, artifactCount: 4 });
  });

  it.each([
    ["缺失引用", (value) => value.requirements[0].tests.splice(0)],
    ["悬空引用", (value) => value.requirements[0].tests.splice(0, 1, "TEST-404")],
    ["反向缺失", (value) => value.artifacts[0].requirements.splice(0)],
    ["重复编号", (value) => value.artifacts.push({ ...value.artifacts[0] })],
    ["失效引用", (value) => (value.artifacts[0].status = "INVALIDATED")],
  ])("拒绝%s", (_label, mutate) => {
    const value = matrix();
    mutate(value);
    expect(() => validateTraceability(value, { root: rootWithArtifacts() })).toThrow();
  });

  it("实施阶段允许明确的待完成产物，独立验收阶段拒绝", () => {
    const value = matrix();
    value.artifacts[3].status = "PENDING";
    value.artifacts[3].path = "尚未生成.md";
    expect(() => validateTraceability(value, { root: rootWithArtifacts() })).not.toThrow();
    expect(() => validateTraceability(value, { root: rootWithArtifacts(), strict: true })).toThrow("必须为 VALID");
  });
});

describe("需求变更影响", () => {
  it("列出完整下游并应用失效而不影响其他产物", () => {
    const value = matrix();
    const ids = value.artifacts.map((artifact) => artifact.id);
    const analysis = analyzeChangeImpact(value, {
      changeId: "CHG-100",
      requirementIds: ["FR-100"],
      impactComplete: true,
      affectedArtifactIds: ids,
    });
    expect(analysis.status).toBe("READY");
    const updated = applyChangeImpact(value, analysis);
    expect(updated.artifacts.every((artifact) => artifact.status === "INVALIDATED" && artifact.invalidatedBy === "CHG-100")).toBe(true);
  });

  it("影响不完整时保留已知影响并停止推进", () => {
    const analysis = analyzeChangeImpact(matrix(), {
      changeId: "CHG-100",
      requirementIds: ["FR-100"],
      impactComplete: false,
      affectedArtifactIds: ["SOL-100"],
    });
    expect(analysis.status).toBe("NEEDS_CONFIRMATION");
    expect(analysis.affectedArtifactIds).toContain("EVIDENCE-100");
    expect(() => applyChangeImpact(matrix(), analysis)).toThrow("不能应用失效");
  });

  it("生成包含各类受影响对象的中文报告", () => {
    const value = matrix();
    const analysis = analyzeChangeImpact(value, {
      changeId: "CHG-100",
      requirementIds: ["FR-100"],
      impactComplete: true,
      affectedArtifactIds: value.artifacts.map((artifact) => artifact.id),
    });
    analysis.artifacts = value.artifacts;
    expect(renderImpactReport(analysis)).toContain("受影响证据：EVIDENCE-100");
  });
});

describe("统一契约检查", () => {
  function files(value = matrix()) {
    return {
      ".project/state.md": `---\nschema_version: 2\ncurrent_stage: IMPLEMENTATION\nstage_status: IN_PROGRESS\nstages:\n  IMPLEMENTATION: IN_PROGRESS\n---\n`,
      ".project/traceability.json": JSON.stringify(value),
      "docs/requirements.md": "### FR-100 示例\n",
      "docs/acceptance-catalog.md": "## AC-100 示例\n",
      "docs/solution-design-v2.md": "方案",
      "docs/change-log.md": "## CHG-100 示例\n",
      "docs/decision-log.md": "## DEC-100 示例\n",
      "plans/plan-first-release.md": "唯一验证命令：`npm run verify`\n\n## WI-100 示例\n",
    };
  }

  it("对相同有效输入确定性返回 PASS 且不修改文件", () => {
    const root = rootWithArtifacts();
    const input = files();
    const before = JSON.stringify(input);
    expect(validateRepositoryContract(input, { root })).toEqual(validateRepositoryContract(input, { root }));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("指出重复编号、错误验证命令和无法解析产物", () => {
    const root = rootWithArtifacts();
    const duplicate = files();
    duplicate["plans/plan-first-release.md"] += "\n## WI-100 重复\n";
    expect(() => validateRepositoryContract(duplicate, { root })).toThrow("重复");
    const wrongCommand = files();
    wrongCommand["plans/plan-first-release.md"] = wrongCommand["plans/plan-first-release.md"].replace("npm run verify", "npm test");
    expect(() => validateRepositoryContract(wrongCommand, { root })).toThrow("唯一验证命令");
    expect(() => validateRepositoryContract({})).toThrow("必需产物");
  });

  it("忽略 Markdown 注释中的编号示例但拒绝正文重复", () => {
    const root = rootWithArtifacts();
    const input = files();
    input["docs/change-log.md"] += "\n<!--\n## CHG-100 示例模板\n-->\n";
    expect(() => validateRepositoryContract(input, { root })).not.toThrow();
  });
});
