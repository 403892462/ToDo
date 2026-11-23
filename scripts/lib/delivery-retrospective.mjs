import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REQUIRED_SOURCES = ["cycle", "runs", "verification", "audit", "delivery"];

function sourceRefs(sources) {
  const errors = [];
  for (const name of REQUIRED_SOURCES) {
    const value = sources?.[name];
    if (name === "runs") {
      if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) errors.push("缺少运行来源。");
    } else if (typeof value !== "string" || value.length === 0) errors.push(`缺少 ${name} 来源。`);
  }
  return errors;
}

function suggestionId(text) {
  return `REC-${createHash("sha256").update(text).digest("hex").slice(0, 8).toUpperCase()}`;
}

export function buildRetrospective(input) {
  if (input?.gate3Approved !== true) return { status: "BLOCKED", code: "GATE_3_REQUIRED", reason: "最终交付复盘必须等待 Gate 3 人工批准。" };
  const errors = sourceRefs(input.sources);
  if (!/^CYCLE-v\d+\.\d+$/.test(input.cycleId ?? "")) errors.push("周期编号无效。");
  if (!Array.isArray(input.metrics)) errors.push("指标集合无效。");
  if (errors.length > 0) return { status: "BLOCKED", code: "INVALID_SOURCES", reason: errors.join("；") };
  const metrics = input.metrics.filter((event) => event?.dataQuality === "VALID");
  const rejectedMetrics = input.metrics.length - metrics.length;
  const durationMs = metrics.reduce((sum, event) => sum + event.durationMs, 0);
  const counts = metrics.reduce((sum, event) => ({ success: sum.success + event.counts.success, failure: sum.failure + event.counts.failure, retry: sum.retry + event.counts.retry }), { success: 0, failure: 0, retry: 0 });
  const quality = metrics.flatMap((event) => event.quality.map((entry) => ({ ...entry, metricEventId: event.eventId })));
  const knownCosts = metrics.filter((event) => event.cost.amount !== null);
  const currencies = [...new Set(knownCosts.map((event) => event.cost.currency))];
  const totalCost = knownCosts.length > 0 && currencies.length === 1 ? knownCosts.reduce((sum, event) => sum + event.cost.amount, 0) : null;
  const gaps = [];
  for (const event of metrics) {
    if ([event.usage.calls, event.usage.inputTokens, event.usage.outputTokens, event.usage.totalTokens].some((value) => value === null)) gaps.push({ source: event.eventId, field: "usage", reason: event.usage.missingReason });
    if (event.cost.amount === null) gaps.push({ source: event.eventId, field: "cost", reason: event.cost.missingReason });
  }
  if (currencies.length > 1) gaps.push({ source: "metrics", field: "totalCost", reason: "存在多币种，未合并金额。" });
  if (rejectedMetrics > 0) gaps.push({ source: "metrics", field: "invalidEvents", reason: `${rejectedMetrics} 个无效指标未纳入事实汇总。` });
  const suggestions = (input.suggestions ?? []).map((text) => ({ id: suggestionId(text), text, status: "PENDING", decisionRef: null }));
  const summary = {
    schemaVersion: 1,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    sources: input.sources,
    facts: { metricEvents: metrics.length, durationMs, counts, quality, totalCost, currency: currencies.length === 1 ? currencies[0] : null },
    inferences: [...(input.inferences ?? [])],
    gaps,
    suggestions,
  };
  return { status: "READY", code: "RETROSPECTIVE_READY", summary, markdown: renderRetrospective(summary) };
}

export function renderRetrospective(summary) {
  const lines = [
    `# ${summary.cycleId} 交付复盘`, "",
    `- 生成时间：${summary.generatedAt}`, `- 周期来源：${summary.sources.cycle}`, `- 验证来源：${summary.sources.verification}`, `- 审计来源：${summary.sources.audit}`, `- 交付来源：${summary.sources.delivery}`, "",
    "## 事实", "",
    `- 有效指标事件：${summary.facts.metricEvents}`, `- 总耗时：${summary.facts.durationMs} 毫秒`, `- 成功/失败/重试：${summary.facts.counts.success}/${summary.facts.counts.failure}/${summary.facts.counts.retry}`,
    `- 可汇总成本：${summary.facts.totalCost === null ? "未知" : `${summary.facts.totalCost} ${summary.facts.currency}`}`, "",
    "## 推断", "", ...(summary.inferences.length ? summary.inferences.map((item) => `- ${item}`) : ["- 无。"]), "",
    "## 数据缺口", "", ...(summary.gaps.length ? summary.gaps.map((gap) => `- ${gap.source} / ${gap.field}：${gap.reason}`) : ["- 无。"]), "",
    "## 待决定建议", "", ...(summary.suggestions.length ? summary.suggestions.map((item) => `- ${item.id} [${item.status}]：${item.text}`) : ["- 无。"]), "",
  ];
  return lines.join("\n");
}

export function decideSuggestion(suggestion, decision, decisionRef) {
  if (suggestion.status !== "PENDING") throw new Error("只能处理 PENDING 建议。");
  if (!new Set(["ACCEPTED", "REJECTED", "DEFERRED"]).has(decision)) throw new Error("建议决定无效。");
  if (decision === "ACCEPTED" && !/^(CHG-\d+|CYCLE-v\d+\.\d+)$/.test(decisionRef ?? "")) throw new Error("接受建议必须引用受控变更或新周期。");
  return { ...suggestion, status: decision, decisionRef: decisionRef ?? null };
}

export function writeRetrospectiveOutputs(summaryPath, markdownPath, result) {
  if (result.status !== "READY") throw new Error("只有 READY 复盘可以写入。");
  for (const [path, content] of [[summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`], [markdownPath, result.markdown]]) {
    mkdirSync(dirname(path), { recursive: true });
    const descriptor = openSync(path, "wx");
    try { writeFileSync(descriptor, content, "utf8"); } finally { closeSync(descriptor); }
  }
}
