import { createHash } from "node:crypto";

export const RECOVERY_DECISIONS = Object.freeze({
  SAFE_RETRY: "SAFE_RETRY",
  RECORD_COMPLETION: "RECORD_COMPLETION",
  MANUAL_RECOVERY: "MANUAL_RECOVERY",
});

export const ACTION_ALLOWLIST = Object.freeze({
  ADVANCE_TO_REQUIREMENTS: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_SOLUTION_DESIGN: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_PLANNING: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_IMPLEMENTATION: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_ACCEPTANCE_AUDIT: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_DELIVERY: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  ADVANCE_TO_COMPLETED: Object.freeze({ command: "project-control-advance", required: Object.freeze([]), expected: Object.freeze({ currentStage: "target" }) }),
  START_WORK_ITEM: Object.freeze({
    command: "work-item-control",
    required: Object.freeze(["workItem", "runId"]),
    expected: Object.freeze({ activeRun: "runId" }),
  }),
  RUN_FINAL_VERIFICATION: Object.freeze({
    command: "project-verify",
    required: Object.freeze([]),
    expected: Object.freeze({ verification: "PASS" }),
  }),
  RUN_ACCEPTANCE_AUDIT: Object.freeze({
    command: "acceptance-audit",
    required: Object.freeze(["auditId"]),
    expected: Object.freeze({ acceptanceAudit: "PASS" }),
  }),
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function actionIdempotencyKey({ cycleId, stateDigest, action, target }) {
  if (![cycleId, stateDigest, action, target].every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("幂等键需要周期、状态摘要、动作和目标。 ");
  }
  return createHash("sha256").update(canonical({ action, cycleId, stateDigest, target })).digest("hex");
}

export function validateActionRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("动作请求必须是对象。");
  const allowedKeys = new Set(["cycleId", "stateDigest", "action", "target", "params", "timeoutMs"]);
  const unknown = Object.keys(request).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) throw new Error(`动作请求包含未允许字段：${unknown.sort().join("、")}`);
  const definition = ACTION_ALLOWLIST[request.action];
  if (!definition) throw new Error(`动作不在白名单：${request.action ?? "<空>"}`);
  if (!/^CYCLE-v\d+\.\d+$/.test(request.cycleId ?? "")) throw new Error("周期编号格式无效。");
  if (!/^[a-f0-9]{64}$/.test(request.stateDigest ?? "")) throw new Error("状态摘要格式无效。");
  for (const key of ["cycleId", "stateDigest", "target"]) {
    if (typeof request[key] !== "string" || request[key].length === 0) throw new Error(`动作请求缺少 ${key}。`);
  }
  if (!request.params || typeof request.params !== "object" || Array.isArray(request.params)) throw new Error("params 必须是对象。");
  const allowedParams = new Set(definition.required);
  const unknownParams = Object.keys(request.params).filter((key) => !allowedParams.has(key));
  if (unknownParams.length > 0) throw new Error(`动作参数不在白名单：${unknownParams.sort().join("、")}`);
  for (const name of definition.required) {
    if (typeof request.params[name] !== "string" || request.params[name].length === 0) throw new Error(`缺少动作参数：${name}`);
  }
  if (request.action === "START_WORK_ITEM") {
    if (!/^WI-\d{3}$/.test(request.params.workItem) || request.target !== request.params.workItem) throw new Error("启动工作项的目标或编号无效。");
    if (!/^RUN-\d{8}-\d{6}-WI\d{3}$/.test(request.params.runId)) throw new Error("运行编号格式无效。");
  }
  if (request.action === "RUN_FINAL_VERIFICATION" && request.target !== "PROJECT") throw new Error("项目验证目标必须为 PROJECT。");
  if (request.action === "RUN_ACCEPTANCE_AUDIT" && (!/^AUDIT-\d{8}-\d{6}$/.test(request.params.auditId) || request.target !== request.params.auditId)) {
    throw new Error("验收审计目标或编号无效。");
  }
  const stageTargets = {
    ADVANCE_TO_REQUIREMENTS: "REQUIREMENTS",
    ADVANCE_TO_SOLUTION_DESIGN: "SOLUTION_DESIGN",
    ADVANCE_TO_PLANNING: "PLANNING",
    ADVANCE_TO_IMPLEMENTATION: "IMPLEMENTATION",
    ADVANCE_TO_ACCEPTANCE_AUDIT: "ACCEPTANCE_AUDIT",
    ADVANCE_TO_DELIVERY: "DELIVERY",
    ADVANCE_TO_COMPLETED: "COMPLETED",
  };
  if (stageTargets[request.action] && request.target !== stageTargets[request.action]) throw new Error("阶段推进目标与动作不匹配。");
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 3_600_000) {
    throw new Error("timeoutMs 必须是 100 至 3600000 的整数。");
  }
  return definition;
}

function expectedState(definition, request) {
  return Object.fromEntries(Object.entries(definition.expected).map(([key, value]) => [key, value === "runId" ? request.params.runId : value === "target" ? request.target : value]));
}

function matchesExpected(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

export function decideRecovery({ log, currentState }) {
  if (!log || log.status === "SUCCEEDED") return { decision: RECOVERY_DECISIONS.RECORD_COMPLETION, reason: "动作已经成功。" };
  if (matchesExpected(currentState, log.expectedState)) {
    return { decision: RECOVERY_DECISIONS.RECORD_COMPLETION, reason: "当前状态已达到目标，仅需补记完成。" };
  }
  if (log.sideEffectStarted === false && log.beforeStateDigest === currentState?.digest) {
    return { decision: RECOVERY_DECISIONS.SAFE_RETRY, reason: "未开始副作用且状态未变化，可以安全重试。" };
  }
  return { decision: RECOVERY_DECISIONS.MANUAL_RECOVERY, reason: "副作用或当前状态无法确定，必须人工恢复。" };
}

export async function executeControlledAction(request, ports, options = {}) {
  const definition = validateActionRequest(request);
  const key = actionIdempotencyKey(request);
  const prior = await ports.logs.get(key);
  let recoveredState = null;
  if (prior?.status === "SUCCEEDED") return { ...prior, replayed: true };
  if (prior && prior.status !== "SUCCEEDED") {
    recoveredState = await ports.readState();
    const recovery = decideRecovery({ log: prior, currentState: recoveredState });
    if (!(options.allowSafeRetry === true && recovery.decision === RECOVERY_DECISIONS.SAFE_RETRY)) {
      return { status: "BLOCKED", code: "RECOVERY_REQUIRED", key, recovery };
    }
  }
  if (await ports.lock.exists()) return { status: "BLOCKED", code: "ORCHESTRATOR_LOCKED", key };
  const before = recoveredState ?? await ports.readState();
  if (before.digest !== request.stateDigest) return { status: "BLOCKED", code: "STATE_CHANGED", key };
  const expected = expectedState(definition, request);
  const startedAt = ports.now();
  const baseLog = { key, cycleId: request.cycleId, action: request.action, target: request.target, command: definition.command, beforeStateDigest: before.digest, expectedState: expected, startedAt, recoveryEntry: `node scripts/project-orchestrator.mjs recover ${request.cycleId} ${key}`, sideEffectStarted: false, status: "STARTED" };
  await ports.lock.acquire({ key, cycleId: request.cycleId, startedAt });
  await ports.logs.append(baseLog);
  try {
    try {
      await ports.contractCheck("before");
    } catch (error) {
      const failed = { ...baseLog, status: "FAILED", code: error.code ?? "PRECONDITION_FAILED", reason: error.message, endedAt: ports.now() };
      await ports.logs.append(failed);
      return failed;
    }
    await ports.logs.append({ ...baseLog, sideEffectStarted: true, status: "RUNNING" });
    let outcome;
    let timer;
    const controller = new AbortController();
    try {
      outcome = await Promise.race([
        ports.invoke(definition.command, { ...request.params }, { signal: controller.signal }),
        new Promise((_, reject) => {
          timer = ports.setTimer(() => {
            controller.abort();
            reject(Object.assign(new Error("动作执行超时。"), { code: "TIMEOUT" }));
          }, request.timeoutMs);
        }),
      ]);
    } catch (error) {
      const failed = { ...baseLog, sideEffectStarted: true, status: "FAILED", code: error.code ?? "EXECUTION_ERROR", reason: error.message, endedAt: ports.now() };
      await ports.logs.append(failed);
      return failed;
    } finally {
      if (timer !== undefined) ports.clearTimer?.(timer);
    }
    if (!outcome || outcome.exitCode !== 0) {
      const failed = { ...baseLog, sideEffectStarted: true, status: "FAILED", code: "NON_ZERO_EXIT", exitCode: outcome?.exitCode ?? null, endedAt: ports.now() };
      await ports.logs.append(failed);
      return failed;
    }
    try {
      await ports.contractCheck("after");
    } catch (error) {
      const failed = { ...baseLog, sideEffectStarted: true, status: "FAILED", code: error.code ?? "POSTCONDITION_FAILED", reason: error.message, endedAt: ports.now() };
      await ports.logs.append(failed);
      return failed;
    }
    const after = { ...(await ports.readState()), ...(outcome.state ?? {}) };
    if (!matchesExpected(after, expected)) {
      const failed = { ...baseLog, sideEffectStarted: true, status: "FAILED", code: "UNEXPECTED_STATE", afterStateDigest: after.digest, endedAt: ports.now() };
      await ports.logs.append(failed);
      return failed;
    }
    const nextAction = ports.nextAction ? await ports.nextAction() : null;
    const succeeded = { ...baseLog, sideEffectStarted: true, status: "SUCCEEDED", exitCode: 0, afterStateDigest: after.digest, endedAt: ports.now(), nextAction, replayed: false };
    await ports.logs.append(succeeded);
    return succeeded;
  } finally {
    await ports.lock.release(key);
  }
}
