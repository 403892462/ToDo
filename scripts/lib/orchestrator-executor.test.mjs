import { describe, expect, it, vi } from "vitest";
import { ACTION_ALLOWLIST, RECOVERY_DECISIONS, actionIdempotencyKey, decideRecovery, executeControlledAction, validateActionRequest } from "./orchestrator-executor.mjs";

const request = { cycleId: "CYCLE-v3.0", stateDigest: "a".repeat(64), action: "START_WORK_ITEM", target: "WI-032", params: { workItem: "WI-032", runId: "RUN-20261118-000000-WI032" }, timeoutMs: 1000 };

function ports(overrides = {}) {
  const records = [];
  let locked = false;
  let reads = 0;
  return {
    records,
    logs: { get: vi.fn(async () => null), append: vi.fn(async (entry) => records.push(entry)) },
    lock: { exists: vi.fn(async () => locked), acquire: vi.fn(async () => { locked = true; }), release: vi.fn(async () => { locked = false; }) },
    readState: vi.fn(async () => (++reads === 1 ? { digest: request.stateDigest } : { digest: "b".repeat(64), activeRun: request.params.runId })),
    contractCheck: vi.fn(async () => undefined),
    invoke: vi.fn(async () => ({ exitCode: 0 })),
    now: vi.fn(() => "2026-11-18T00:00:00.000Z"),
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn(),
    nextAction: vi.fn(async () => ({ status: "ACTIONABLE", action: "NEXT" })),
    ...overrides,
  };
}

describe("受控编排动作执行器", () => {
  it("稳定生成幂等键且对象键顺序不影响结果", () => {
    expect(actionIdempotencyKey(request)).toBe(actionIdempotencyKey({ target: request.target, action: request.action, stateDigest: request.stateDigest, cycleId: request.cycleId }));
  });

  it("拒绝未知动作、任意命令和额外参数", () => {
    expect(() => validateActionRequest({ ...request, action: "SHELL", command: "rm" })).toThrow("未允许字段");
    expect(() => validateActionRequest({ ...request, action: "SHELL" })).toThrow("不在白名单");
    expect(() => validateActionRequest({ ...request, params: { ...request.params, command: "whoami" } })).toThrow("参数不在白名单");
    expect(Object.keys(ACTION_ALLOWLIST)).not.toContain("SHELL");
  });

  it("阶段推进仅允许动作对应的固定目标", () => {
    const advance = { ...request, action: "ADVANCE_TO_DELIVERY", target: "DELIVERY", params: {} };
    expect(validateActionRequest(advance).command).toBe("project-control-advance");
    expect(() => validateActionRequest({ ...advance, target: "COMPLETED" })).toThrow("目标与动作不匹配");
  });

  it("执行前后检查契约、验证目标状态并释放锁", async () => {
    const p = ports();
    const result = await executeControlledAction(request, p);
    expect(result.status).toBe("SUCCEEDED");
    expect(p.contractCheck.mock.calls).toEqual([["before"], ["after"]]);
    expect(p.invoke).toHaveBeenCalledWith("work-item-control", request.params, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(p.clearTimer).toHaveBeenCalledWith(1);
    expect(result.nextAction).toEqual({ status: "ACTIONABLE", action: "NEXT" });
    expect(p.lock.release).toHaveBeenCalledOnce();
  });

  it("成功动作重复请求直接返回原结果且不产生副作用", async () => {
    const prior = { status: "SUCCEEDED", key: actionIdempotencyKey(request) };
    const p = ports({ logs: { get: vi.fn(async () => prior), append: vi.fn() } });
    expect(await executeControlledAction(request, p)).toEqual({ ...prior, replayed: true });
    expect(p.invoke).not.toHaveBeenCalled();
  });

  it("只有显式安全重试才允许重新执行无副作用失败", async () => {
    const prior = { status: "FAILED", sideEffectStarted: false, beforeStateDigest: request.stateDigest, expectedState: { activeRun: request.params.runId } };
    const blocked = ports({ logs: { get: vi.fn(async () => prior), append: vi.fn() } });
    expect((await executeControlledAction(request, blocked)).code).toBe("RECOVERY_REQUIRED");
    expect(blocked.invoke).not.toHaveBeenCalled();

    const retry = ports();
    retry.logs.get.mockResolvedValue(prior);
    expect((await executeControlledAction(request, retry, { allowSafeRetry: true })).status).toBe("SUCCEEDED");
    expect(retry.invoke).toHaveBeenCalledOnce();
  });

  it.each([
    ["非零退出", { invoke: vi.fn(async () => ({ exitCode: 2 })) }, "NON_ZERO_EXIT"],
    ["超时", { invoke: vi.fn(() => new Promise(() => {})), setTimer: vi.fn((callback) => { callback(); return 1; }) }, "TIMEOUT"],
    ["执行异常", { invoke: vi.fn(async () => { throw new Error("boom"); }) }, "EXECUTION_ERROR"],
  ])("%s 时立即停止并释放锁", async (_name, override, code) => {
    const p = ports(override);
    expect((await executeControlledAction(request, p)).code).toBe(code);
    expect(p.lock.release).toHaveBeenCalledOnce();
  });

  it("目标状态不符时失败关闭", async () => {
    const p = ports({ readState: vi.fn(async () => ({ digest: request.stateDigest, activeRun: null })) });
    expect((await executeControlledAction(request, p)).code).toBe("UNEXPECTED_STATE");
  });

  it("已有锁或前置状态变化时不调用动作", async () => {
    const locked = ports();
    locked.lock.exists.mockResolvedValue(true);
    expect((await executeControlledAction(request, locked)).code).toBe("ORCHESTRATOR_LOCKED");
    const changed = ports({ readState: vi.fn(async () => ({ digest: "changed" })) });
    expect((await executeControlledAction(request, changed)).code).toBe("STATE_CHANGED");
    expect(changed.invoke).not.toHaveBeenCalled();
  });

  it("前置和后置契约失败均形成失败日志且不误报成功", async () => {
    const before = ports({ contractCheck: vi.fn(async () => { throw Object.assign(new Error("bad"), { code: "CONTRACT_CHECK_FAILED" }); }) });
    expect((await executeControlledAction(request, before)).code).toBe("CONTRACT_CHECK_FAILED");
    expect(before.invoke).not.toHaveBeenCalled();
    expect(before.records.at(-1)).toMatchObject({ status: "FAILED", sideEffectStarted: false });

    let checks = 0;
    const after = ports({ contractCheck: vi.fn(async () => { if (++checks === 2) throw Object.assign(new Error("bad"), { code: "PROTOCOL_CHECK_FAILED" }); }) });
    expect((await executeControlledAction(request, after)).code).toBe("PROTOCOL_CHECK_FAILED");
    expect(after.records.at(-1)).toMatchObject({ status: "FAILED", sideEffectStarted: true });
  });

  it("把中断恢复判定为安全重试、补记完成或人工恢复", () => {
    expect(decideRecovery({ log: { status: "FAILED", sideEffectStarted: false, beforeStateDigest: "a", expectedState: { activeRun: "r" } }, currentState: { digest: "a" } }).decision).toBe(RECOVERY_DECISIONS.SAFE_RETRY);
    expect(decideRecovery({ log: { status: "RUNNING", sideEffectStarted: true, expectedState: { activeRun: "r" } }, currentState: { digest: "b", activeRun: "r" } }).decision).toBe(RECOVERY_DECISIONS.RECORD_COMPLETION);
    expect(decideRecovery({ log: { status: "RUNNING", sideEffectStarted: true, expectedState: { activeRun: "r" } }, currentState: { digest: "b" } }).decision).toBe(RECOVERY_DECISIONS.MANUAL_RECOVERY);
  });
});
