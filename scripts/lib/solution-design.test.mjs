import { describe, expect, it } from "vitest";
import { assertSolutionGate, assessSolutionDesign } from "./solution-design.mjs";

function approvedSolution({ risk = "LOW", depth = "SIMPLE", riskRows = "" } = {}) {
  return `# 技术方案

状态：APPROVED

需求基线或变更：CHG-011

风险等级：${risk}

设计深度：${depth}

简化理由：仅修改说明文本，不影响运行行为。

## 风险登记

| 风险编号 | 等级 | 影响 | 缓解措施 | 负责人 | 状态 |
|---|---|---|---|---|---|
${riskRows}

## 方案确认

- 状态：APPROVED
- 确认人：dezhi
- 确认时间：2026-11-10
`;
}

describe("solution-design 风险分级", () => {
  it("低风险且有理由时选择简化方案", () => {
    expect(
      assessSolutionDesign({
        changeId: "CHG-011",
        informationComplete: true,
        declaredRisk: "LOW",
        impacts: [],
        simplificationReason: "只调整说明文字",
      }),
    ).toMatchObject({ status: "READY", riskLevel: "LOW", designDepth: "SIMPLE" });
  });

  it.each(["MEDIUM", "HIGH"])("%s 风险选择完整方案", (declaredRisk) => {
    expect(
      assessSolutionDesign({ changeId: "CHG-011", informationComplete: true, declaredRisk, impacts: [] }),
    ).toMatchObject({ status: "READY", designDepth: "FULL" });
  });

  it.each(["data-model", "security", "permissions", "external-system", "irreversible", "public-api", "cross-module"])(
    "%s 影响强制完整方案",
    (impact) => {
      expect(
        assessSolutionDesign({
          changeId: "CHG-011",
          informationComplete: true,
          declaredRisk: "LOW",
          impacts: [impact],
        }),
      ).toMatchObject({ status: "READY", designDepth: "FULL", mandatoryFullImpacts: [impact] });
    },
  );

  it("信息不足时进入待确认而不是默认低风险", () => {
    expect(assessSolutionDesign({ changeId: "CHG-011", informationComplete: false })).toMatchObject({
      status: "NEEDS_CONFIRMATION",
      designDepth: "UNDETERMINED",
    });
  });

  it("低风险简化方案缺少理由时失败", () => {
    expect(() =>
      assessSolutionDesign({ changeId: "CHG-011", informationComplete: true, declaredRisk: "LOW", impacts: [] }),
    ).toThrow("simplificationReason");
  });
});

describe("solution-design 风险门", () => {
  it("允许已确认的简化方案", () => {
    expect(assertSolutionGate(approvedSolution())).toMatchObject({ designDepth: "SIMPLE", riskLevel: "LOW" });
  });

  it("允许已缓解或负责人接受的高风险", () => {
    const rows = "| RISK-101 | HIGH | 影响 | 已缓解 | dezhi | MITIGATED |\n| RISK-102 | HIGH | 影响 | 接受 | dezhi | ACCEPTED |";
    expect(assertSolutionGate(approvedSolution({ risk: "HIGH", depth: "FULL", riskRows: rows })).riskRows).toHaveLength(2);
  });

  it.each(["OPEN", "PENDING", "NEEDS_CONFIRMATION"])("拒绝状态为 %s 的高风险", (status) => {
    const row = `| RISK-101 | HIGH | 影响 | 待处理 | dezhi | ${status} |`;
    expect(() => assertSolutionGate(approvedSolution({ risk: "HIGH", depth: "FULL", riskRows: row }))).toThrow(
      "未关闭或未接受的高风险",
    );
  });

  it("拒绝未批准方案和中风险简化方案", () => {
    expect(() => assertSolutionGate(approvedSolution().replace("状态：APPROVED", "状态：DRAFT"))).toThrow("APPROVED");
    expect(() => assertSolutionGate(approvedSolution({ risk: "MEDIUM" }))).toThrow("必须使用完整方案");
  });
});

