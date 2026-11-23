import { posix, win32 } from "node:path";

const ID_PATTERN = /^WI-\d{3}$/;
const GLOB_PATTERN = /[*?{}[\]]/;

export function normalizeScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error("文件范围必须是对象。");
  if (!new Set(["file", "directory"]).has(scope.kind)) throw new Error("文件范围 kind 必须是 file 或 directory。");
  if (typeof scope.path !== "string" || scope.path.trim() === "") throw new Error("文件范围路径不能为空。");
  const raw = scope.path.replaceAll("\\", "/");
  if (posix.isAbsolute(raw) || win32.isAbsolute(scope.path)) throw new Error(`拒绝绝对路径：${scope.path}`);
  if (GLOB_PATTERN.test(raw)) throw new Error(`拒绝未解析通配符：${scope.path}`);
  const segments = raw.split("/");
  if (segments.includes("..")) throw new Error(`拒绝目录穿越：${scope.path}`);
  const path = posix.normalize(raw).replace(/^\.\//, "").replace(/\/$/, "");
  if (["", ".", "/"].includes(path)) throw new Error("拒绝项目根目录范围。");
  return { path, kind: scope.kind };
}

export function scopeOverlap(left, right) {
  if (left.path === right.path) return true;
  if (left.kind === "directory" && right.path.startsWith(`${left.path}/`)) return true;
  if (right.kind === "directory" && left.path.startsWith(`${right.path}/`)) return true;
  return false;
}

function intersections(left = [], right = []) {
  const set = new Set(left);
  return [...new Set(right.filter((value) => set.has(value)))].sort();
}

function normalizeItem(item) {
  if (!item || typeof item !== "object" || !ID_PATTERN.test(item.id ?? "")) throw new Error("工作项编号格式无效。");
  const dependsOn = [...new Set(item.dependsOn ?? [])].sort();
  if (dependsOn.some((id) => !ID_PATTERN.test(id)) || dependsOn.includes(item.id)) throw new Error(`工作项 ${item.id} 的依赖无效。`);
  const stringList = (name) => {
    if (item[name] === undefined) return null;
    const values = item[name];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "")) throw new Error(`工作项 ${item.id} 的 ${name} 无效。`);
    return [...new Set(values)].sort();
  };
  const scopes = item.fileScopes === undefined ? null : item.fileScopes.map(normalizeScope).sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  return {
    id: item.id,
    dependsOn,
    fileScopes: scopes,
    semanticResources: stringList("semanticResources"),
    runtimeResources: stringList("runtimeResources"),
    isolation: item.isolation ?? "UNKNOWN",
  };
}

function topoLevels(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const missing = items.flatMap((item) => item.dependsOn.filter((id) => !byId.has(id)).map((id) => `${item.id}→${id}`));
  if (missing.length > 0) return { blocked: `依赖引用不存在：${missing.sort().join("、")}` };
  const remaining = new Set(byId.keys());
  const completed = new Set();
  const levels = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => byId.get(id).dependsOn.every((dependency) => completed.has(dependency))).sort();
    if (ready.length === 0) return { blocked: `存在循环依赖：${[...remaining].sort().join("、")}` };
    levels.push(ready.map((id) => byId.get(id)));
    ready.forEach((id) => { remaining.delete(id); completed.add(id); });
  }
  return { levels };
}

function parallelSafety(left, right) {
  const reasons = [];
  if (left.fileScopes === null || right.fileScopes === null || left.fileScopes.length === 0 || right.fileScopes.length === 0) reasons.push("文件范围缺失");
  else if (left.fileScopes.some((a) => right.fileScopes.some((b) => scopeOverlap(a, b)))) reasons.push("文件范围重叠");
  if (left.semanticResources === null || right.semanticResources === null) reasons.push("语义资源声明缺失");
  else {
    const semantic = intersections(left.semanticResources, right.semanticResources);
    if (semantic.length > 0) reasons.push(`语义资源冲突：${semantic.join("、")}`);
  }
  if (left.runtimeResources === null || right.runtimeResources === null) reasons.push("运行资源声明缺失");
  else {
    const runtime = intersections(left.runtimeResources, right.runtimeResources);
    if (runtime.length > 0) reasons.push(`运行资源冲突：${runtime.join("、")}`);
  }
  if (left.isolation !== "PROVEN" || right.isolation !== "PROVEN") reasons.push("运行隔离未证明");
  return { safe: reasons.length === 0, reasons };
}

export function buildSchedule(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.items) || input.items.length === 0) throw new Error("调度输入必须包含工作项。");
  let items;
  try {
    items = input.items.map(normalizeItem);
  } catch (error) {
    return { status: "BLOCKED", code: "INVALID_SCOPE", reason: error.message, groups: [], order: [], conflicts: [] };
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) return { status: "BLOCKED", code: "DUPLICATE_WORK_ITEM", reason: "工作项编号重复。", groups: [], order: [], conflicts: [] };
  const graph = topoLevels(items);
  if (graph.blocked) return { status: "BLOCKED", code: "INVALID_DEPENDENCY_GRAPH", reason: graph.blocked, groups: [], order: [], conflicts: [] };

  const groups = [];
  const conflicts = [];
  for (const level of graph.levels) {
    const levelGroups = [];
    for (const item of level) {
      let selected = null;
      for (const group of levelGroups) {
        const checks = group.items.map((member) => ({ member, result: parallelSafety(item, member) }));
        if (checks.every((check) => check.result.safe)) { selected = group; break; }
        for (const check of checks.filter((entry) => !entry.result.safe)) {
          conflicts.push({ items: [check.member.id, item.id].sort(), reasons: check.result.reasons });
        }
      }
      if (selected) selected.items.push(item);
      else levelGroups.push({ items: [item] });
    }
    for (const group of levelGroups) {
      const itemIds = group.items.map((item) => item.id).sort();
      groups.push({ mode: itemIds.length > 1 ? "PARALLEL" : "SERIAL", itemIds, safety: itemIds.length > 1 ? ["无依赖", "文件范围不重叠", "语义资源无冲突", "运行资源无冲突", "隔离已证明"] : ["保守串行"] });
    }
  }
  const uniqueConflicts = [...new Map(conflicts.map((entry) => [`${entry.items.join("|")}|${entry.reasons.join("|")}`, entry])).values()];
  return { status: "READY", code: "SCHEDULE_READY", groups, order: groups.flatMap((group) => group.itemIds), conflicts: uniqueConflicts };
}

export const schedulerContract = Object.freeze({
  isolationAccepted: "PROVEN",
  defaultMode: "SERIAL",
  pathFormat: "project-relative-posix",
});
