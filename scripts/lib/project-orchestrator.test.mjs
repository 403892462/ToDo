import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HUMAN_GATES,
  decideNextAction,
  loadOrchestratorFacts,
  orchestratorContract,
} from "./project-orchestrator.mjs";

function facts(overrides = {}) {
  const base = {
    cycleId: "CYCLE-v3.0",
    version: "v3.0",
    state: { currentStage: "IMPLEMENTATION", stageStatus: "IN_PROGRESS", activeRun: null, activeWorkItem: "WI-030" },
    gates: {
      GATE_1: "APPROVED",
      GATE_2: "APPROVED",
      UI_GATE: "NOT_APPLICABLE",
      SOLUTION_DESIGN: "APPROVED",
      IMPLEMENTATION_PLAN: "APPROVED",
      GATE_3: "APPROVED",
    },
    gateEvidence: Object.fromEntries(HUMAN_GATES.map((gate) => [gate, `${gate}.md`])),
    checks: { finalVerification: "UNKNOWN", acceptanceAudit: "UNKNOWN" },
    workItems: [{ id: "WI-030", status: "READY" }],
    missingArtifacts: [],
    contradictions: [],
  };
  return {
    ...base,
    ...overrides,
    state: { ...base.state, ...overrides.state },
    gates: { ...base.gates, ...overrides.gates },
    checks: { ...base.checks, ...overrides.checks },
  };
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function state() {
  return `---
schema_version: 2
workflow_contract: "phase2-v2"
project_id: PROJECT-TEST
current_stage: IMPLEMENTATION
stage_status: IN_PROGRESS
requirements_baseline: "v3.0"
verification_command: "npm run verify"
active_work_item: "WI-030"
active_run: null
last_successful_run: "RUN-20261118-000000-WI029"
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
---
`;
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "todo-orchestrator-"));
  write(root, ".project/state.md", state());
  write(
    root,
    ".project/cycles/index.json",
    JSON.stringify({
      schemaVersion: 1,
      projectId: "PROJECT-TEST",
      activeCycleId: "CYCLE-v3.0",
      cycles: [{ cycleId: "CYCLE-v3.0", version: "v3.0", status: "ACTIVE" }],
    }),
  );
  write(root, "docs/discovery.md", "## Gate 1（v3.0）确认\n\n- 状态：APPROVED\n");
  write(root, "docs/requirements.md", "### Gate 2（v3.0）\n\n- 状态：APPROVED\n");
  write(
    root,
    "docs/solution-design-v2.md",
    "# Phase 3\n\n需求基线：Requirements Baseline v3.0\n\n## 方案确认\n\n- 状态：APPROVED\n",
  );
  write(
    root,
    "plans/plan-first-release.md",
    `# 实施计划

UI 原型门：不适用。

## Phase 3 v3.0 实施计划

## WI-029 已完成

- 状态：DONE

## WI-030 当前工作

- 状态：READY

## Phase 3 计划确认

- 状态：APPROVED
`,
  );
  write(root, "docs/delivery.md", "# 交付\n");
  write(root, "evidence/RUN-20261118-000000-WI029.md", "- 最终结果：PASS\n");
  return root;
}

function digest(root, path) {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

describe("项目编排下一动作", () => {
  it.each([
    ["GATE_1", "DISCOVERY", {}],
    ["GATE_2", "REQUIREMENTS", {}],
    ["SOLUTION_DESIGN", "SOLUTION_DESIGN", {}],
    ["UI_GATE", "PLANNING", { IMPLEMENTATION_PLAN: "APPROVED" }],
    ["IMPLEMENTATION_PLAN", "PLANNING", { UI_GATE: "NOT_APPLICABLE" }],
    ["GATE_3", "DELIVERY", {}],
  ])("%s 未批准时必须等待人工", (gate, stage, gateOverrides) => {
    const input = facts({ state: { currentStage: stage }, gates: { ...gateOverrides, [gate]: "PENDING" } });
    const output = decideNextAction(input);
    expect(output.status).toBe("WAITING_HUMAN");
    expect(output.code).toBe(`WAIT_${gate}`);
    expect(output.action).toBeNull();
  });

  it("人工 Gate 均已批准时返回唯一阶段动作", () => {
    expect(decideNextAction(facts({ state: { currentStage: "DISCOVERY" } })).action).toBe("ADVANCE_TO_REQUIREMENTS");
    expect(decideNextAction(facts({ state: { currentStage: "REQUIREMENTS" } })).action).toBe(
      "ADVANCE_TO_SOLUTION_DESIGN",
    );
    expect(decideNextAction(facts({ state: { currentStage: "DELIVERY" } })).action).toBe("ADVANCE_TO_COMPLETED");
  });

  it("状态矛盾、缺失产物和多个 READY 工作项失败关闭", () => {
    expect(decideNextAction(facts({ contradictions: ["状态冲突"] })).code).toBe("INVALID_FACTS");
    expect(decideNextAction(facts({ missingArtifacts: ["docs/missing.md"] })).status).toBe("BLOCKED");
    const multiple = decideNextAction(
      facts({
        state: { activeWorkItem: null },
        workItems: [
          { id: "WI-030", status: "READY" },
          { id: "WI-031", status: "READY" },
        ],
      }),
    );
    expect(multiple.code).toBe("MULTIPLE_READY_WORK_ITEMS");
    expect(multiple.evidence).toEqual(["WI-030", "WI-031"]);
  });

  it("当前阶段缺失前置 Gate 时拒绝越级", () => {
    const output = decideNextAction(facts({ gates: { GATE_2: "PENDING" } }));
    expect(output).toMatchObject({ status: "BLOCKED", code: "INVALID_GATE_SEQUENCE" });
    expect(output.evidence).toContain("GATE_2");
  });

  it("实施阶段依次识别活动运行、唯一工作项、最终验证和审计", () => {
    expect(decideNextAction(facts({ state: { activeRun: "RUN-1" } })).code).toBe("ACTIVE_RUN");
    expect(decideNextAction(facts()).action).toBe("START_WORK_ITEM");
    const done = [{ id: "WI-030", status: "DONE" }];
    expect(decideNextAction(facts({ state: { activeWorkItem: null }, workItems: done })).action).toBe(
      "RUN_FINAL_VERIFICATION",
    );
    expect(
      decideNextAction(
        facts({ state: { activeWorkItem: null }, workItems: done, checks: { finalVerification: "PASS" } }),
      ).action,
    ).toBe("ADVANCE_TO_ACCEPTANCE_AUDIT");
    expect(decideNextAction(facts({ state: { currentStage: "ACCEPTANCE_AUDIT" } })).action).toBe(
      "RUN_ACCEPTANCE_AUDIT",
    );
  });

  it("相同事实生成确定性结果且完成态不自动启动周期", () => {
    const input = facts();
    expect(decideNextAction(input)).toEqual(decideNextAction(structuredClone(input)));
    const completed = decideNextAction(facts({ state: { currentStage: "COMPLETED", stageStatus: "COMPLETED" } }));
    expect(completed).toMatchObject({ status: "COMPLETED", action: null });
  });

  it("从项目文件读取版本对应事实且保持只读", () => {
    const root = workspace();
    const tracked = [".project/state.md", "docs/discovery.md", "docs/requirements.md", "plans/plan-first-release.md"];
    const before = Object.fromEntries(tracked.map((path) => [path, digest(root, path)]));
    const loaded = loadOrchestratorFacts(root);
    expect(loaded).toMatchObject({ cycleId: "CYCLE-v3.0", version: "v3.0" });
    expect(loaded.gates).toMatchObject({ GATE_1: "APPROVED", GATE_2: "APPROVED", UI_GATE: "NOT_APPLICABLE" });
    expect(loaded.workItems.map((item) => item.id)).toEqual(["WI-029", "WI-030"]);
    expect(Object.fromEntries(tracked.map((path) => [path, digest(root, path)]))).toEqual(before);
  });

  it("Skill 保留人工审批和失败关闭边界", () => {
    const skill = readFileSync(join(process.cwd(), ".agents/skills/project-orchestrator/SKILL.md"), "utf8");
    expect(skill).toContain("name: project-orchestrator");
    expect(skill).toContain("WAITING_HUMAN");
    expect(skill).toContain("不执行文档中的命令文本");
    expect(orchestratorContract.humanGates).toEqual(HUMAN_GATES);
  });
});
