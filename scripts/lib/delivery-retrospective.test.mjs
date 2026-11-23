import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRetrospective, decideSuggestion, writeRetrospectiveOutputs } from "./delivery-retrospective.mjs";

const roots = [];
const metric = (overrides = {}) => ({ eventId: "METRIC-ONE", dataQuality: "VALID", durationMs: 1000, counts: { success: 1, failure: 0, retry: 0 }, quality: [{ kind: "test", status: "PASS", sourceRef: "evidence/run.md" }], usage: { calls: null, inputTokens: null, outputTokens: null, totalTokens: null, missingReason: "提供方未返回" }, cost: { amount: null, currency: null, provider: null, sourceRef: null, missingReason: "提供方未返回" }, ...overrides });
const input = (overrides = {}) => ({ gate3Approved: true, cycleId: "CYCLE-v3.0", generatedAt: "2026-11-21T00:00:00.000Z", sources: { cycle: ".project/cycles/index.json", runs: [".project/runs/RUN.md"], verification: "evidence/RUN.md", audit: ".project/audits/AUDIT.md", delivery: "docs/delivery.md" }, metrics: [metric()], inferences: ["失败集中在环境适配。"], suggestions: ["补充跨平台运行测试。"], ...overrides });
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("交付复盘与建议治理", () => {
  it("Gate 3 前拒绝最终复盘", () => expect(buildRetrospective(input({ gate3Approved: false }))).toMatchObject({ status: "BLOCKED", code: "GATE_3_REQUIRED" }));
  it("完整来源生成机器摘要和中文复盘并分隔四类内容", () => {
    const result = buildRetrospective(input({ metrics: [metric({ cost: { amount: 1, currency: "USD", provider: "p", sourceRef: "provider", missingReason: null } })] }));
    expect(result).toMatchObject({ status: "READY", summary: { facts: { durationMs: 1000, totalCost: 1, currency: "USD" } } });
    for (const heading of ["## 事实", "## 推断", "## 数据缺口", "## 待决定建议"]) expect(result.markdown).toContain(heading);
  });
  it("缺失数据保持未知并列出原因，不补造成本", () => {
    const result = buildRetrospective(input());
    expect(result.summary.facts.totalCost).toBeNull();
    expect(result.summary.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ field: "cost", reason: "提供方未返回" })]));
  });
  it("无效指标不进入事实并形成缺口", () => {
    const result = buildRetrospective(input({ metrics: [metric(), metric({ eventId: "BAD", dataQuality: "INVALID" })] }));
    expect(result.summary.facts.metricEvents).toBe(1);
    expect(result.summary.gaps.some((gap) => gap.field === "invalidEvents")).toBe(true);
  });
  it("建议稳定编号且初始等待决定", () => {
    const one = buildRetrospective(input()).summary.suggestions[0];
    const two = buildRetrospective(input()).summary.suggestions[0];
    expect(one).toEqual(two);
    expect(one).toMatchObject({ status: "PENDING", decisionRef: null });
  });
  it("接受建议必须引用变更或周期，拒绝和延期不要求引用", () => {
    const suggestion = buildRetrospective(input()).summary.suggestions[0];
    expect(() => decideSuggestion(suggestion, "ACCEPTED", null)).toThrow("受控变更或新周期");
    expect(decideSuggestion(suggestion, "ACCEPTED", "CHG-101")).toMatchObject({ status: "ACCEPTED", decisionRef: "CHG-101" });
    expect(decideSuggestion(suggestion, "DEFERRED", null).status).toBe("DEFERRED");
  });
  it("输出不可覆盖且不修改来源业务产物", () => {
    const root = mkdtempSync(join(tmpdir(), "todo-retro-")); roots.push(root);
    const source = join(root, "delivery.md"); writeFileSync(source, "批准事实", "utf8");
    const result = buildRetrospective(input()); const json = join(root, "retro.json"); const md = join(root, "retro.md");
    writeRetrospectiveOutputs(json, md, result);
    expect(readFileSync(source, "utf8")).toBe("批准事实");
    expect(() => writeRetrospectiveOutputs(json, md, result)).toThrow();
  });
  it("缺少关键来源时失败关闭", () => expect(buildRetrospective(input({ sources: { ...input().sources, audit: "" } })).status).toBe("BLOCKED"));
});
