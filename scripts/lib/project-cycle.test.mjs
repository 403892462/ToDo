import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  parseCycleRegistry,
  prepareCycleStart,
  selectBaselineSection,
  selectVersionedGate,
  startCycle,
  transactionalWrite,
} from "./project-cycle.mjs";

const SNAPSHOT_PATHS = [
  ".project/state.md",
  ".project/traceability.json",
  "docs/discovery.md",
  "docs/requirements.md",
  "docs/acceptance-catalog.md",
  "docs/solution-design-v2.md",
  "plans/plan-first-release.md",
  "docs/delivery.md",
];

function completedState(overrides = {}) {
  const values = {
    currentStage: "COMPLETED",
    stageStatus: "COMPLETED",
    baseline: "v2.0",
    activeWorkItem: "null",
    activeRun: "null",
    ...overrides,
  };
  return `---
schema_version: 2
workflow_contract: "phase2-v2"
project_id: PROJECT-TEST
project_name: "测试项目"
project_owner: "dezhi"
current_stage: ${values.currentStage}
stage_status: ${values.stageStatus}
requirements_baseline: "${values.baseline}"
verification_command: "npm run verify"
active_work_item: ${values.activeWorkItem}
active_run: ${values.activeRun}
last_successful_run: "RUN-20261111-000000-WI001"
updated_at: "2026-11-11T00:00:00.000Z"
stages:
  IDEA: COMPLETED
  DISCOVERY: COMPLETED
  REQUIREMENTS: COMPLETED
  SOLUTION_DESIGN: COMPLETED
  PLANNING: COMPLETED
  IMPLEMENTATION: COMPLETED
  VERIFICATION: COMPLETED
  ACCEPTANCE_AUDIT: COMPLETED
  DELIVERY: COMPLETED
  COMPLETED: COMPLETED
---
`;
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function workspace(state = completedState()) {
  const root = mkdtempSync(join(tmpdir(), "todo-cycle-"));
  write(root, ".project/state.md", state);
  for (const path of SNAPSHOT_PATHS.slice(1)) write(root, path, `历史文件：${path}\n`);
  return root;
}

function request(overrides = {}) {
  return {
    version: "v3.0",
    title: "编排与复盘",
    owner: "dezhi",
    reason: "启动下一工程周期",
    ...overrides,
  };
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("项目周期与版本感知读取", () => {
  it("比较稳定版本并拒绝非法格式", () => {
    expect(compareVersions("v3.0", "v2.9")).toBeGreaterThan(0);
    expect(compareVersions("v3.0", "v3.0")).toBe(0);
    expect(() => compareVersions("3.0", "v2.0")).toThrow("版本号");
  });

  it("按版本唯一选择 Gate 和基线段落", () => {
    const gates = `## Gate 1（v2.0）确认\n\n旧\n\n## Gate 1（v3.0）确认\n\n新\n`;
    expect(selectVersionedGate(gates, "Gate 1", "v3.0")).toContain("新");
    const solutions = `# Phase 3\n\n需求基线：Requirements Baseline v3.0\n新\n\n# Phase 2\n\n需求基线：Requirements Baseline v2.0\n旧\n`;
    expect(selectBaselineSection(solutions, "v2.0")).toContain("旧");
    expect(() => selectVersionedGate(`${gates}\n${gates}`, "Gate 1", "v3.0")).toThrow("唯一存在");
  });

  it("启动递增周期并保留历史文件与完成快照", () => {
    const root = workspace();
    const historical = join(root, "docs/delivery.md");
    const before = digest(historical);
    const result = startCycle(root, request(), { now: "2026-11-13T00:00:00.000Z" });
    expect(result).toEqual({ cycleId: "CYCLE-v3.0", previousCycleId: "CYCLE-v2.0" });
    expect(readFileSync(join(root, ".project/state.md"), "utf8")).toMatch(/current_stage: DISCOVERY/);
    expect(digest(historical)).toBe(before);
    const registry = parseCycleRegistry(readFileSync(join(root, ".project/cycles/index.json"), "utf8"));
    expect(registry.activeCycleId).toBe("CYCLE-v3.0");
    expect(registry.cycles.map((cycle) => cycle.status)).toEqual(["COMPLETED", "ACTIVE"]);
    const snapshot = JSON.parse(readFileSync(join(root, ".project/cycles/snapshots/CYCLE-v2.0.json"), "utf8"));
    expect(snapshot.files).toHaveLength(SNAPSHOT_PATHS.length);
    expect(snapshot.files.find((file) => file.path === "docs/delivery.md").sha256).toBe(before);
  });

  it.each([
    ["版本未递增", request({ version: "v2.0" }), completedState(), "新周期版本必须高于"],
    ["存在活动运行", request(), completedState({ activeRun: '"RUN-20261111-000000-WI001"' }), "活动工作项或运行"],
    ["项目未完成", request(), completedState({ currentStage: "DELIVERY", stageStatus: "IN_PROGRESS" }), "只有已完成项目"],
  ])("拒绝%s且不改变原状态", (_name, input, state, message) => {
    const root = workspace(state);
    const before = readFileSync(join(root, ".project/state.md"), "utf8");
    expect(() => startCycle(root, input)).toThrow(message);
    expect(readFileSync(join(root, ".project/state.md"), "utf8")).toBe(before);
    expect(existsSync(join(root, ".project/cycles/index.json"))).toBe(false);
  });

  it("项目锁、未关闭审计循环和快照缺口均阻止启动", () => {
    const locked = workspace();
    write(locked, ".project/lock.md", "locked");
    expect(() => prepareCycleStart(locked, request())).toThrow("项目锁");

    const auditing = workspace();
    write(auditing, ".project/audit-loop.json", JSON.stringify({ status: "AWAITING_FIX" }));
    expect(() => prepareCycleStart(auditing, request())).toThrow("审计修复循环");

    const incomplete = workspace();
    expect(() => prepareCycleStart(incomplete, request(), { snapshotPaths: ["missing.md"] })).toThrow("历史快照缺少文件");
  });

  it("事务提交中途失败时恢复所有原文件", () => {
    const root = mkdtempSync(join(tmpdir(), "todo-cycle-transaction-"));
    write(root, "one.txt", "one-old");
    write(root, "two.txt", "two-old");
    let renameCount = 0;
    const renameFile = (from, to) => {
      renameCount += 1;
      if (renameCount === 4) throw new Error("故障注入");
      renameSync(from, to);
    };
    expect(() =>
      transactionalWrite(
        root,
        [
          { path: "one.txt", content: "one-new" },
          { path: "two.txt", content: "two-new" },
        ],
        { renameFile },
      ),
    ).toThrow("故障注入");
    expect(readFileSync(join(root, "one.txt"), "utf8")).toBe("one-old");
    expect(readFileSync(join(root, "two.txt"), "utf8")).toBe("two-old");
  });

  it("准备阶段不写文件且重复版本被拒绝", () => {
    const root = workspace();
    const stateBefore = readFileSync(join(root, ".project/state.md"), "utf8");
    const prepared = prepareCycleStart(root, request());
    expect(prepared.files).toHaveLength(3);
    expect(readFileSync(join(root, ".project/state.md"), "utf8")).toBe(stateBefore);
    startCycle(root, request());
    expect(() => prepareCycleStart(root, request())).toThrow("只有已完成项目");
  });

  it("拒绝重复周期和悬空活动周期引用", () => {
    expect(() =>
      parseCycleRegistry({
        schemaVersion: 1,
        activeCycleId: "CYCLE-v9.0",
        cycles: [{ cycleId: "CYCLE-v2.0", version: "v2.0" }],
      }),
    ).toThrow("活动周期引用不存在");
  });
});
