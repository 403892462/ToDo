# v1.1 验收映射

需求基线：Requirements Baseline v1.1

## AC-001～AC-015 基础任务与 AI 输入

- AC-001～AC-004、AC-014、AC-015：`ai-parse`、`task-creation` 自动测试覆盖结构化创建、属性缺失、不确定、接口失败、第三方数据提示和空白输入。
- AC-005～AC-013：`task-repository`、`task-ui` 自动测试覆盖查看、空状态、编辑、完成、二次确认删除、标签筛选与本机持久化。

## AC-016～AC-025 今日排程与任务池

- AC-016～AC-020：`scheduling`、`today-view` 自动测试覆盖时间资产、默认时长、时间区间与冲突提示。
- AC-021～AC-025：`task-creation`、`backlog` 自动测试覆盖有时间分流、无时间及降级归池、展开任务池与最早空档安排。

## AC-026～AC-032 专注与快捷操作

- AC-026、AC-027、AC-032：`focus-mode` 自动测试覆盖卡片入口、25 分钟专注及暂停、继续、结束和完成。
- AC-028、AC-029：`task-actions` 自动测试覆盖顺延 1 小时和推迟到明天。
- AC-030、AC-031：`task-actions`、`task-breakdown` 自动测试覆盖 AI 拆解预览确认、取消与失败不改变原任务。

## 非功能验证

- 手机端响应式布局、今日视图首屏及主要交互：本地浏览器视觉复验。
- 键盘可访问性：`task-ui` 测试验证对话框获得焦点、Escape 关闭及触发点焦点恢复；全部手势均有按钮入口。
- 密钥边界：AI 请求由 Next.js 服务端代理处理，前端不读取密钥；自动测试不调用真实第三方服务。
- 唯一验证命令：`npm run verify`。

## AC-033 相对日期与下班后

- `ai-parse` 固定时钟测试覆盖当前时间、Asia/Shanghai 和“下班后＝18:00”提示规则。
- 真实千问验证结果见 `evidence/MAINT-20261105-RELATIVE-TIME.md`。
