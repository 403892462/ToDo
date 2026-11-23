import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileActionLog, createFileOrchestratorLock, projectStateSnapshot } from "./orchestrator-runtime.mjs";

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "todo-orchestrator-runtime-"));
  roots.push(root);
  mkdirSync(join(root, ".project"), { recursive: true });
  writeFileSync(join(root, ".project", "state.md"), [
    "---",
    "current_stage: IMPLEMENTATION",
    'active_work_item: "WI-031"',
    'active_run: "RUN-20261118-220235-WI031"',
    "---",
    "",
  ].join("\n"), "utf8");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("编排运行时持久化", () => {
  it("生成状态摘要并读取受控状态字段", () => {
    const root = fixture();
    const first = projectStateSnapshot(root);
    expect(first).toMatchObject({ currentStage: "IMPLEMENTATION", activeWorkItem: "WI-031", activeRun: "RUN-20261118-220235-WI031" });
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(projectStateSnapshot(root).digest).toBe(first.digest);
  });

  it("按幂等键追加动作事件且不覆盖历史", async () => {
    const root = fixture();
    const logs = createFileActionLog(root, "CYCLE-v3.0");
    const key = "a".repeat(64);
    await logs.append({ key, status: "STARTED" });
    await logs.append({ key, status: "SUCCEEDED" });
    expect(await logs.get(key)).toEqual({ key, status: "SUCCEEDED" });
    const stored = JSON.parse(readFileSync(join(root, ".project", "cycles", "CYCLE-v3.0", "actions", `${key}.json`), "utf8"));
    expect(stored.events.map((event) => event.status)).toEqual(["STARTED", "SUCCEEDED"]);
  });

  it("编排锁互斥、校验所有者并允许合法释放", async () => {
    const root = fixture();
    const lock = createFileOrchestratorLock(root);
    await lock.acquire({ key: "a".repeat(64), cycleId: "CYCLE-v3.0", startedAt: "2026-11-21T00:00:00.000Z" });
    expect(await lock.exists()).toBe(true);
    await expect(lock.acquire({ key: "b".repeat(64), cycleId: "CYCLE-v3.0", startedAt: "2026-11-21T00:00:01.000Z" })).rejects.toThrow();
    await expect(lock.release("b".repeat(64))).rejects.toThrow("不属于当前动作");
    await lock.release("a".repeat(64));
    expect(await lock.exists()).toBe(false);
  });

  it("拒绝非法周期编号", () => {
    const root = fixture();
    expect(() => createFileActionLog(root, "../../escape")).toThrow("周期编号格式无效");
  });
});
