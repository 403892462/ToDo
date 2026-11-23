import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProjectState } from "./project-contract.mjs";

const ARTIFACT_TYPES = new Set(["solution", "work-item", "test", "evidence"]);
const ARTIFACT_STATUSES = new Set(["VALID", "PENDING", "IN_PROGRESS", "INVALIDATED"]);

function duplicateIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) throw new Error(`${label}存在重复或空编号：${item?.id ?? "<空>"}`);
    seen.add(item.id);
  }
}

export function validateTraceability(
  matrix,
  { root = process.cwd(), strict = false, allowInvalidated = false, checkFiles = true } = {},
) {
  if (!matrix || matrix.schemaVersion !== 1 || !Array.isArray(matrix.requirements) || !Array.isArray(matrix.artifacts)) {
    throw new Error("追踪矩阵缺少 schemaVersion、requirements 或 artifacts。")
  }
  duplicateIds(matrix.requirements, "需求");
  duplicateIds(matrix.artifacts, "产物");
  const requirements = new Map(matrix.requirements.map((item) => [item.id, item]));
  const artifacts = new Map(matrix.artifacts.map((item) => [item.id, item]));

  for (const requirement of matrix.requirements) {
    if (!/^FR-\d{3}$/.test(requirement.id)) throw new Error(`需求编号无效：${requirement.id}`);
    for (const field of ["solutions", "workItems", "tests", "evidence"]) {
      if (!Array.isArray(requirement[field]) || requirement[field].length === 0) {
        if (!requirement.notApplicableReason?.trim()) throw new Error(`${requirement.id} 缺少 ${field} 且无不适用理由。`);
        continue;
      }
      for (const id of requirement[field]) {
        const artifact = artifacts.get(id);
        if (!artifact) throw new Error(`${requirement.id} 引用了不存在的产物：${id}`);
        if (!allowInvalidated && artifact.status === "INVALIDATED") throw new Error(`${requirement.id} 引用了已失效产物：${id}`);
      }
    }
  }

  for (const artifact of matrix.artifacts) {
    if (!ARTIFACT_TYPES.has(artifact.type)) throw new Error(`${artifact.id} 使用未知产物类型：${artifact.type}`);
    if (!ARTIFACT_STATUSES.has(artifact.status)) throw new Error(`${artifact.id} 使用未知产物状态：${artifact.status}`);
    if (!Array.isArray(artifact.requirements) || artifact.requirements.length === 0) throw new Error(`${artifact.id} 缺少反向需求引用。`);
    for (const requirementId of artifact.requirements) {
      const requirement = requirements.get(requirementId);
      if (!requirement) throw new Error(`${artifact.id} 反向引用了不存在的需求：${requirementId}`);
      const forward = [...requirement.solutions, ...requirement.workItems, ...requirement.tests, ...requirement.evidence];
      if (!forward.includes(artifact.id)) throw new Error(`${artifact.id} 与 ${requirementId} 的反向引用没有对应正向链接。`);
    }
    if (strict && artifact.status !== "VALID") throw new Error(`独立验收前产物必须为 VALID：${artifact.id} (${artifact.status})`);
    if (checkFiles && (artifact.status === "VALID" || artifact.status === "IN_PROGRESS") && !existsSync(resolve(root, artifact.path))) {
      throw new Error(`${artifact.id} 的文件不存在：${artifact.path}`);
    }
  }
  return { requirementCount: requirements.size, artifactCount: artifacts.size };
}

export function analyzeChangeImpact(matrix, specification) {
  validateTraceability(matrix, { checkFiles: false });
  if (!specification || !/^CHG-\d{3}$/.test(specification.changeId ?? "")) throw new Error("影响分析缺少有效 changeId。")
  if (!Array.isArray(specification.requirementIds) || specification.requirementIds.length === 0) throw new Error("影响分析缺少 requirementIds。")
  const requirementMap = new Map(matrix.requirements.map((item) => [item.id, item]));
  const known = new Set();
  for (const requirementId of specification.requirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`变更引用了不存在的需求：${requirementId}`);
    [...requirement.solutions, ...requirement.workItems, ...requirement.tests, ...requirement.evidence].forEach((id) => known.add(id));
  }
  const declared = new Set(specification.affectedArtifactIds ?? []);
  const omitted = [...known].filter((id) => !declared.has(id));
  const unknown = [...declared].filter((id) => !matrix.artifacts.some((artifact) => artifact.id === id));
  const complete = specification.impactComplete === true && omitted.length === 0 && unknown.length === 0;
  return {
    changeId: specification.changeId,
    status: complete ? "READY" : "NEEDS_CONFIRMATION",
    requirementIds: specification.requirementIds,
    affectedArtifactIds: [...known],
    omittedArtifactIds: omitted,
    unknownArtifactIds: unknown,
  };
}

export function applyChangeImpact(matrix, analysis) {
  if (analysis.status !== "READY") throw new Error("影响范围尚未确定，不能应用失效。")
  const affected = new Set(analysis.affectedArtifactIds);
  return {
    ...matrix,
    artifacts: matrix.artifacts.map((artifact) =>
      affected.has(artifact.id) ? { ...artifact, status: "INVALIDATED", invalidatedBy: analysis.changeId } : artifact,
    ),
  };
}

export function renderImpactReport(analysis) {
  const groups = { solution: [], "work-item": [], test: [], evidence: [] };
  for (const artifact of analysis.artifacts ?? []) groups[artifact.type]?.push(artifact.id);
  const show = (items) => (items.length > 0 ? items.join("、") : "无");
  return `# 需求变更影响报告

- 变更编号：${analysis.changeId}
- 分析状态：${analysis.status}
- 受影响需求：${analysis.requirementIds.join("、")}
- 受影响方案：${show(groups.solution)}
- 受影响工作项：${show(groups["work-item"])}
- 受影响测试：${show(groups.test)}
- 受影响证据：${show(groups.evidence)}
- 遗漏产物：${show(analysis.omittedArtifactIds)}
- 未知产物：${show(analysis.unknownArtifactIds)}
- 后续恢复入口：重新完成方案、规划、执行与独立验收。
`;
}

function collectDefinitions(content, pattern) {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(pattern)].map((match) => match[1]);
}

export function validateRepositoryContract(files, { root = process.cwd() } = {}) {
  const required = [
    ".project/state.md", ".project/traceability.json", "docs/requirements.md", "docs/acceptance-catalog.md",
    "docs/solution-design-v2.md", "docs/change-log.md", "docs/decision-log.md", "plans/plan-first-release.md",
  ];
  for (const path of required) if (typeof files[path] !== "string" || files[path].trim() === "") throw new Error(`必需产物缺失或为空：${path}`);
  const state = parseProjectState(files[".project/state.md"]);
  const matrix = JSON.parse(files[".project/traceability.json"]);
  const strict = ["ACCEPTANCE_AUDIT", "DELIVERY", "COMPLETED"].includes(state.currentStage);
  const result = validateTraceability(matrix, { root, strict });
  const definitions = [
    ...collectDefinitions(files["docs/requirements.md"], /^### ((?:GOAL|FR|ASM)-\d{3})\b/gm),
    ...collectDefinitions(files["docs/requirements.md"], /^- `(BR-\d{3})`/gm),
    ...collectDefinitions(files["docs/acceptance-catalog.md"], /^## (AC-\d{3})\b/gm),
    ...collectDefinitions(files["docs/change-log.md"], /^## (CHG-\d{3})\b/gm),
    ...collectDefinitions(files["docs/decision-log.md"], /^## (DEC-\d{3})\b/gm),
    ...collectDefinitions(files["plans/plan-first-release.md"], /^## (WI-\d{3})\b/gm),
  ];
  duplicateIds(definitions.map((id) => ({ id })), "稳定编号");
  const requirements = new Set(collectDefinitions(files["docs/requirements.md"], /^### (FR-\d{3})\b/gm));
  for (const requirement of matrix.requirements) if (!requirements.has(requirement.id)) throw new Error(`追踪需求未在基线定义：${requirement.id}`);
  if (!/^唯一验证命令：`npm run verify`\s*$/m.test(files["plans/plan-first-release.md"])) throw new Error("实施计划的唯一验证命令不是 npm run verify。")
  return { ...result, definitionCount: definitions.length, strict };
}

export function readRepositoryFiles(root) {
  const paths = [
    ".project/state.md", ".project/traceability.json", "docs/requirements.md", "docs/acceptance-catalog.md",
    "docs/solution-design-v2.md", "docs/change-log.md", "docs/decision-log.md", "plans/plan-first-release.md",
  ];
  return Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]));
}

export function saveJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function saveText(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}
