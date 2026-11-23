import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  compareHashes,
  evaluateAcceptanceAudit,
  hashProtectedPaths,
  loadIndependentFixtures,
  renderAuditReport,
} from "../scripts/lib/acceptance-audit.mjs";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "acceptance-audit-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "implementation-tests"));
  mkdirSync(join(root, "acceptance", "fixtures"), { recursive: true });
  writeFileSync(join(root, "src", "feature.ts"), "export const value = 1;\n", "utf8");
  writeFileSync(join(root, "implementation-tests", "feature.test.ts"), "implementation test\n", "utf8");
  return root;
}

function manifest() {
  return {
    auditId: "AUDIT-20261111-000001",
    baseline: "v2.0",
    acceptanceIds: ["AC-065", "AC-066", "AC-067"],
    returnWorkItem: "WI-026",
    protectedPaths: ["src", "implementation-tests"],
    checks: {
      coverage: { status: "PASS", evidence: "traceability.json" },
      risk: { status: "PASS", evidence: "solution.md" },
      contract: { status: "PASS", evidence: "contract-check.md" },
      finalVerification: { status: "PASS", evidence: "verify.md" },
    },
    independentFixtures: ["acceptance/fixtures/pass.json"],
    retestConditions: ["修复后重新运行受影响验证", "重新执行独立样例"],
  };
}

function writeFixture(root, name, value) {
  const path = join(root, "acceptance", "fixtures", name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return `acceptance/fixtures/${name}`;
}

describe("独立验收审计", () => {
  it("完整覆盖、独立样例及证据通过时生成 PASS", () => {
    const root = workspace();
    writeFixture(root, "pass.json", {
      fixtureId: "FIXTURE-101",
      source: "INDEPENDENT",
      acceptanceId: "AC-065",
      status: "PASS",
      evidence: "独立验证通过",
    });
    const before = hashProtectedPaths(root, manifest().protectedPaths);
    const fixtures = loadIndependentFixtures(root, manifest().independentFixtures);
    const audit = evaluateAcceptanceAudit(manifest(), fixtures, before, hashProtectedPaths(root, manifest().protectedPaths));
    expect(audit.result).toBe("PASS");
    expect(renderAuditReport(manifest(), fixtures, audit)).toContain("- 审计结果：PASS");
  });

  it("独立样例失败时生成可退回执行的 FAIL", () => {
    const root = workspace();
    writeFixture(root, "pass.json", {
      fixtureId: "FIXTURE-102",
      source: "INDEPENDENT",
      acceptanceId: "AC-066",
      status: "FAIL",
      evidence: "故意失败证据",
    });
    const hashes = hashProtectedPaths(root, manifest().protectedPaths);
    const fixtures = loadIndependentFixtures(root, manifest().independentFixtures);
    const audit = evaluateAcceptanceAudit(manifest(), fixtures, hashes, hashes);
    const report = renderAuditReport(manifest(), fixtures, audit);
    expect(audit.result).toBe("FAIL");
    expect(report).toContain("失败验收项：AC-066");
    expect(report).toContain("退回工作项：WI-026");
    expect(report).toContain("重新执行独立样例");
  });

  it.each(["coverage", "risk", "contract", "finalVerification"])("%s 失败时拒绝交付", (name) => {
    const value = manifest();
    value.checks[name].status = "FAIL";
    const fixtures = [{ fixtureId: "FIXTURE-105", source: "INDEPENDENT", acceptanceId: "AC-065", status: "PASS", evidence: "通过" }];
    const audit = evaluateAcceptanceAudit(value, fixtures, {}, {});
    expect(audit.result).toBe("FAIL");
    expect(audit.failedChecks).toContain(name);
  });

  it("生产实现或实现测试摘要变化时拒绝通过", () => {
    const root = workspace();
    const before = hashProtectedPaths(root, manifest().protectedPaths);
    writeFileSync(join(root, "src", "feature.ts"), "export const value = 2;\n", "utf8");
    writeFileSync(join(root, "implementation-tests", "feature.test.ts"), "modified test\n", "utf8");
    const after = hashProtectedPaths(root, manifest().protectedPaths);
    expect(compareHashes(before, after)).toEqual(["implementation-tests/feature.test.ts", "src/feature.ts"]);
    const fixtures = [{ fixtureId: "FIXTURE-106", source: "INDEPENDENT", acceptanceId: "AC-067", status: "PASS", evidence: "通过" }];
    const audit = evaluateAcceptanceAudit(manifest(), fixtures, before, after);
    expect(audit.result).toBe("FAIL");
    expect(renderAuditReport(manifest(), [], audit)).toContain("摘要：CHANGED");
  });

  it("审计夹具自身错误单独记录为 AUDIT_ERROR", () => {
    const root = workspace();
    const path = writeFixture(root, "defect.json", {
      fixtureId: "FIXTURE-103",
      source: "AUDIT_DEFECT",
      acceptanceId: "AC-067",
      status: "FAIL",
      evidence: "错误夹具",
    });
    expect(() => loadIndependentFixtures(root, [path])).toThrow("审计夹具自身缺陷");
    const malformed = manifest();
    delete malformed.checks.contract;
    const audit = evaluateAcceptanceAudit(malformed, [], {}, {});
    expect(audit.result).toBe("AUDIT_ERROR");
    expect(audit.auditDefects[0]).toContain("contract");
  });

  it("独立样例目录与实现测试目录来源可区分", () => {
    const root = workspace();
    writeFixture(root, "pass.json", {
      fixtureId: "FIXTURE-104",
      source: "INDEPENDENT",
      acceptanceId: "AC-065",
      status: "PASS",
      evidence: "独立来源",
    });
    const fixture = loadIndependentFixtures(root, manifest().independentFixtures)[0];
    expect(fixture.source).toBe("INDEPENDENT");
    expect(manifest().protectedPaths).toContain("implementation-tests");
    expect(manifest().independentFixtures[0]).toMatch(/^acceptance\/fixtures\//);
  });

  it("控制脚本对故意失败夹具返回失败退出码并保留报告", () => {
    const root = workspace();
    const value = manifest();
    value.independentFixtures = [
      writeFixture(root, "fail.json", {
        fixtureId: "FIXTURE-107",
        source: "INDEPENDENT",
        acceptanceId: "AC-066",
        status: "FAIL",
        evidence: "控制脚本故意失败",
      }),
    ];
    writeFileSync(join(root, "manifest.json"), JSON.stringify(value), "utf8");
    const script = resolve("scripts/acceptance-audit.mjs");
    const result = spawnSync(process.execPath, [script, "audit", "manifest.json", ".project/audits/AUDIT-20261111-000001.md"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(readFileSync(join(root, ".project/audits/AUDIT-20261111-000001.md"), "utf8")).toContain("审计结果：FAIL");
  });
});
