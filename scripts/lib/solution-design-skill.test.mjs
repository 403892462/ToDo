import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(".agents/skills/solution-design/SKILL.md", "utf8");

describe("solution-design Skill 契约", () => {
  it("具有可发现的合法 frontmatter 和实际引用资源", () => {
    expect(skill).toMatch(/^---\r?\nname: solution-design\r?\ndescription: \S.+\r?\n---/);
    expect(() => readFileSync(".agents/skills/solution-design/references/contract.md", "utf8")).not.toThrow();
    expect(() => readFileSync(".project/templates/solution-design-simple.md", "utf8")).not.toThrow();
    expect(() => readFileSync(".project/templates/solution-design-full.md", "utf8")).not.toThrow();
    expect(() => readFileSync(".project/templates/risk-register.md", "utf8")).not.toThrow();
  });

  it("不包含未完成的 Skill 脚手架占位符", () => {
    expect(skill).not.toMatch(/^\s*\[TODO:[^\n]*\]\s*$/m);
  });
});

