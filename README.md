# 移动端待办事项

面向个人用户的手机端响应式任务管理工具。首页以“今日视图”呈现时间资产和纵向时间轴，用户可通过单条自然语言快速创建、安排和执行任务。

## 环境要求

- Node.js 20.9 或更高版本
- npm
- PostgreSQL 17
- 可选：兼容 OpenAI API 的模型服务

## 安装与启动

```powershell
npm install
Copy-Item .env.example .env.local
npm run db:migrate
npm run dev
```

打开 `http://127.0.0.1:3000`。首次使用会创建匿名个人空间和一次性访问码，任务数据保存在本机 PostgreSQL 中；浏览器本机旧任务不会自动迁移。

## 本机 PostgreSQL 与安全配置

在 `.env.local` 中填写 `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_NAME`、`DATABASE_USER`、`DATABASE_PASSWORD` 和 `DATABASE_SSL`，并配置：

```text
ACCESS_CODE_PEPPER=至少32字符的随机值
ADMIN_USERNAME=本机管理员用户名
ADMIN_PASSWORD_HASH=scrypt格式密码哈希
ADMIN_TOTP_SECRET=Base32动态验证码密钥
```

若数据库密码含 `$`，请用英文单引号包住完整值，例如 `DATABASE_PASSWORD='Abc$123'`。不要提交 `.env.local` 或把任何真实秘密写入日志和验证证据。

## AI 配置

在 `.env.local` 中设置：

```text
AI_BASE_URL=https://provider.example/v1
AI_MODEL_ID=model-id
AI_API_KEY=your-local-secret
```

不要提交 `.env.local` 或真实密钥。密钥只由 Next.js 服务端路由读取，浏览器前端不会获得密钥。首次使用 AI 创建任务前，应用会提示输入将发送给第三方模型且不得包含敏感数据。

## 输入输出示例

输入：

```text
明天下午3点提醒我跟老张对齐代码 #工作 !重要
```

预期结构化任务：

- 任务名：跟老张对齐代码
- 时间：次日 15:00
- 标签：工作
- 优先级：高

当模型无法确定属性时，系统以完整原文作为任务名并提示“未识别属性”。模型 API 超时、不可用或返回错误时，系统同样保留原文并提示“AI 解析失败”。

## 今日视图与任务池

- 带时间的任务进入对应日期的时间轴；只有开始时间时默认占用 60 分钟。
- 无时间任务及 AI 降级任务进入任务池，可一键安排到今天最早的连续 60 分钟空档。
- 时间资产按当天不重叠的排程计算；冲突任务会保留并明确提示。
- 点击任务卡片可打开快捷操作；手机端右划可开始 25 分钟专注，左划可打开相同菜单。
- 快捷菜单支持顺延 1 小时、推迟到明天和 AI 拆解。AI 拆解先预览，确认后才创建子任务。
- 所有手势操作均有点击入口；对话框支持键盘焦点与 `Escape` 关闭。

## 验证

```powershell
npm run verify
```

该命令依次运行 Phase 2 自动契约检查、ESLint、Vitest、Next.js 生产构建和生产模式首页冒烟检查。

## Phase 2 工程质量闭环

- 已批准需求在实施规划前经过 `solution-design` 风险分级和方案门。
- `.project/traceability.json` 建立需求、方案、工作项、测试与证据的双向追踪。
- `npm run contract:check` 检查状态、编号、引用、追踪和证据一致性，错误时失败关闭。
- 实施完成后进入 `acceptance-audit`，以独立夹具和 SHA-256 摘要验证覆盖与只读边界。
- 审计失败通过独立修复运行退回执行，修复后生成新复验报告；原失败历史不会覆盖。
- 流程契约见 `docs/phase2-contract.md`，迁移记录见 `docs/phase2-migration.md`。

## Phase 3 编排与交付复盘

- `node scripts/project-orchestrator.mjs status` 读取当前周期事实，`next` 只给出唯一合法下一动作。
- 受控动作通过 `scripts/project-control.ps1` 执行；重复动作按动作键幂等返回，失败、超时或冲突时停止并要求恢复或人工处理。
- `node scripts/project-orchestrator.mjs schedule` 仅在无依赖、文件与资源不冲突且隔离已证明时建议并行，否则保守串行。
- `node scripts/project-orchestrator.mjs check-drift` 检查运行期间的范围漂移；漂移后不得继续写入。
- `node scripts/project-metrics.mjs validate` 校验追加式指标。无法取得用量或成本时保留 `null` 和缺失原因，不估算数据。
- Gate 3 由负责人批准后，才允许运行 `node scripts/delivery-retrospective.mjs` 生成最终复盘；建议不会自动变成需求。
- v3.0 核心闭环不包含多模型审计、CI、模板化初始化、真实 Git 工作树或公网部署，这些能力留待后续受控迭代。

## v1.3 当前限制

- 仅支持个人匿名空间，不支持传统账户或家庭/小组共享。
- 当前只验证 `127.0.0.1:3000` 本地访问；公网服务器、正式域名、HTTPS 和异地手机访问延期。
- 不支持到时提醒、按优先级筛选、拖拽排序或复盘统计。
- 专注计时仅在当前页面会话中运行，刷新页面后不会继续。
- 删除任务需要二次确认，确认后不可恢复。
- 首版不处理敏感数据；请勿在自然语言输入中填写敏感信息。
