# 千问结构化输出适配修复证据

- 修复日期：2026-11-05
- 缺陷：`/api/tasks/parse` 在千问 Token Plan OpenAI 兼容接口下返回 503。
- 根因：通用 OpenAI 兼容提供器默认未声明结构化输出能力，且受限开发进程无法访问外部模型服务。
- 修复：统一创建 AI provider，并显式启用 JSON Schema 结构化输出；服务端仅记录脱敏错误摘要。
- 唯一验证命令：`npm run verify`
- 最终结果：PASS

## 验证结果

- ESLint：通过。
- Vitest：13 个测试文件、50 项测试全部通过。
- Next.js 生产构建、TypeScript 与生产模式冒烟：通过。
- 真实 `/api/tasks/parse`：返回正常业务响应，不再返回 503。
- 真实 `/api/tasks/breakdown`：成功返回结构化子任务。
- 千问思考模式已关闭；同一测试任务实测由约 14.24 秒降至 3.32 秒，降幅约 77%。
- API Key 未写入日志、证据或测试。

## 修改文件

- `src/lib/ai/provider.ts`
- `src/lib/ai/provider.test.ts`
- `src/lib/ai/task-parser.ts`
- `src/lib/ai/task-breakdown.ts`
- `src/app/api/tasks/parse/route.ts`
- `src/app/api/tasks/breakdown/route.ts`
