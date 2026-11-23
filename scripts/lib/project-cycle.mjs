import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const VERSION_PATTERN = /^v(\d+)\.(\d+)$/;
const DEFAULT_SNAPSHOT_PATHS = Object.freeze([
  ".project/state.md",
  ".project/traceability.json",
  "docs/discovery.md",
  "docs/requirements.md",
  "docs/acceptance-catalog.md",
  "docs/solution-design-v2.md",
  "plans/plan-first-release.md",
  "docs/delivery.md",
]);

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version ?? "");
  if (!match) throw new Error(`版本号必须使用 v主版本.次版本 格式：${version ?? "空"}`);
  return [Number(match[1]), Number(match[2])];
}

export function compareVersions(left, right) {
  const [leftMajor, leftMinor] = parseVersion(left);
  const [rightMajor, rightMinor] = parseVersion(right);
  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} 不能为空。`);
  return value.trim();
}

function stateScalar(markdown, name) {
  const match = markdown.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "m"));
  if (!match) throw new Error(`状态文件缺少字段：${name}`);
  return match[1].trim().replace(/^"|"$/g, "");
}

function replaceStateScalar(markdown, name, value) {
  const pattern = new RegExp(`^${name}:\\s*[^\\r\\n]+$`, "m");
  if (!pattern.test(markdown)) throw new Error(`状态文件缺少字段：${name}`);
  return markdown.replace(pattern, `${name}: ${value}`);
}

function replaceStage(markdown, stage, status) {
  const pattern = new RegExp(`^  ${stage}:\\s*[A-Z_]+$`, "m");
  if (!pattern.test(markdown)) throw new Error(`状态文件缺少阶段：${stage}`);
  return markdown.replace(pattern, `  ${stage}: ${status}`);
}

export function renderDiscoveryState(markdown, timestamp) {
  let next = markdown;
  next = replaceStateScalar(next, "current_stage", "DISCOVERY");
  next = replaceStateScalar(next, "stage_status", "IN_PROGRESS");
  next = replaceStateScalar(next, "requirements_baseline", "null");
  next = replaceStateScalar(next, "verification_command", "null");
  next = replaceStateScalar(next, "active_work_item", "null");
  next = replaceStateScalar(next, "active_run", "null");
  next = replaceStateScalar(next, "updated_at", `"${timestamp}"`);
  next = replaceStage(next, "IDEA", "COMPLETED");
  next = replaceStage(next, "DISCOVERY", "IN_PROGRESS");
  for (const stage of [
    "REQUIREMENTS",
    "SOLUTION_DESIGN",
    "PLANNING",
    "IMPLEMENTATION",
    "VERIFICATION",
    "ACCEPTANCE_AUDIT",
    "DELIVERY",
    "COMPLETED",
  ]) {
    next = replaceStage(next, stage, "INVALIDATED");
  }
  return next;
}

function headingBlocks(markdown, level) {
  const marker = "#".repeat(level);
  const pattern = new RegExp(`^${marker} (?!#).+$`, "gm");
  const matches = [...markdown.matchAll(pattern)];
  return matches.map((match, index) => ({
    heading: match[0],
    content: markdown.slice(match.index, matches[index + 1]?.index ?? markdown.length).trim(),
  }));
}

export function selectBaselineSection(markdown, version, { headingLevel = 1 } = {}) {
  parseVersion(version);
  const marker = `Requirements Baseline ${version}`;
  const matches = headingBlocks(markdown, headingLevel).filter((block) => block.content.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`基线 ${version} 必须唯一匹配一个 ${headingLevel} 级文档段落，实际为 ${matches.length} 个。`);
  }
  return matches[0].content;
}

export function selectVersionedGate(markdown, gateName, version, { headingLevel = 2 } = {}) {
  parseVersion(version);
  const escapedGate = gateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedVersion = version.replace(".", "\\.");
  const marker = "#".repeat(headingLevel);
  const headingPattern = new RegExp(`^${marker} ${escapedGate}（${escapedVersion}）(?:确认)?\\s*$`);
  const matches = headingBlocks(markdown, headingLevel).filter((block) => headingPattern.test(block.heading));
  if (matches.length !== 1) {
    throw new Error(`${gateName}（${version}）必须唯一存在，实际为 ${matches.length} 个。`);
  }
  return matches[0].content;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function projectPath(root, path) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, absolute).replaceAll("\\", "/");
  if (rel.startsWith("../") || rel === ".." || rel === "") throw new Error(`非法项目相对路径：${path}`);
  return { absolute, relative: rel };
}

export function buildCycleSnapshot(root, version, paths = DEFAULT_SNAPSHOT_PATHS, timestamp = new Date().toISOString()) {
  parseVersion(version);
  const files = paths.map((path) => {
    const resolved = projectPath(root, path);
    if (!existsSync(resolved.absolute)) throw new Error(`历史快照缺少文件：${resolved.relative}`);
    return {
      path: resolved.relative,
      sha256: sha256(readFileSync(resolved.absolute)),
    };
  });
  return {
    schemaVersion: 1,
    cycleId: `CYCLE-${version}`,
    version,
    capturedAt: timestamp,
    files,
  };
}

export function parseCycleRegistry(content) {
  const registry = typeof content === "string" ? JSON.parse(content) : content;
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.cycles)) {
    throw new Error("周期注册表结构无效。")
  }
  const ids = new Set();
  const versions = new Set();
  for (const cycle of registry.cycles) {
    requireText(cycle.cycleId, "cycleId");
    parseVersion(cycle.version);
    if (ids.has(cycle.cycleId) || versions.has(cycle.version)) throw new Error("周期编号或版本重复。")
    ids.add(cycle.cycleId);
    versions.add(cycle.version);
  }
  if (registry.activeCycleId !== null && !ids.has(registry.activeCycleId)) {
    throw new Error("活动周期引用不存在。")
  }
  return registry;
}

function assertStartConditions(root, state, newVersion) {
  if (stateScalar(state, "current_stage") !== "COMPLETED" || stateScalar(state, "stage_status") !== "COMPLETED") {
    throw new Error("只有已完成项目才能启动下一版本周期。")
  }
  if (stateScalar(state, "active_work_item") !== "null" || stateScalar(state, "active_run") !== "null") {
    throw new Error("存在活动工作项或运行，不能启动下一版本周期。")
  }
  const previousVersion = stateScalar(state, "requirements_baseline");
  if (compareVersions(newVersion, previousVersion) <= 0) throw new Error("新周期版本必须高于当前完成版本。")
  if (existsSync(join(root, ".project", "lock.md"))) throw new Error("项目锁存在，不能启动下一版本周期。")
  const loopPath = join(root, ".project", "audit-loop.json");
  if (existsSync(loopPath)) {
    const loop = JSON.parse(readFileSync(loopPath, "utf8"));
    if (loop.status !== "CLOSED") throw new Error("审计修复循环尚未关闭。")
  }
  return previousVersion;
}

export function prepareCycleStart(root, request, { now = new Date().toISOString(), snapshotPaths } = {}) {
  const version = requireText(request?.version, "version");
  parseVersion(version);
  const title = requireText(request?.title, "title");
  const owner = requireText(request?.owner, "owner");
  const reason = requireText(request?.reason, "reason");
  const statePath = join(root, ".project", "state.md");
  if (!existsSync(statePath)) throw new Error("缺少项目状态文件。")
  const originalState = readFileSync(statePath, "utf8");
  const previousVersion = assertStartConditions(root, originalState, version);
  const snapshot = buildCycleSnapshot(root, previousVersion, snapshotPaths, now);
  const registryPath = join(root, ".project", "cycles", "index.json");
  const existing = existsSync(registryPath)
    ? parseCycleRegistry(readFileSync(registryPath, "utf8"))
    : { schemaVersion: 1, projectId: stateScalar(originalState, "project_id"), activeCycleId: null, cycles: [] };
  if (existing.cycles.some((cycle) => cycle.version === version)) throw new Error(`周期版本已存在：${version}`);
  if (existing.activeCycleId) {
    const active = existing.cycles.find((cycle) => cycle.cycleId === existing.activeCycleId);
    if (!active || active.status !== "COMPLETED" || active.version !== previousVersion) {
      throw new Error("注册表活动周期与当前完成状态不一致。")
    }
  }
  const previousCycleId = `CYCLE-${previousVersion}`;
  const snapshotRelative = `.project/cycles/snapshots/${previousCycleId}.json`;
  const cycles = existing.cycles.map((cycle) =>
    cycle.cycleId === existing.activeCycleId ? { ...cycle, status: "COMPLETED", snapshotPath: snapshotRelative } : cycle,
  );
  if (!cycles.some((cycle) => cycle.cycleId === previousCycleId)) {
    cycles.push({
      cycleId: previousCycleId,
      version: previousVersion,
      title: `历史周期 ${previousVersion}`,
      owner,
      reason: "由下一版本启动器建立完成快照。",
      status: "COMPLETED",
      startedAt: null,
      completedAt: now,
      previousCycleId: null,
      snapshotPath: snapshotRelative,
    });
  }
  const cycleId = `CYCLE-${version}`;
  cycles.push({
    cycleId,
    version,
    title,
    owner,
    reason,
    status: "ACTIVE",
    startedAt: now,
    completedAt: null,
    previousCycleId,
    snapshotPath: null,
  });
  return {
    cycleId,
    previousCycleId,
    files: [
      { path: snapshotRelative, content: `${JSON.stringify(snapshot, null, 2)}\n`, mustNotExist: true },
      {
        path: ".project/cycles/index.json",
        content: `${JSON.stringify({ ...existing, activeCycleId: cycleId, cycles }, null, 2)}\n`,
      },
      { path: ".project/state.md", content: renderDiscoveryState(originalState, now) },
    ],
  };
}

export function transactionalWrite(root, files, operations = {}) {
  const write = operations.writeFile ?? writeFileSync;
  const rename = operations.renameFile ?? renameSync;
  const remove = operations.removeFile ?? rmSync;
  const exists = operations.exists ?? existsSync;
  const makeDirectory = operations.makeDirectory ?? mkdirSync;
  const prepared = files.map((file) => {
    const target = projectPath(root, file.path).absolute;
    if (file.mustNotExist && exists(target)) throw new Error(`目标已存在，禁止覆盖：${file.path}`);
    makeDirectory(dirname(target), { recursive: true });
    return {
      ...file,
      target,
      temporary: `${target}.tmp-${randomUUID()}`,
      backup: `${target}.bak-${randomUUID()}`,
      hadOriginal: exists(target),
      installed: false,
      backedUp: false,
    };
  });
  try {
    for (const file of prepared) write(file.temporary, file.content, "utf8");
    for (const file of prepared) {
      if (file.hadOriginal) {
        rename(file.target, file.backup);
        file.backedUp = true;
      }
      rename(file.temporary, file.target);
      file.installed = true;
    }
    for (const file of prepared) if (file.backedUp && exists(file.backup)) remove(file.backup, { force: true });
  } catch (error) {
    for (const file of [...prepared].reverse()) {
      if (file.installed && exists(file.target)) remove(file.target, { force: true });
      if (file.backedUp && exists(file.backup)) rename(file.backup, file.target);
      if (exists(file.temporary)) remove(file.temporary, { force: true });
    }
    throw error;
  }
}

export function startCycle(root, request, options = {}) {
  const prepared = prepareCycleStart(root, request, options);
  transactionalWrite(root, prepared.files, options.operations);
  return { cycleId: prepared.cycleId, previousCycleId: prepared.previousCycleId };
}

export const cycleContract = Object.freeze({
  schemaVersion: 1,
  snapshotPaths: DEFAULT_SNAPSHOT_PATHS,
});
