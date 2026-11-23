import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPost } from "./route";

describe("POST /api/tasks/parse", () => {
  let parseTaskText = vi.fn();

  beforeEach(() => {
    parseTaskText = vi.fn();
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/tasks/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns the parsed tasks", async () => {
    parseTaskText.mockResolvedValue({ status: "parsed", tasks: [{ title: "整理书桌", labels: [] }], partial: false, truncated: false });
    const response = await createPost(parseTaskText)(request({ text: "整理书桌" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "parsed", tasks: [{ title: "整理书桌", labels: [] }], partial: false, truncated: false });
  });

  it("rejects empty input without calling the model", async () => {
    const response = await createPost(parseTaskText)(request({ text: "   " }));
    expect(response.status).toBe(400);
    expect(parseTaskText).not.toHaveBeenCalled();
  });

  it.each(["timeout", "unavailable", "provider error"])("normalizes %s failures", async (message) => {
    parseTaskText.mockRejectedValue(new Error(message));
    const response = await createPost(parseTaskText)(request({ text: "任务" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", error: "AI_PARSE_FAILED" });
  });
});
