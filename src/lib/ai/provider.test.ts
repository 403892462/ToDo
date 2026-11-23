import { describe, expect, it } from "vitest";

import { createTodoProvider, disableThinking } from "./provider";

describe("createTodoProvider", () => {
  it("为千问兼容接口启用 JSON Schema 结构化输出", () => {
    const model = createTodoProvider("https://example.test/v1", "test-key")("qwen3.7-plus");

    expect((model as { supportsStructuredOutputs?: boolean }).supportsStructuredOutputs).toBe(true);
  });

  it("关闭千问思考模式并保留原请求字段", () => {
    expect(disableThinking({ model: "qwen3.7-plus", enable_thinking: true })).toEqual({
      model: "qwen3.7-plus",
      enable_thinking: false,
    });
  });
});
