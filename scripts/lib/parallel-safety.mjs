import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { normalizeScope, scopeOverlap } from "./work-scheduler.mjs";

export const CENTRAL_STATE_PATHS = Object.freeze([
  ".project/state.md",
  ".project/traceability.json",
  "plans/plan-first-release.md",
]);

function uniqueStrings(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${name} 必须是非空字符串数组。`);
  return [...new Set(values)].sort();
}

function normalizeLease(lease) {
  if (!lease || typeof lease !== "object") throw new Error("租约必须是对象。");
  if (!/^LEASE-[A-Z0-9-]+$/.test(lease.leaseId ?? "")) throw new Error("租约编号格式无效。");
  if (!/^WI-\d{3}$/.test(lease.workItem ?? "")) throw new Error("工作项编号格式无效。");
  if (!new Set(["SERIAL", "PARALLEL"]).has(lease.mode)) throw new Error("租约模式无效。");
  if (!Array.isArray(lease.fileScopes) || lease.fileScopes.length === 0) throw new Error("租约必须声明文件范围。");
  return {
    leaseId: lease.leaseId,
    workItem: lease.workItem,
    mode: lease.mode,
    fileScopes: lease.fileScopes.map(normalizeScope),
    semanticResources: uniqueStrings(lease.semanticResources, "semanticResources"),
    runtimeResources: uniqueStrings(lease.runtimeResources, "runtimeResources"),
    runDirectory: normalizeScope({ path: lease.runDirectory, kind: "directory" }).path,
    status: lease.status ?? "ACTIVE",
  };
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

export function evaluateLeaseRequest(existingLeases, candidateInput) {
  let candidate;
  try {
    candidate = normalizeLease(candidateInput);
  } catch (error) {
    return { status: "BLOCKED", code: "INVALID_LEASE", reason: error.message, conflicts: [] };
  }
  if (candidate.mode === "PARALLEL" && candidate.fileScopes.some((scope) => CENTRAL_STATE_PATHS.some((path) => scopeOverlap(scope, { path, kind: "file" })))) {
    return { status: "BLOCKED", code: "CENTRAL_STATE_FORBIDDEN", reason: "并行工作项不得写入中央状态、计划或追踪矩阵。", conflicts: CENTRAL_STATE_PATHS };
  }
  const conflicts = [];
  for (const raw of existingLeases) {
    const current = normalizeLease(raw);
    if (current.status !== "ACTIVE" && current.status !== "FROZEN") continue;
    const reasons = [];
    if (candidate.fileScopes.some((left) => current.fileScopes.some((right) => scopeOverlap(left, right)))) reasons.push("文件范围冲突");
    const semantic = intersection(candidate.semanticResources, current.semanticResources);
    if (semantic.length > 0) reasons.push(`语义资源冲突：${semantic.join("、")}`);
    const runtime = intersection(candidate.runtimeResources, current.runtimeResources);
    if (runtime.length > 0) reasons.push(`运行资源冲突：${runtime.join("、")}`);
    if (candidate.runDirectory === current.runDirectory) reasons.push("运行目录未隔离");
    if (reasons.length > 0) conflicts.push({ leaseId: current.leaseId, workItem: current.workItem, reasons });
  }
  return conflicts.length > 0
    ? { status: "BLOCKED", code: "LEASE_CONFLICT", reason: "资源租约与活动工作冲突。", conflicts }
    : { status: "ACQUIRED", code: "LEASE_AVAILABLE", lease: candidate, conflicts: [] };
}

function expandFiles(root, requestedPaths) {
  const files = [];
  const visit = (absolute) => {
    const stat = statSync(absolute);
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) visit(join(absolute, name));
    else if (stat.isFile()) files.push(absolute);
  };
  for (const path of requestedPaths) {
    const scope = normalizeScope(path);
    const absolute = resolve(root, scope.path);
    if (!existsSync(absolute)) throw new Error(`无法读取范围：${scope.path}`);
    visit(absolute);
  }
  return [...new Set(files)].sort();
}

export function hashWorkspacePaths(root, scopes) {
  const hashes = {};
  for (const absolute of expandFiles(root, scopes)) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    hashes[path] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  }
  return hashes;
}

export function evaluateDrift(input) {
  const stop = (code, reason, conflicts = []) => ({ status: "STOPPED", code, workItem: input?.workItem ?? null, reason, conflicts, lastSafeState: input?.lastSafeState ?? null, recovery: "保留现场；由人工选择修复、接受变更或废弃运行。" });
  if (!input || !/^WI-\d{3}$/.test(input.workItem ?? "")) return stop("INVALID_DRIFT_INPUT", "工作项编号无效。");
  if (input.readable !== true || !input.baseline || !input.current) return stop("CHANGE_SET_UNREADABLE", "实际修改范围无法读取或判断。");
  let scopes;
  try {
    scopes = input.approvedScopes.map(normalizeScope);
  } catch (error) {
    return stop("INVALID_APPROVED_SCOPE", error.message);
  }
  const paths = [...new Set([...Object.keys(input.baseline), ...Object.keys(input.current)])].sort();
  const changed = paths.filter((path) => input.baseline[path] !== input.current[path]);
  const outside = changed.filter((path) => !scopes.some((scope) => scopeOverlap(scope, { path, kind: "file" })));
  const declaredSemantic = new Set(input.approvedSemanticResources ?? []);
  const semanticChanges = input.semanticChanges;
  if (!Array.isArray(semanticChanges)) return stop("CHANGE_SET_UNREADABLE", "共享状态变化无法读取或判断。");
  const undeclaredSemantic = semanticChanges.filter((resource) => !declaredSemantic.has(resource));
  const conflicts = [
    ...outside.map((path) => ({ type: "PATH_DRIFT", value: path })),
    ...undeclaredSemantic.map((resource) => ({ type: "SEMANTIC_DRIFT", value: resource })),
  ];
  if (conflicts.length > 0) return stop("SCOPE_DRIFT", "检测到未声明范围漂移或共享状态冲突。", conflicts);
  return { status: "CONTINUE", code: "NO_DRIFT", workItem: input.workItem, changedPaths: changed, lastSafeState: input.lastSafeState ?? null };
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function createLeaseStore(root, cycleId) {
  if (!/^CYCLE-v\d+\.\d+$/.test(cycleId)) throw new Error("周期编号格式无效。");
  const directory = join(root, ".project", "cycles", cycleId, "leases");
  const mutex = join(directory, ".mutex");
  const list = () => existsSync(directory)
    ? readdirSync(directory).filter((name) => /^LEASE-[A-Z0-9-]+\.json$/.test(name)).sort().map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
    : [];
  const withMutex = (operation) => {
    mkdirSync(directory, { recursive: true });
    const descriptor = openSync(mutex, "wx");
    closeSync(descriptor);
    try { return operation(); } finally { if (existsSync(mutex)) unlinkSync(mutex); }
  };
  return {
    list,
    acquire(candidate, now) {
      return withMutex(() => {
        const decision = evaluateLeaseRequest(list(), candidate);
        if (decision.status !== "ACQUIRED") return decision;
        const record = { schemaVersion: 1, ...decision.lease, status: "ACTIVE", acquiredAt: now };
        atomicJson(join(directory, `${record.leaseId}.json`), record);
        return { ...decision, lease: record };
      });
    },
    freeze(leaseId, conflict, now) {
      return withMutex(() => {
        const path = join(directory, `${leaseId}.json`);
        if (!existsSync(path)) throw new Error("租约不存在。");
        const record = JSON.parse(readFileSync(path, "utf8"));
        if (record.status !== "ACTIVE") throw new Error("只有活动租约可以冻结。");
        const frozen = { ...record, status: "FROZEN", frozenAt: now, conflict };
        atomicJson(path, frozen);
        return frozen;
      });
    },
    release(leaseId, now) {
      return withMutex(() => {
        const path = join(directory, `${leaseId}.json`);
        if (!existsSync(path)) throw new Error("租约不存在。");
        const record = JSON.parse(readFileSync(path, "utf8"));
        if (record.status === "FROZEN") throw new Error("冻结租约必须由人工处理，禁止自动释放。");
        const released = { ...record, status: "RELEASED", releasedAt: now };
        atomicJson(path, released);
        return released;
      });
    },
  };
}
