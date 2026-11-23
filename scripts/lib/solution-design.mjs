const RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const MANDATORY_FULL_IMPACTS = new Set([
  "data-model",
  "security",
  "permissions",
  "external-system",
  "irreversible",
  "public-api",
  "cross-module",
]);
const HIGH_RISK_ALLOWED = new Set(["MITIGATED", "ACCEPTED", "ACCEPTED_FOR_BOOTSTRAP", "CLOSED"]);

export function assessSolutionDesign(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("方案评估输入必须是对象。")
  }
  if (typeof input.changeId !== "string" || input.changeId.trim() === "") {
    throw new Error("方案评估缺少 changeId。")
  }
  if (input.informationComplete !== true) {
    return {
      status: "NEEDS_CONFIRMATION",
      riskLevel: null,
      designDepth: "UNDETERMINED",
      reason: "信息不足，无法可靠判断风险和影响范围。",
      mandatoryFullImpacts: [],
    };
  }
  if (!RISK_LEVELS.has(input.declaredRisk)) {
    throw new Error("declaredRisk 必须是 LOW、MEDIUM 或 HIGH。")
  }
  if (!Array.isArray(input.impacts) || input.impacts.some((impact) => typeof impact !== "string")) {
    throw new Error("impacts 必须是字符串数组。")
  }
  const unknownImpacts = input.impacts.filter((impact) => !MANDATORY_FULL_IMPACTS.has(impact));
  if (unknownImpacts.length > 0) {
    throw new Error(`未知影响类别：${unknownImpacts.join(", ")}`);
  }
  const mandatoryFullImpacts = [...new Set(input.impacts)];
  const full = input.declaredRisk !== "LOW" || mandatoryFullImpacts.length > 0;
  if (!full && (typeof input.simplificationReason !== "string" || input.simplificationReason.trim() === "")) {
    throw new Error("低风险简化方案必须提供 simplificationReason。")
  }
  return {
    status: "READY",
    riskLevel: input.declaredRisk,
    designDepth: full ? "FULL" : "SIMPLE",
    reason: full
      ? mandatoryFullImpacts.length > 0
        ? `命中强制完整方案类别：${mandatoryFullImpacts.join(", ")}`
        : `${input.declaredRisk} 风险必须使用完整方案。`
      : input.simplificationReason.trim(),
    mandatoryFullImpacts,
  };
}

function requireField(markdown, pattern, message) {
  const match = markdown.match(pattern);
  if (!match) {
    throw new Error(message);
  }
  return match[1]?.trim() ?? "";
}

export function parseSolutionDesign(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new Error("方案文件为空或无法读取。")
  }
  const status = requireField(markdown, /^状态：([A-Z_]+)\s*$/m, "方案缺少可解析状态。");
  const riskLevel = requireField(markdown, /^风险等级：(LOW|MEDIUM|HIGH)\s*$/m, "方案缺少有效风险等级。");
  const depthText = requireField(markdown, /^设计深度：(.+)$/m, "方案缺少设计深度。");
  const designDepth = /^(SIMPLE|简化方案)/.test(depthText) ? "SIMPLE" : /^(FULL|完整方案)/.test(depthText) ? "FULL" : null;
  if (!designDepth) {
    throw new Error("设计深度必须是 SIMPLE/简化方案或 FULL/完整方案。")
  }
  if (riskLevel !== "LOW" && designDepth !== "FULL") {
    throw new Error(`${riskLevel} 风险必须使用完整方案。`);
  }
  if (designDepth === "SIMPLE" && !/^简化理由：\S.+$/m.test(markdown)) {
    throw new Error("简化方案缺少简化理由。")
  }

  const riskRows = [...markdown.matchAll(/^\|\s*(RISK-\d{3})\s*\|\s*(LOW|MEDIUM|HIGH)\s*\|[^\r\n]*\|\s*([A-Z_]+)\s*\|\s*$/gm)].map(
    (match) => ({ id: match[1], level: match[2], status: match[3] }),
  );
  const confirmation = markdown.match(/## 方案确认[\s\S]*?^- 状态：([A-Z_]+)\s*$[\s\S]*?^- 确认人：(\S.+)\s*$[\s\S]*?^- 确认时间：(\S.+)\s*$/m);
  if (!confirmation) {
    throw new Error("方案确认记录无法解析。")
  }
  return { status, riskLevel, designDepth, riskRows, confirmationStatus: confirmation[1] };
}

export function assertSolutionGate(markdown) {
  const solution = parseSolutionDesign(markdown);
  if (solution.status !== "APPROVED" || solution.confirmationStatus !== "APPROVED") {
    throw new Error("方案及方案确认状态必须均为 APPROVED。")
  }
  const blocking = solution.riskRows.filter((risk) => risk.level === "HIGH" && !HIGH_RISK_ALLOWED.has(risk.status));
  if (blocking.length > 0) {
    throw new Error(`存在未关闭或未接受的高风险：${blocking.map((risk) => risk.id).join(", ")}`);
  }
  return solution;
}

