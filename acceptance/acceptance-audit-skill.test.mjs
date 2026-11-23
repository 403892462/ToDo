import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(".agents/skills/acceptance-audit/SKILL.md", "utf8");

describe("acceptance-audit Skill 契约", () => {
  it("具有合法 frontmatter 和可读取的审计契约", () => {
    expect(skill).toMatch(/^---\r?\nname: acceptance-audit\r?\ndescription: \S.+\r?\n---/);
    expect(() => readFileSync(".agents/skills/acceptance-audit/references/contract.md", "utf8")).not.toThrow();
    expect(() => readFileSync(".project/templates/acceptance-audit-report.md", "utf8")).not.toThrow();
  });

  it("不包含未完成脚手架占位符", () => {
    expect(skill).not.toMatch(/^\s*\[TODO:[^\n]*\]\s*$/m);
  });
});

