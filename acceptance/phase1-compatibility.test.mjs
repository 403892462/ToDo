import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const history = JSON.parse(readFileSync("acceptance/fixtures/phase1-history.json", "utf8"));

describe("Phase 1 历史兼容迁移", () => {
  it("v1.0 至 v1.3 的代表性完成证据摘要保持不变", () => {
    for (const file of history.files) {
      expect(existsSync(file.path), file.path).toBe(true);
      const digest = createHash("sha256").update(readFileSync(file.path)).digest("hex");
      expect(digest, file.path).toBe(file.sha256);
    }
  });

  it("历史 Gate 1/2/3 与 Phase 2 生效基线可同时识别", () => {
    const delivery = readFileSync("docs/delivery.md", "utf8");
    const requirements = readFileSync("docs/requirements.md", "utf8");
    const contract = readFileSync("docs/phase2-contract.md", "utf8");
    for (const version of history.historicalGates) expect(delivery).toContain(`Gate 3（${version}）`);
    expect(requirements).toContain("Requirements Baseline v2.0");
    expect(contract).toContain("生效基线：Requirements Baseline v2.0");
  });

  it("自举技术方案满足新风险门的结构并保留自举例外", async () => {
    const solution = readFileSync("docs/solution-design-v2.md", "utf8");
    const { assertSolutionGate } = await import("../scripts/lib/solution-design.mjs");
    expect(() => assertSolutionGate(solution)).not.toThrow();
    expect(solution).toContain("ACCEPTED_FOR_BOOTSTRAP");
  });

  it("故意失败夹具仍被独立审计识别为 FAIL", async () => {
    const { loadIndependentFixtures } = await import("../scripts/lib/acceptance-audit.mjs");
    const fixture = loadIndependentFixtures(process.cwd(), ["acceptance/fixtures/intentional-fail.json"])[0];
    expect(fixture.status).toBe("FAIL");
    expect(fixture.source).toBe("INDEPENDENT");
  });
});

