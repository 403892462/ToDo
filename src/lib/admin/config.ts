import { z } from "zod";

const schema = z.object({
  ADMIN_USERNAME: z.string().trim().min(1),
  ADMIN_PASSWORD_HASH: z.string().startsWith("scrypt$"),
  ADMIN_TOTP_SECRET: z.string().trim().min(16),
});

export type AdminConfig = { username: string; passwordHash: string; totpSecret: string };

export function readAdminConfig(environment: Record<string, string | undefined> = process.env): AdminConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) throw new Error("管理员服务端安全配置不完整");
  return {
    username: parsed.data.ADMIN_USERNAME,
    passwordHash: parsed.data.ADMIN_PASSWORD_HASH,
    totpSecret: parsed.data.ADMIN_TOTP_SECRET,
  };
}
