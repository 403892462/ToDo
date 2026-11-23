import { describe, expect, it } from "vitest";
import { buildSchedule, normalizeScope } from "./work-scheduler.mjs";

const item = (id, overrides = {}) => ({ id, dependsOn: [], fileScopes: [{ path: `src/${id}.ts`, kind: "file" }], semanticResources: [], runtimeResources: [], isolation: "PROVEN", ...overrides });

describe("保守工作调度器", () => {
  it("直接和传递依赖保持稳定串行顺序", () => {
    const result = buildSchedule({ items: [item("WI-003", { dependsOn: ["WI-002"] }), item("WI-001"), item("WI-002", { dependsOn: ["WI-001"] })] });
    expect(result.order).toEqual(["WI-001", "WI-002", "WI-003"]);
    expect(result.groups.every((group) => group.mode === "SERIAL")).toBe(true);
  });

  it("无依赖且所有安全条件成立时形成稳定并行组", () => {
    const input = { items: [item("WI-002"), item("WI-001")] };
    const result = buildSchedule(input);
    expect(result.groups).toEqual([{ mode: "PARALLEL", itemIds: ["WI-001", "WI-002"], safety: ["无依赖", "文件范围不重叠", "语义资源无冲突", "运行资源无冲突", "隔离已证明"] }]);
    expect(result).toEqual(buildSchedule(structuredClone(input)));
  });

  it("循环或缺失依赖整体阻塞", () => {
    expect(buildSchedule({ items: [item("WI-001", { dependsOn: ["WI-002"] }), item("WI-002", { dependsOn: ["WI-001"] })] })).toMatchObject({ status: "BLOCKED", code: "INVALID_DEPENDENCY_GRAPH" });
    expect(buildSchedule({ items: [item("WI-001", { dependsOn: ["WI-999"] })] }).reason).toContain("不存在");
  });

  it.each([
    ["文件范围缺失", { fileScopes: [] }],
    ["目录包含文件", { fileScopes: [{ path: "src", kind: "directory" }] }],
    ["语义资源冲突", { semanticResources: ["project-state"] }],
    ["运行资源冲突", { runtimeResources: ["full-verify"] }],
    ["隔离未证明", { isolation: "UNKNOWN" }],
    ["语义资源声明缺失", { semanticResources: undefined }],
    ["运行资源声明缺失", { runtimeResources: undefined }],
  ])("%s 时保守退化为串行", (_name, override) => {
    const left = item("WI-001", override);
    const rightOverrides = _name === "目录包含文件" ? { fileScopes: [{ path: "src/a.ts", kind: "file" }] } : override;
    const result = buildSchedule({ items: [left, item("WI-002", rightOverrides)] });
    expect(result.status).toBe("READY");
    expect(result.groups.map((group) => group.mode)).toEqual(["SERIAL", "SERIAL"]);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it.each(["/etc/passwd", "C:\\temp\\x", "../secret", "src/*.ts", "."])("拒绝危险范围 %s", (path) => {
    expect(() => normalizeScope({ path, kind: "file" })).toThrow();
    expect(buildSchedule({ items: [item("WI-001", { fileScopes: [{ path, kind: "file" }] })] }).status).toBe("BLOCKED");
  });

  it("规范化分隔符、去重资源且不改变调用方输入", () => {
    const input = { items: [item("WI-001", { fileScopes: [{ path: "src\\a.ts", kind: "file" }], semanticResources: ["api", "api"] })] };
    const before = structuredClone(input);
    expect(buildSchedule(input).status).toBe("READY");
    expect(input).toEqual(before);
  });
});
