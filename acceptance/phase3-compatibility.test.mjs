import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRetrospective } from "../scripts/lib/delivery-retrospective.mjs";
import { validateMetricEvent } from "../scripts/lib/metrics.mjs";
import { decideNextAction } from "../scripts/lib/project-orchestrator.mjs";
import { buildSchedule } from "../scripts/lib/work-scheduler.mjs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("Phase 3 跨模块兼容与独立验收准备", () => {
  it("v2 自举摘要可验证且不伪造自动迁移历史", () => {
    const snapshot = json(".project/cycles/snapshots/CYCLE-v2.0.json");
    const migration = json(".project/cycles/CYCLE-v3.0/bootstrap-migration.json");
    const registry = json(".project/cycles/index.json");
    expect(snapshot.snapshotType).toBe("BOOTSTRAP_COMPATIBILITY_SUMMARY");
    expect(snapshot.note).toContain("不伪造");
    for (const file of snapshot.files) expect(digest(file.path), file.path).toBe(file.sha256);
    expect(migration).toMatchObject({
      originalStartMode: "MANUAL_APPROVED_BOOTSTRAP",
      riskId: "RISK-013",
      riskDisposition: "MITIGATED_BY_COMPATIBILITY_EVIDENCE",
    });
    expect(registry.cycles.find((cycle) => cycle.cycleId === "CYCLE-v2.0")).toMatchObject({
      snapshotPath: ".project/cycles/snapshots/CYCLE-v2.0.json",
      migrationStatus: "BOOTSTRAP_COMPATIBILITY_RECORDED",
    });
  });

  it("独立样例恰好覆盖 AC-072 至 AC-090", () => {
    const paths = ["cycle", "orchestrator", "parallel", "metrics", "retrospective"].map(
      (name) => `acceptance/fixtures/phase3-${name}-pass.json`,
    );
    const fixtures = paths.map(json);
    expect(fixtures.every((fixture) => fixture.source === "INDEPENDENT" && fixture.status === "PASS")).toBe(true);
    const actual = fixtures.flatMap((fixture) => fixture.acceptanceIds).sort();
    const expected = Array.from({ length: 19 }, (_, index) => `AC-${String(72 + index).padStart(3, "0")}`);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("人工 Gate 未批准时编排器只等待人工", () => {
    const facts = {
      cycleId: "CYCLE-v3.0",
      version: "v3.0",
      state: { currentStage: "DELIVERY", stageStatus: "IN_PROGRESS", activeRun: null, activeWorkItem: null },
      gates: { GATE_1: "APPROVED", GATE_2: "APPROVED", UI_GATE: "NOT_APPLICABLE", SOLUTION_DESIGN: "APPROVED", IMPLEMENTATION_PLAN: "APPROVED", GATE_3: "PENDING" },
      gateEvidence: { GATE_3: "docs/delivery.md" },
      checks: { finalVerification: "PASS", acceptanceAudit: "PASS" },
      workItems: [], missingArtifacts: [], contradictions: [],
    };
    expect(decideNextAction(facts)).toMatchObject({ status: "WAITING_HUMAN", code: "WAIT_GATE_3", action: null });
  });

  it("并行安全信息不足时退化为串行", () => {
    const item = (id) => ({ id, dependsOn: [], fileScopes: [], semanticResources: [], runtimeResources: [], isolation: "UNKNOWN" });
    const result = buildSchedule({ items: [item("WI-901"), item("WI-902")] });
    expect(result.status).toBe("READY");
    expect(result.groups.every((group) => group.mode === "SERIAL")).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it("缺失成本保持未知且 Gate 3 前禁止生成复盘", () => {
    const metric = {
      schemaVersion: 1, eventId: "METRIC-COMPAT", cycleId: "CYCLE-v3.0",
      subject: { type: "WORK_ITEM", id: "WI-036" }, source: { type: "RUN", ref: ".project/runs/RUN.md" },
      startedAt: "2026-11-23T00:00:00.000Z", endedAt: "2026-11-23T00:00:01.000Z", durationMs: 1000,
      outcome: "SUCCESS", counts: { success: 1, failure: 0, retry: 0 },
      quality: [{ kind: "test", status: "PASS", sourceRef: "evidence/RUN.md" }],
      usage: { calls: null, inputTokens: null, outputTokens: null, totalTokens: null, missingReason: "提供方未返回" },
      cost: { amount: null, currency: null, provider: null, sourceRef: null, missingReason: "提供方未返回" },
    };
    expect(validateMetricEvent(metric).valid).toBe(true);
    expect(buildRetrospective({ gate3Approved: false })).toMatchObject({ status: "BLOCKED", code: "GATE_3_REQUIRED" });
  });
});
