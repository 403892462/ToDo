import { describe, expect, it } from "vitest";

import { generateTotp, hashAdminPassword, verifyAdminPassword, verifyTotp } from "./crypto";

describe("管理员密码与动态验证码", () => {
  it("使用 scrypt 哈希验证密码且不包含密码明文", async () => {
    const encoded = await hashAdminPassword("Strong!Password123", Buffer.alloc(16, 1));
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain("Strong!Password123");
    await expect(verifyAdminPassword("Strong!Password123", encoded)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("符合 RFC 6238 的 TOTP 测试向量并拒绝错误验证码", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(generateTotp(secret, 59_000)).toBe("287082");
    expect(verifyTotp("287082", secret, 59_000)).toBe(true);
    expect(verifyTotp("000000", secret, 59_000)).toBe(false);
  });
});
