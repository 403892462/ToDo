import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SECRET_KEY = /(?:secret|password|tokenValue|api[_-]?key|authorization|cookie)/i;
const QUALITY_KINDS = new Set(["test", "build", "contract", "audit"]);

function isIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function findSecretKeys(value, path = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => SECRET_KEY.test(key) ? [`${path}${key}`] : findSecretKeys(child, `${path}${key}.`));
}

export function validateMetricEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) return { valid: false, errors: ["指标事件必须是对象。"] };
  if (event.schemaVersion !== 1) errors.push("schemaVersion 必须为 1。");
  if (!/^METRIC-[A-Z0-9-]+$/.test(event.eventId ?? "")) errors.push("事件编号格式无效。");
  if (!/^CYCLE-v\d+\.\d+$/.test(event.cycleId ?? "")) errors.push("周期编号格式无效。");
  if (!event.subject || typeof event.subject.type !== "string" || typeof event.subject.id !== "string") errors.push("指标对象不完整。");
  if (!event.source || typeof event.source.type !== "string" || typeof event.source.ref !== "string" || event.source.ref.length === 0) errors.push("指标来源不完整。");
  if (!isIso(event.startedAt) || !isIso(event.endedAt)) errors.push("开始或结束时间不是规范 ISO 8601 时间。");
  const calculated = isIso(event.startedAt) && isIso(event.endedAt) ? Date.parse(event.endedAt) - Date.parse(event.startedAt) : null;
  if (!nonNegativeInteger(event.durationMs) || calculated === null || calculated < 0 || event.durationMs !== calculated) errors.push("耗时必须是与起止时间一致的非负整数毫秒。");
  if (!new Set(["SUCCESS", "FAILURE", "UNKNOWN"]).has(event.outcome)) errors.push("结果状态无效。");
  for (const key of ["success", "failure", "retry"]) if (!nonNegativeInteger(event.counts?.[key])) errors.push(`${key} 次数必须是非负整数。`);
  if (event.outcome === "SUCCESS" && (event.counts?.success < 1 || event.counts?.failure !== 0)) errors.push("成功结果与成功/失败次数矛盾。");
  if (event.outcome === "FAILURE" && event.counts?.failure < 1) errors.push("失败结果与失败次数矛盾。");
  if (!Array.isArray(event.quality)) errors.push("质量指标必须是数组。");
  else for (const entry of event.quality) {
    if (!QUALITY_KINDS.has(entry.kind) || !new Set(["PASS", "FAIL", "UNKNOWN"]).has(entry.status) || typeof entry.sourceRef !== "string" || entry.sourceRef.length === 0) errors.push("质量指标必须包含受支持类型、真实状态和来源引用。");
  }
  const usage = event.usage;
  if (!usage || ![usage.calls, usage.inputTokens, usage.outputTokens, usage.totalTokens].every((value) => value === null || nonNegativeInteger(value))) errors.push("调用量和 token 必须为非负整数或 null。");
  else {
    const tokenValues = [usage.inputTokens, usage.outputTokens, usage.totalTokens];
    if (tokenValues.every((value) => value !== null) && usage.inputTokens + usage.outputTokens !== usage.totalTokens) errors.push("总 token 与输入、输出 token 不一致。");
    if ([usage.calls, ...tokenValues].some((value) => value === null) && (typeof usage.missingReason !== "string" || usage.missingReason.length === 0)) errors.push("未知使用量必须记录原因。");
  }
  const cost = event.cost;
  if (!cost || !(cost.amount === null || (typeof cost.amount === "number" && Number.isFinite(cost.amount) && cost.amount >= 0))) errors.push("成本金额必须为非负数或 null。");
  else if (cost.amount === null) {
    if (cost.currency !== null || cost.provider !== null || cost.sourceRef !== null || typeof cost.missingReason !== "string" || cost.missingReason.length === 0) errors.push("未知成本必须使用 null 并记录原因。");
  } else if (![cost.currency, cost.provider, cost.sourceRef].every((value) => typeof value === "string" && value.length > 0)) errors.push("已知成本必须包含币种、提供方和来源。");
  const secretKeys = findSecretKeys(event);
  if (secretKeys.length > 0) errors.push("指标事件包含禁止的敏感字段。");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function exclusiveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx");
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8"); } finally { closeSync(descriptor); }
}

export function createMetricStore(root, cycleId) {
  if (!/^CYCLE-v\d+\.\d+$/.test(cycleId)) throw new Error("周期编号格式无效。");
  const base = join(root, ".project", "cycles", cycleId, "metrics");
  return {
    collect(event, now = new Date().toISOString()) {
      const validation = validateMetricEvent(event);
      if (!validation.valid) {
        const safeId = /^METRIC-[A-Z0-9-]+$/.test(event?.eventId ?? "") ? event.eventId : `METRIC-INVALID-${createHash("sha256").update(JSON.stringify(event ?? null)).digest("hex").slice(0, 12).toUpperCase()}`;
        const issue = { schemaVersion: 1, issueId: `DQ-${safeId}`, eventId: event?.eventId ?? null, recordedAt: now, status: "INVALID", errors: validation.errors };
        exclusiveJson(join(base, "issues", `${issue.issueId}.json`), issue);
        return { status: "REJECTED", code: "DATA_QUALITY_ISSUE", issue, eventPath: null };
      }
      const path = join(base, "events", `${event.eventId}.json`);
      exclusiveJson(path, { ...event, dataQuality: "VALID" });
      return { status: "COLLECTED", code: "METRIC_RECORDED", eventPath: path };
    },
    validate(eventId) {
      if (!/^METRIC-[A-Z0-9-]+$/.test(eventId)) throw new Error("事件编号格式无效。");
      const path = join(base, "events", `${eventId}.json`);
      if (!existsSync(path)) throw new Error("指标事件不存在。");
      return validateMetricEvent(JSON.parse(readFileSync(path, "utf8")));
    },
  };
}

export function redactMetricError(error) {
  return String(error instanceof Error ? error.message : error).replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[REDACTED]").slice(0, 500);
}
