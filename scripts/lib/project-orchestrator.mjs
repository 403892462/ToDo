import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseProjectState } from "./project-contract.mjs";
import {
  parseCycleRegistry,
  selectBaselineSection,
  selectVersionedGate,
} from "./project-cycle.mjs";

export const HUMAN_GATES = Object.freeze([
  "GATE_1",
  "GATE_2",
  "UI_GATE",
  "SOLUTION_DESIGN",
  "IMPLEMENTATION_PLAN",
  "GATE_3",
]);

const KNOWN_GATE_STATUSES = new Set(["APPROVED", "PENDING", "NOT_APPLICABLE"]);

function stateScalar(markdown, name) {
  const match = markdown.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "m"));
  if (!match) throw new Error(`状态文件缺少字段：${name}`);
  return match[1].trim().replace(/^"|"$/g, "");
}

function approvalStatus(section) {
  const match = section.match(/^- 状态：(APPROVED|PENDING|NOT_APPLICABLE)\s*$/m);
  return match?.[1] ?? "PENDING";
}

function result(status, code, reason, action = null, evidence = []) {
  return { status, code, reason, action, evidence: [...evidence].sort() };
}

function validateFacts(facts) {
  const errors = [];
  if (!facts || typeof facts !== "object") return ["编排事实必须是对象。"];
  if (typeof facts.cycleId !== "string" || facts.cycleId === "") errors.push("缺少活动周期编号。");
  if (typeof facts.version !== "string" || !/^v\d+\.\d+$/.test(facts.version)) errors.push("缺少有效活动版本。");
  if (!facts.state || typeof facts.state.currentStage !== "string") errors.push("缺少当前阶段。");
  for (const gate of HUMAN_GATES) {
    if (!KNOWN_GATE_STATUSES.has(facts.gates?.[gate])) errors.push(`人工 Gate 状态无效：${gate}`);
  }
  for (const item of facts.missingArtifacts ?? []) errors.push(`缺少必需产物：${item}`);
  for (const item of facts.contradictions ?? []) errors.push(item);
  return [...new Set(errors)].sort();
}

function waitForGate(gate, facts) {
  return result(
    "WAITING_HUMAN",
    `WAIT_${gate}`,
    `${gate} 必须由项目负责人批准，编排器不得代替确认。`,
    null,
    facts.gateEvidence?.[gate] ? [facts.gateEvidence[gate]] : [],
  );
}

function requireApprovedGate(gate, facts, nextAction) {
  if (facts.gates[gate] !== "APPROVED" && facts.gates[gate] !== "NOT_APPLICABLE") return waitForGate(gate, facts);
  return result("ACTIONABLE", nextAction, `前置人工 Gate ${gate} 已满足。`, nextAction, [facts.gateEvidence?.[gate]].filter(Boolean));
}

export function decideNextAction(facts) {
  const errors = validateFacts(facts);
  if (errors.length > 0) return result("BLOCKED", "INVALID_FACTS", errors.join("；"), null, errors);
  const { currentStage, stageStatus, activeRun, activeWorkItem } = facts.state;
  if (currentStage === "COMPLETED") return result("COMPLETED", "CYCLE_COMPLETED", "当前周期已经完成。", null);
  if (stageStatus !== "IN_PROGRESS") {
    return result("BLOCKED", "INVALID_STAGE_STATUS", `非完成阶段必须为 IN_PROGRESS，实际为 ${stageStatus}。`, null);
  }
  const requiredPreviousGates = {
    REQUIREMENTS: ["GATE_1"],
    SOLUTION_DESIGN: ["GATE_1", "GATE_2"],
    PLANNING: ["GATE_1", "GATE_2", "SOLUTION_DESIGN"],
    IMPLEMENTATION: ["GATE_1", "GATE_2", "UI_GATE", "SOLUTION_DESIGN", "IMPLEMENTATION_PLAN"],
    ACCEPTANCE_AUDIT: ["GATE_1", "GATE_2", "UI_GATE", "SOLUTION_DESIGN", "IMPLEMENTATION_PLAN"],
    DELIVERY: ["GATE_1", "GATE_2", "UI_GATE", "SOLUTION_DESIGN", "IMPLEMENTATION_PLAN"],
  };
  const invalidPrevious = (requiredPreviousGates[currentStage] ?? []).filter(
    (gate) => !["APPROVED", "NOT_APPLICABLE"].includes(facts.gates[gate]),
  );
  if (invalidPrevious.length > 0) {
    return result(
      "BLOCKED",
      "INVALID_GATE_SEQUENCE",
      `当前阶段缺少已批准的前置 Gate：${invalidPrevious.join("、")}。`,
      null,
      invalidPrevious,
    );
  }

  if (currentStage === "IDEA" || currentStage === "DISCOVERY") {
    return requireApprovedGate("GATE_1", facts, "ADVANCE_TO_REQUIREMENTS");
  }
  if (currentStage === "REQUIREMENTS") {
    return requireApprovedGate("GATE_2", facts, "ADVANCE_TO_SOLUTION_DESIGN");
  }
  if (currentStage === "SOLUTION_DESIGN") {
    return requireApprovedGate("SOLUTION_DESIGN", facts, "ADVANCE_TO_PLANNING");
  }
  if (currentStage === "PLANNING") {
    if (facts.gates.UI_GATE === "PENDING") return waitForGate("UI_GATE", facts);
    return requireApprovedGate("IMPLEMENTATION_PLAN", facts, "ADVANCE_TO_IMPLEMENTATION");
  }
  if (currentStage === "IMPLEMENTATION") {
    if (activeRun !== null) {
      return result("BLOCKED", "ACTIVE_RUN", `运行 ${activeRun} 尚未结束，不能选择新的动作。`, null, [activeRun]);
    }
    const inProgress = facts.workItems.filter((item) => item.status === "IN_PROGRESS");
    if (inProgress.length > 0) {
      return result("BLOCKED", "WORK_ITEM_IN_PROGRESS", `工作项 ${inProgress.map((item) => item.id).join("、")} 尚未结束。`, null);
    }
    const ready = facts.workItems.filter((item) => item.status === "READY");
    if (ready.length === 1 && activeWorkItem === ready[0].id) {
      return result("ACTIONABLE", "START_WORK_ITEM", `工作项 ${ready[0].id} 是唯一 READY 工作项。`, "START_WORK_ITEM", [ready[0].id]);
    }
    if (ready.length > 1) {
      return result("BLOCKED", "MULTIPLE_READY_WORK_ITEMS", "存在多个 READY 工作项；在调度器验收前不能自行选择。", null, ready.map((item) => item.id));
    }
    const unfinished = facts.workItems.filter((item) => !["DONE", "INVALIDATED"].includes(item.status));
    if (unfinished.length > 0) {
      return result("BLOCKED", "NO_READY_WORK_ITEM", "仍有未完成工作项，但不存在唯一 READY 工作项。", null, unfinished.map((item) => item.id));
    }
    if (facts.checks.finalVerification !== "PASS") {
      return result("ACTIONABLE", "RUN_FINAL_VERIFICATION", "全部工作项已完成，必须运行唯一验证命令。", "RUN_FINAL_VERIFICATION");
    }
    return result("ACTIONABLE", "ADVANCE_TO_ACCEPTANCE_AUDIT", "工作项和最终验证均已通过。", "ADVANCE_TO_ACCEPTANCE_AUDIT");
  }
  if (currentStage === "ACCEPTANCE_AUDIT") {
    if (facts.checks.acceptanceAudit === "PASS") {
      return result("ACTIONABLE", "ADVANCE_TO_DELIVERY", "独立验收审计已通过。", "ADVANCE_TO_DELIVERY");
    }
    if (facts.checks.acceptanceAudit === "FAIL") {
      return result("BLOCKED", "ACCEPTANCE_AUDIT_FAILED", "独立验收失败，必须退回执行流程修复。", null);
    }
    return result("ACTIONABLE", "RUN_ACCEPTANCE_AUDIT", "需要执行独立验收审计。", "RUN_ACCEPTANCE_AUDIT");
  }
  if (currentStage === "DELIVERY") return requireApprovedGate("GATE_3", facts, "ADVANCE_TO_COMPLETED");
  return result("BLOCKED", "UNKNOWN_STAGE", `未识别阶段：${currentStage}`, null);
}

function readRequired(root, path, missing) {
  const target = join(root, path);
  if (!existsSync(target)) {
    missing.push(path);
    return "";
  }
  return readFileSync(target, "utf8");
}

function planItems(markdown, version) {
  const major = Number(version.slice(1).split(".")[0]);
  const start = markdown.indexOf(`## Phase ${major} ${version} 实施计划`);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const nextPhase = tail.slice(1).search(/^## Phase \d+ v\d+\.\d+ /m);
  const section = nextPhase < 0 ? tail : tail.slice(0, nextPhase + 1);
  const matches = [...section.matchAll(/^## (WI-\d{3}) ([^\r\n]+)[\s\S]*?^- 状态：([A-Z_]+)\s*$/gm)];
  return matches.map((match) => ({ id: match[1], title: match[2].trim(), status: match[3] }));
}

function planGate(markdown, version) {
  const major = Number(version.slice(1).split(".")[0]);
  const marker = `## Phase ${major} 计划确认`;
  const start = markdown.indexOf(marker);
  if (start < 0) return { status: "PENDING", evidence: "plans/plan-first-release.md" };
  const tail = markdown.slice(start);
  const next = tail.slice(marker.length).search(/^## /m);
  const section = next < 0 ? tail : tail.slice(0, marker.length + next);
  return { status: approvalStatus(section), evidence: "plans/plan-first-release.md" };
}

function uiGateStatus(plan) {
  if (/^UI 原型门：不适用。/m.test(plan)) return "NOT_APPLICABLE";
  return /UI Gate[\s\S]*?- 状态：APPROVED/m.test(plan) ? "APPROVED" : "PENDING";
}

function latestAcceptanceResult(root, version) {
  const directory = join(root, ".project", "audits");
  if (!existsSync(directory)) return "UNKNOWN";
  const reports = readdirSync(directory).filter((name) => /^AUDIT-\d{8}-\d{6}\.md$/.test(name)).sort().reverse();
  for (const name of reports) {
    const report = readFileSync(join(directory, name), "utf8");
    if (report.includes(`- 需求基线：${version}`)) return report.match(/^- 审计结果：(PASS|FAIL|AUDIT_ERROR)$/m)?.[1] ?? "UNKNOWN";
  }
  return "UNKNOWN";
}

export function loadOrchestratorFacts(root) {
  const missingArtifacts = [];
  const stateMarkdown = readRequired(root, ".project/state.md", missingArtifacts);
  const registryContent = readRequired(root, ".project/cycles/index.json", missingArtifacts);
  const discovery = readRequired(root, "docs/discovery.md", missingArtifacts);
  const requirements = readRequired(root, "docs/requirements.md", missingArtifacts);
  const solution = readRequired(root, "docs/solution-design-v2.md", missingArtifacts);
  const plan = readRequired(root, "plans/plan-first-release.md", missingArtifacts);
  const contradictions = [];
  if (missingArtifacts.length > 0) {
    return {
      cycleId: "UNKNOWN",
      version: "v0.0",
      state: { currentStage: "UNKNOWN", stageStatus: "UNKNOWN", activeRun: null, activeWorkItem: null },
      gates: Object.fromEntries(HUMAN_GATES.map((gate) => [gate, "PENDING"])),
      gateEvidence: {},
      checks: { finalVerification: "UNKNOWN", acceptanceAudit: "UNKNOWN" },
      workItems: [],
      missingArtifacts,
      contradictions,
    };
  }
  const parsedState = parseProjectState(stateMarkdown);
  const registry = parseCycleRegistry(registryContent);
  const active = registry.cycles.find((cycle) => cycle.cycleId === registry.activeCycleId);
  if (!active) contradictions.push("活动周期不存在。");
  const version = active?.version ?? "v0.0";
  const baseline = stateScalar(stateMarkdown, "requirements_baseline");
  if (baseline !== "null" && baseline !== version) contradictions.push(`状态基线 ${baseline} 与活动周期 ${version} 不一致。`);

  let gate1 = "PENDING";
  let gate2 = "PENDING";
  let solutionGate = "PENDING";
  try {
    gate1 = approvalStatus(selectVersionedGate(discovery, "Gate 1", version));
  } catch (error) {
    contradictions.push(error.message);
  }
  try {
    gate2 = approvalStatus(selectVersionedGate(requirements, "Gate 2", version, { headingLevel: 3 }));
  } catch (error) {
    contradictions.push(error.message);
  }
  try {
    const solutionSection = selectBaselineSection(solution, version);
    solutionGate = approvalStatus(solutionSection.match(/^## 方案确认[\s\S]*$/m)?.[0] ?? "");
  } catch (error) {
    contradictions.push(error.message);
  }
  const implementationPlan = planGate(plan, version);
  const deliveryPath = join(root, "docs", "delivery.md");
  let gate3 = "PENDING";
  if (existsSync(deliveryPath)) {
    try {
      gate3 = approvalStatus(selectVersionedGate(readFileSync(deliveryPath, "utf8"), "Gate 3", version));
    } catch {
      gate3 = "PENDING";
    }
  }
  const lastRun = stateScalar(stateMarkdown, "last_successful_run");
  const evidencePath = join(root, "evidence", `${lastRun}.md`);
  const finalVerification =
    existsSync(evidencePath) &&
    /- 唯一验证命令：`npm run verify`/.test(readFileSync(evidencePath, "utf8")) &&
    /- 最终结果：PASS/.test(readFileSync(evidencePath, "utf8"))
      ? "PASS"
      : "UNKNOWN";
  return {
    cycleId: active?.cycleId ?? "UNKNOWN",
    version,
    state: {
      currentStage: parsedState.currentStage,
      stageStatus: parsedState.stageStatus,
      activeRun: stateScalar(stateMarkdown, "active_run") === "null" ? null : stateScalar(stateMarkdown, "active_run"),
      activeWorkItem:
        stateScalar(stateMarkdown, "active_work_item") === "null" ? null : stateScalar(stateMarkdown, "active_work_item"),
    },
    gates: {
      GATE_1: gate1,
      GATE_2: gate2,
      UI_GATE: uiGateStatus(plan),
      SOLUTION_DESIGN: solutionGate,
      IMPLEMENTATION_PLAN: implementationPlan.status,
      GATE_3: gate3,
    },
    gateEvidence: {
      GATE_1: "docs/discovery.md",
      GATE_2: "docs/requirements.md",
      UI_GATE: "plans/plan-first-release.md",
      SOLUTION_DESIGN: "docs/solution-design-v2.md",
      IMPLEMENTATION_PLAN: implementationPlan.evidence,
      GATE_3: "docs/delivery.md",
    },
    checks: { finalVerification, acceptanceAudit: latestAcceptanceResult(root, version) },
    workItems: planItems(plan, version),
    missingArtifacts,
    contradictions,
  };
}

export const orchestratorContract = Object.freeze({
  resultStatuses: ["ACTIONABLE", "WAITING_HUMAN", "BLOCKED", "COMPLETED"],
  humanGates: HUMAN_GATES,
});
