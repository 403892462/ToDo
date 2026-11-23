const PHASE2_STAGES = Object.freeze([
  "IDEA",
  "DISCOVERY",
  "REQUIREMENTS",
  "SOLUTION_DESIGN",
  "PLANNING",
  "IMPLEMENTATION",
  "ACCEPTANCE_AUDIT",
  "DELIVERY",
  "COMPLETED",
]);

const LEGACY_STAGES = Object.freeze(["VERIFICATION"]);
const STAGE_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "INVALIDATED"]);
const TRANSITIONS = new Set([
  "IDEA>REQUIREMENTS",
  "DISCOVERY>REQUIREMENTS",
  "REQUIREMENTS>SOLUTION_DESIGN",
  "SOLUTION_DESIGN>PLANNING",
  "PLANNING>IMPLEMENTATION",
  "IMPLEMENTATION>ACCEPTANCE_AUDIT",
  "ACCEPTANCE_AUDIT>IMPLEMENTATION",
  "ACCEPTANCE_AUDIT>DELIVERY",
  "DELIVERY>COMPLETED",
]);

function extractFrontMatter(markdown) {
  if (typeof markdown !== "string") {
    throw new Error("状态内容必须是字符串。")
  }
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error("状态文件缺少可解析的 YAML 区块。")
  }
  return match[1];
}

function requireScalar(frontMatter, name) {
  const match = frontMatter.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "m"));
  if (!match) {
    throw new Error(`状态文件缺少字段：${name}`);
  }
  return match[1].trim().replace(/^"|"$/g, "");
}

export function parseProjectState(markdown, { allowLegacy = true } = {}) {
  const frontMatter = extractFrontMatter(markdown);
  const schemaVersion = Number(requireScalar(frontMatter, "schema_version"));
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("schema_version 必须是正整数。")
  }

  const currentStage = requireScalar(frontMatter, "current_stage");
  const allowedStages = allowLegacy ? [...PHASE2_STAGES, ...LEGACY_STAGES] : PHASE2_STAGES;
  if (!allowedStages.includes(currentStage)) {
    throw new Error(`未知当前阶段：${currentStage}`);
  }

  const stageStatus = requireScalar(frontMatter, "stage_status");
  if (!new Set(["IN_PROGRESS", "COMPLETED"]).has(stageStatus)) {
    throw new Error(`未知当前阶段状态：${stageStatus}`);
  }

  const stagesStart = frontMatter.search(/^stages:\s*$/m);
  if (stagesStart < 0) {
    throw new Error("状态文件缺少 stages 映射。")
  }

  const stages = {};
  const stagesText = frontMatter.slice(stagesStart).split(/\r?\n/).slice(1);
  for (const line of stagesText) {
    if (!line.startsWith("  ")) {
      break;
    }
    const match = line.match(/^\s{2}([A-Z_]+):\s*([A-Z_]+)\s*$/);
    if (!match) {
      throw new Error(`无法解析阶段状态：${line.trim()}`);
    }
    if (!allowedStages.includes(match[1])) {
      throw new Error(`stages 包含未知阶段：${match[1]}`);
    }
    if (!STAGE_STATUSES.has(match[2])) {
      throw new Error(`阶段 ${match[1]} 使用未知状态：${match[2]}`);
    }
    stages[match[1]] = match[2];
  }
  if (!(currentStage in stages)) {
    throw new Error(`stages 未声明当前阶段：${currentStage}`);
  }

  const workflowContractMatch = frontMatter.match(/^workflow_contract:\s*"?([^"\r\n]+)"?\s*$/m);
  return {
    schemaVersion,
    workflowContract: workflowContractMatch?.[1]?.trim() ?? null,
    currentStage,
    stageStatus,
    stages,
  };
}

export function assertStageTransition(from, to, { allowLegacyCompletion = false } = {}) {
  if (allowLegacyCompletion && from === "IMPLEMENTATION" && to === "DELIVERY") {
    return;
  }
  if (!TRANSITIONS.has(`${from}>${to}`)) {
    throw new Error(`Phase 2 非法阶段转换：${from} → ${to}`);
  }
}

export function assertRequiredArtifacts(files) {
  const required = [
    ".project/state.md",
    "docs/discovery.md",
    "docs/requirements.md",
    "docs/acceptance-catalog.md",
    "docs/solution-design-v2.md",
    "plans/plan-first-release.md",
  ];
  const missing = required.filter((path) => typeof files[path] !== "string" || files[path].trim() === "");
  if (missing.length > 0) {
    throw new Error(`缺少或无法解析必需产物：${missing.join(", ")}`);
  }
  parseProjectState(files[".project/state.md"]);
}

export const phase2Contract = Object.freeze({
  version: "phase2-v2",
  stages: PHASE2_STAGES,
  legacyStages: LEGACY_STAGES,
});
