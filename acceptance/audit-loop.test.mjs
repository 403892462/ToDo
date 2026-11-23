import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  completeAuditRepair,
  recordReaudit,
  returnAuditFailure,
  startAuditRepair,
  validateReauditLink,
} from "../scripts/lib/audit-loop.mjs";

function state() {
  return `---
current_stage: ACCEPTANCE_AUDIT
active_work_item: null
active_run: null
last_successful_run: "RUN-20261111-000000-WI028"
updated_at: "2026-11-11T00:00:00Z"
stages:
  IMPLEMENTATION: COMPLETED
  ACCEPTANCE_AUDIT: IN_PROGRESS
  DELIVERY: INVALIDATED
---
`;
}

function report({ id = "AUDIT-20261111-000001", result = "FAIL", readonly = "UNCHANGED" } = {}) {
  return `# 独立验收审计报告

- 审计编号：${id}
- 需求基线：v2.0
- 审计结果：${result}
- 退回工作项：WI-026

## 只读边界

- 生产实现与实现测试摘要：${readonly}
`;
}

describe("审计失败退回与修复", () => {
  it("FAIL 受控退回指定执行工作项并保留恢复入口", () => {
    const returned = returnAuditFailure(state(), report(), ".project/audits/AUDIT-20261111-000001.md", "2026-11-11T01:00:00Z");
    expect(returned.state).toMatch(/^current_stage: IMPLEMENTATION$/m);
    expect(returned.state).toMatch(/^active_work_item: "WI-026"$/m);
    expect(returned.loop).toMatchObject({ status: "AWAITING_FIX", originalAuditId: "AUDIT-20261111-000001", returnWorkItem: "WI-026" });
    expect(returned.recovery).toContain("start-fix");
  });

  it("拒绝 PASS 报告退回和非目标工作项修复运行", () => {
    expect(() => returnAuditFailure(state(), report({ result: "PASS" }), "pass.md", "now")).toThrow("只有 FAIL");
    const returned = returnAuditFailure(state(), report(), "fail.md", "now");
    expect(() => startAuditRepair(returned.state, returned.loop, "RUN-20261111-000002-WI999", "now")).toThrow("不一致");
  });

  it("没有 PASS 修复证据不能进入复验", () => {
    const returned = returnAuditFailure(state(), report(), "fail.md", "now");
    const started = startAuditRepair(returned.state, returned.loop, "RUN-20261111-000002-WI026", "now");
    expect(() => completeAuditRepair(started.state, started.loop, "evidence/fail.md", "- 最终结果：FAIL\n- 测试：失败", "now")).toThrow("未通过");
  });

  it("修复验证通过后返回独立验收并关联新运行", () => {
    const returned = returnAuditFailure(state(), report(), "fail.md", "t1");
    const started = startAuditRepair(returned.state, returned.loop, "RUN-20261111-000002-WI026", "t2");
    const completed = completeAuditRepair(
      started.state,
      started.loop,
      "evidence/repair.md",
      "# 修复证据\n\n- 受影响测试：PASS\n- 最终结果：PASS\n",
      "t3",
    );
    expect(completed.state).toMatch(/^current_stage: ACCEPTANCE_AUDIT$/m);
    expect(completed.state).toMatch(/^active_run: null$/m);
    expect(completed.loop).toMatchObject({ status: "READY_FOR_REAUDIT", repairRunId: "RUN-20261111-000002-WI026", repairEvidence: "evidence/repair.md" });
  });

  it("只读边界违规作为原失败事实保留", () => {
    const returned = returnAuditFailure(state(), report({ readonly: "CHANGED" }), "fail.md", "now");
    expect(returned.loop.readonlyViolation).toBe(true);
  });
});

describe("独立复验历史", () => {
  function readyLoop(root) {
    mkdirSync(join(root, ".project", "audits"), { recursive: true });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, ".project", "audits", "AUDIT-20261111-000001.md"), report(), "utf8");
    writeFileSync(join(root, "evidence", "repair.md"), "- 受影响测试：PASS\n- 最终结果：PASS\n", "utf8");
    return {
      schemaVersion: 1,
      status: "READY_FOR_REAUDIT",
      originalAuditId: "AUDIT-20261111-000001",
      originalReport: ".project/audits/AUDIT-20261111-000001.md",
      returnWorkItem: "WI-026",
      repairRunId: "RUN-20261111-000002-WI026",
      repairEvidence: "evidence/repair.md",
      reaudits: [],
    };
  }

  it("缺少修复证据或关联错误时拒绝复验", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-loop-"));
    const loop = readyLoop(root);
    expect(() =>
      validateReauditLink(
        { previousAuditId: loop.originalAuditId, repairRunId: "RUN-20261111-999999-WI026", repairEvidence: loop.repairEvidence },
        loop,
        root,
      ),
    ).toThrow("修复运行");
    expect(() => validateReauditLink({ previousAuditId: loop.originalAuditId }, loop, root)).toThrow("修复运行");
  });

  it("新复验记录关联原失败与修复运行且不覆盖原报告", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-loop-"));
    const loop = readyLoop(root);
    const manifest = {
      previousAuditId: loop.originalAuditId,
      repairRunId: loop.repairRunId,
      repairEvidence: loop.repairEvidence,
    };
    expect(() => validateReauditLink(manifest, loop, root)).not.toThrow();
    const nextReport = report({ id: "AUDIT-20261111-000003", result: "PASS" });
    const closed = recordReaudit(loop, nextReport, ".project/audits/AUDIT-20261111-000003.md", "t4");
    expect(closed.status).toBe("CLOSED");
    expect(closed.originalReport).toBe(loop.originalReport);
    expect(closed.reaudits[0]).toMatchObject({ auditId: "AUDIT-20261111-000003", result: "PASS" });
    expect(() => recordReaudit(loop, report(), loop.originalReport, "t4")).toThrow("不得覆盖");
  });

  it("复验再次失败时归档上一轮并允许新一轮修复", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-loop-"));
    const loop = readyLoop(root);
    const failedAgain = recordReaudit(
      loop,
      report({ id: "AUDIT-20261111-000003", result: "FAIL" }),
      ".project/audits/AUDIT-20261111-000003.md",
      "t4",
    );
    const nextState = state();
    const returned = returnAuditFailure(
      nextState,
      report({ id: "AUDIT-20261111-000003", result: "FAIL" }),
      ".project/audits/AUDIT-20261111-000003.md",
      "t5",
      failedAgain,
    );
    expect(returned.loop.status).toBe("AWAITING_FIX");
    expect(returned.loop.originalAuditId).toBe("AUDIT-20261111-000003");
    expect(returned.loop.cycles[0]).toMatchObject({
      originalAuditId: "AUDIT-20261111-000001",
      repairRunId: "RUN-20261111-000002-WI026",
    });
  });
});

describe("审计循环控制脚本", () => {
  it("完成退回、修复运行和修复验证，同时保留原 FAIL", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-loop-cli-"));
    mkdirSync(join(root, ".project", "audits"), { recursive: true });
    mkdirSync(join(root, ".project", "runs"), { recursive: true });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, ".project", "state.md"), state(), "utf8");
    writeFileSync(join(root, ".project", "recovery.md"), "# 恢复记录\n", "utf8");
    const failurePath = join(root, ".project", "audits", "AUDIT-20261111-000001.md");
    const originalFailure = report();
    writeFileSync(failurePath, originalFailure, "utf8");
    writeFileSync(join(root, "evidence", "repair.md"), "- 受影响验证：PASS\n- 最终结果：PASS\n", "utf8");
    const script = resolve("scripts/audit-loop.mjs");
    const run = (args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
    expect(run(["return-failure", ".project/audits/AUDIT-20261111-000001.md"]).status).toBe(0);
    expect(run(["start-fix", "RUN-20261111-000002-WI026"]).status).toBe(0);
    expect(run(["complete-fix", "RUN-20261111-000002-WI026", "evidence/repair.md"]).status).toBe(0);
    expect(readFileSync(failurePath, "utf8")).toBe(originalFailure);
    expect(readFileSync(join(root, ".project", "runs", "RUN-20261111-000002-WI026.md"), "utf8")).toContain("- 状态：DONE");
    expect(readFileSync(join(root, ".project", "state.md"), "utf8")).toMatch(/^current_stage: ACCEPTANCE_AUDIT$/m);
    expect(JSON.parse(readFileSync(join(root, ".project", "audit-loop.json"), "utf8"))).toMatchObject({
      status: "READY_FOR_REAUDIT",
      originalAuditId: "AUDIT-20261111-000001",
      repairRunId: "RUN-20261111-000002-WI026",
    });
  });
});
