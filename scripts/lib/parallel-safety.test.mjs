import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLeaseStore, evaluateDrift, evaluateLeaseRequest, hashWorkspacePaths } from "./parallel-safety.mjs";

const roots = [];
const lease = (id, workItem, overrides = {}) => ({
  leaseId: id,
  workItem,
  mode: "PARALLEL",
  fileScopes: [{ path: `src/${workItem}`, kind: "directory" }],
  semanticResources: [`contract:${workItem}`],
  runtimeResources: [],
  runDirectory: `.project/runs/${workItem}`,
  ...overrides,
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("并行资源租约与漂移检查", () => {
  it("独立范围可以同时取得租约", () => {
    expect(evaluateLeaseRequest([lease("LEASE-A", "WI-001")], lease("LEASE-B", "WI-002"))).toMatchObject({ status: "ACQUIRED" });
  });

  it.each([
    ["文件包含", { fileScopes: [{ path: "src/shared", kind: "directory" }] }, { fileScopes: [{ path: "src/shared/a.ts", kind: "file" }] }],
    ["语义资源", { semanticResources: ["public-api"] }, { semanticResources: ["public-api"] }],
    ["运行资源", { runtimeResources: ["global:verify"] }, { runtimeResources: ["global:verify"] }],
    ["运行目录", { runDirectory: ".project/runs/shared" }, { runDirectory: ".project/runs/shared" }],
  ])("%s 冲突阻止并行租约", (_name, left, right) => {
    const result = evaluateLeaseRequest([lease("LEASE-A", "WI-001", left)], lease("LEASE-B", "WI-002", right));
    expect(result).toMatchObject({ status: "BLOCKED", code: "LEASE_CONFLICT" });
    expect(result.conflicts[0].reasons.length).toBeGreaterThan(0);
  });

  it("全量验证资源保持互斥", () => {
    const first = lease("LEASE-A", "WI-001", { runtimeResources: ["global:verify"] });
    const second = lease("LEASE-B", "WI-002", { runtimeResources: ["global:verify"] });
    expect(evaluateLeaseRequest([first], second).status).toBe("BLOCKED");
  });

  it.each([".project/state.md", ".project/traceability.json", "plans/plan-first-release.md"])("并行工作禁止声明中央文件 %s", (path) => {
    expect(evaluateLeaseRequest([], lease("LEASE-A", "WI-001", { fileScopes: [{ path, kind: "file" }] }))).toMatchObject({ code: "CENTRAL_STATE_FORBIDDEN" });
  });

  it("租约存储拒绝竞争、冻结漂移现场且不自动释放", () => {
    const root = mkdtempSync(join(tmpdir(), "todo-leases-"));
    roots.push(root);
    const store = createLeaseStore(root, "CYCLE-v3.0");
    expect(store.acquire(lease("LEASE-A", "WI-001"), "2026-11-21T00:00:00Z").status).toBe("ACQUIRED");
    expect(store.acquire(lease("LEASE-B", "WI-002", { semanticResources: ["contract:WI-001"] }), "2026-11-21T00:00:01Z").status).toBe("BLOCKED");
    const frozen = store.freeze("LEASE-A", { code: "SCOPE_DRIFT" }, "2026-11-21T00:00:02Z");
    expect(frozen.status).toBe("FROZEN");
    expect(() => store.release("LEASE-A", "2026-11-21T00:00:03Z")).toThrow("人工处理");
  });

  it("批准范围内变化允许继续", () => {
    expect(evaluateDrift({ workItem: "WI-001", readable: true, approvedScopes: [{ path: "src/a", kind: "directory" }], baseline: { "src/a/one.ts": "1" }, current: { "src/a/one.ts": "2" }, approvedSemanticResources: [], semanticChanges: [], lastSafeState: "hash-1" })).toMatchObject({ status: "CONTINUE", changedPaths: ["src/a/one.ts"] });
  });

  it("路径越界或共享状态冲突立即停止并保留人工恢复建议", () => {
    const result = evaluateDrift({ workItem: "WI-001", readable: true, approvedScopes: [{ path: "src/a", kind: "directory" }], baseline: { "src/a/one.ts": "1", ".project/state.md": "old" }, current: { "src/a/one.ts": "2", ".project/state.md": "new" }, approvedSemanticResources: [], semanticChanges: ["state-contract"], lastSafeState: "hash-1" });
    expect(result).toMatchObject({ status: "STOPPED", code: "SCOPE_DRIFT", lastSafeState: "hash-1" });
    expect(result.conflicts).toEqual(expect.arrayContaining([{ type: "PATH_DRIFT", value: ".project/state.md" }, { type: "SEMANTIC_DRIFT", value: "state-contract" }]));
    expect(result.recovery).toContain("人工");
  });

  it("无法读取实际或共享变化时按冲突停止", () => {
    expect(evaluateDrift({ workItem: "WI-001", readable: false })).toMatchObject({ status: "STOPPED", code: "CHANGE_SET_UNREADABLE" });
    expect(evaluateDrift({ workItem: "WI-001", readable: true, approvedScopes: [], baseline: {}, current: {} })).toMatchObject({ status: "STOPPED", code: "CHANGE_SET_UNREADABLE" });
  });

  it("文件摘要确定且缺失范围失败关闭", () => {
    const root = mkdtempSync(join(tmpdir(), "todo-hash-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "hello", "utf8");
    const scopes = [{ path: "src", kind: "directory" }];
    expect(hashWorkspacePaths(root, scopes)).toEqual(hashWorkspacePaths(root, scopes));
    expect(() => hashWorkspacePaths(root, [{ path: "missing", kind: "directory" }])).toThrow("无法读取范围");
  });
});
