import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMetricStore, redactMetricError, validateMetricEvent } from "./metrics.mjs";

const roots = [];
const valid = (overrides = {}) => ({ schemaVersion: 1, eventId: "METRIC-ONE", cycleId: "CYCLE-v3.0", subject: { type: "WORK_ITEM", id: "WI-034" }, source: { type: "RUN", ref: ".project/runs/RUN-ONE.md" }, startedAt: "2026-11-21T00:00:00.000Z", endedAt: "2026-11-21T00:00:01.000Z", durationMs: 1000, outcome: "SUCCESS", counts: { success: 1, failure: 0, retry: 0 }, quality: [{ kind: "test", status: "PASS", sourceRef: "evidence/RUN-ONE.md" }], usage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, missingReason: null }, cost: { amount: 0.01, currency: "USD", provider: "provider", sourceRef: "provider-response", missingReason: null }, ...overrides });
function root() { const path = mkdtempSync(join(tmpdir(), "todo-metrics-")); roots.push(path); return path; }
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("追加式指标与数据质量", () => {
  it("接受可追溯耗时、计数、质量、使用量和成本", () => expect(validateMetricEvent(valid()).valid).toBe(true));
  it("未知使用量和成本保留 null 与原因", () => {
    const event = valid({ usage: { calls: null, inputTokens: null, outputTokens: null, totalTokens: null, missingReason: "提供方未返回" }, cost: { amount: null, currency: null, provider: null, sourceRef: null, missingReason: "提供方未返回" } });
    expect(validateMetricEvent(event).valid).toBe(true);
  });
  it.each([
    ["结束早于开始", { endedAt: "2026-11-20T23:59:59.000Z", durationMs: -1000 }],
    ["负计数", { counts: { success: 1, failure: -1, retry: 0 } }],
    ["token 矛盾", { usage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 20, missingReason: null } }],
    ["质量来源缺失", { quality: [{ kind: "test", status: "PASS", sourceRef: "" }] }],
    ["成本来源缺失", { cost: { amount: 1, currency: "USD", provider: "p", sourceRef: "", missingReason: null } }],
    ["结果计数矛盾", { outcome: "SUCCESS", counts: { success: 0, failure: 1, retry: 0 } }],
  ])("拒绝%s", (_name, override) => expect(validateMetricEvent(valid(override)).valid).toBe(false));
  it("每事件独立保存并禁止覆盖", () => {
    const store = createMetricStore(root(), "CYCLE-v3.0");
    expect(store.collect(valid()).status).toBe("COLLECTED");
    expect(() => store.collect(valid())).toThrow();
    expect(store.collect(valid({ eventId: "METRIC-TWO" })).status).toBe("COLLECTED");
  });
  it("无效指标产生质量问题且不修改原证据", () => {
    const workspace = root(); const evidence = join(workspace, "evidence", "RUN.md"); mkdirSync(join(workspace, "evidence")); writeFileSync(evidence, "原始证据", "utf8");
    const before = createHash("sha256").update(readFileSync(evidence)).digest("hex");
    expect(createMetricStore(workspace, "CYCLE-v3.0").collect(valid({ durationMs: 999 }))).toMatchObject({ status: "REJECTED", eventPath: null });
    expect(createHash("sha256").update(readFileSync(evidence)).digest("hex")).toBe(before);
  });
  it("拒绝敏感字段并脱敏错误", () => {
    expect(validateMetricEvent(valid({ apiKey: "secret" })).errors).toContain("指标事件包含禁止的敏感字段。");
    expect(redactMetricError("Bearer abc.def sk-secret-value")).not.toContain("secret-value");
  });
});
