import { describe, expect, it } from "vitest";
import {
  assertRequiredArtifacts,
  assertStageTransition,
  parseProjectState,
  phase2Contract,
} from "./project-contract.mjs";

function state(overrides = "") {
  return `---
schema_version: 2
workflow_contract: "phase2-v2"
current_stage: IMPLEMENTATION
stage_status: IN_PROGRESS
stages:
  IDEA: COMPLETED
  DISCOVERY: COMPLETED
  REQUIREMENTS: COMPLETED
  SOLUTION_DESIGN: COMPLETED
  PLANNING: COMPLETED
  IMPLEMENTATION: IN_PROGRESS
  ACCEPTANCE_AUDIT: INVALIDATED
  DELIVERY: INVALIDATED
  COMPLETED: INVALIDATED
${overrides}---
`;
}

describe("Phase 2 项目契约", () => {
  it("定义包含方案和独立审计的阶段顺序", () => {
    expect(phase2Contract.stages).toEqual([
      "IDEA",
      "DISCOVERY",
      "REQUIREMENTS",
      "SOLUTION_DESIGN",
      "PLANNING",
      "IMPLEMENTATION",
      "ACCEPTANCE_AUDIT",
      "DELIVERY",
      "COMPLETED",
    ]);
  });

  it.each([
    ["REQUIREMENTS", "SOLUTION_DESIGN"],
    ["SOLUTION_DESIGN", "PLANNING"],
    ["IMPLEMENTATION", "ACCEPTANCE_AUDIT"],
    ["ACCEPTANCE_AUDIT", "DELIVERY"],
    ["ACCEPTANCE_AUDIT", "IMPLEMENTATION"],
  ])("允许合法转换 %s → %s", (from, to) => {
    expect(() => assertStageTransition(from, to)).not.toThrow();
  });

  it.each([
    ["REQUIREMENTS", "PLANNING"],
    ["IMPLEMENTATION", "DELIVERY"],
    ["PLANNING", "DELIVERY"],
  ])("拒绝跳过必需阶段 %s → %s", (from, to) => {
    expect(() => assertStageTransition(from, to)).toThrow("非法阶段转换");
  });

  it("解析 Phase 2 状态并保留 Phase 1 历史阶段兼容性", () => {
    const parsed = parseProjectState(state("  VERIFICATION: INVALIDATED\n"));
    expect(parsed.workflowContract).toBe("phase2-v2");
    expect(parsed.stages.VERIFICATION).toBe("INVALIDATED");
  });

  it("遇到未知阶段或未知状态时失败关闭", () => {
    expect(() => parseProjectState(state("  UNKNOWN: PENDING\n"))).toThrow("未知阶段");
    expect(() => parseProjectState(state().replace("IMPLEMENTATION: IN_PROGRESS", "IMPLEMENTATION: MAYBE"))).toThrow(
      "未知状态",
    );
  });

  it("缺少必需产物时失败关闭", () => {
    expect(() =>
      assertRequiredArtifacts({
        ".project/state.md": state(),
        "docs/discovery.md": "ok",
      }),
    ).toThrow("缺少或无法解析必需产物");
  });
});

