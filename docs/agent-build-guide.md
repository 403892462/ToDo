# 从零构建受控项目 Agent：新手指南

## 1. 你将构建什么

本指南帮助新手从零搭建一套可复用的受控项目 Agent。完成后，系统应具备：

- 阶段化业务到交付流程。
- 人工 Gate 防线。
- 版本化需求和稳定编号。
- 工作项执行、验证与证据。
- 独立验收审计。
- 唯一下一动作决策。
- 保守并行、指标记录和交付复盘。

建议先完成最小串行闭环，再增加并行、指标和复盘。不要一开始同时实现所有高级能力。

## 2. 前置知识与环境

你需要了解：

- Markdown 和 JSON 基础。
- Node.js 脚本的运行方式。
- 自动化测试的基本概念。
- Git 的基本使用方式，虽然当前首版不自动操作真实 Git 工作树。

推荐环境：

- Node.js 20.9 或更高版本。
- npm。
- PowerShell 7 或兼容终端。
- 一个可运行 `npm test` 的项目。

## 3. 第一步：确定流程契约

先写清阶段，而不是先写 Agent 提示词。

最小流程示例：

```text
DISCOVERY
  → REQUIREMENTS
  → SOLUTION_DESIGN
  → PLANNING
  → IMPLEMENTATION
  → ACCEPTANCE_AUDIT
  → DELIVERY
  → COMPLETED
```

为每个阶段定义：

1. 必需输入。
2. 允许输出。
3. 进入条件。
4. 完成条件。
5. 失败时退回位置。
6. 是否需要人工确认。

将规则写入 `docs/process-contract.md`。契约必须明确禁止非法跳转，例如实施不能直接跳过验收进入交付。

## 4. 第二步：设计项目目录

推荐最小目录：

```text
项目根目录/
├─ AGENTS.md
├─ .agents/
│  └─ skills/
├─ .project/
│  ├─ state.md
│  ├─ traceability.json
│  ├─ cycles/
│  ├─ runs/
│  ├─ audits/
│  └─ retrospectives/
├─ docs/
├─ plans/
├─ scripts/
│  └─ lib/
├─ acceptance/
│  └─ fixtures/
└─ evidence/
```

目录职责要固定，避免同一个事实同时出现在多个不可判定的地方。

## 5. 第三步：建立项目状态文件

创建 `.project/state.md`：

```yaml
---
schema_version: 1
project_id: PROJECT-0001
current_stage: DISCOVERY
stage_status: IN_PROGRESS
requirements_baseline: null
verification_command: "npm run verify"
active_work_item: null
active_run: null
stages:
  DISCOVERY: IN_PROGRESS
  REQUIREMENTS: PENDING
  SOLUTION_DESIGN: PENDING
  PLANNING: PENDING
  IMPLEMENTATION: PENDING
  ACCEPTANCE_AUDIT: PENDING
  DELIVERY: PENDING
  COMPLETED: PENDING
---
```

状态文件只记录状态，不承载业务规则。业务事实应写入对应文档。

接着实现一个纯函数解析器：

```text
parseProjectState(markdown) → state
```

解析器应拒绝：

- 缺少字段。
- 未知阶段或状态。
- 同时存在多个活动运行。
- 当前阶段与阶段明细矛盾。

## 6. 第四步：建立稳定编号与基础产物

建议使用：

- `GOAL-*`：目标。
- `BR-*`：业务规则。
- `FR-*`：功能需求。
- `AC-*`：验收标准。
- `CHG-*`：需求变更。
- `DEC-*`：技术决策。
- `RISK-*`：风险。
- `WI-*`：工作项。
- `RUN-*`：执行运行。

创建以下文档模板：

- `docs/discovery.md`
- `docs/requirements.md`
- `docs/acceptance-catalog.md`
- `docs/solution-design.md`
- `plans/implementation-plan.md`
- `docs/delivery.md`

每个需求都必须关联至少一个验收标准；每个工作项都应关联需求和验证方式。

## 7. 第五步：编写阶段 Skill

每个 Skill 建议包含：

```text
.agents/skills/<skill-name>/
└─ SKILL.md
```

`SKILL.md` 至少说明：

1. Skill 名称和用途。
2. 前置条件。
3. 必须读取的输入。
4. 允许执行的动作。
5. 禁止动作。
6. 输出格式。
7. 停止和失败条件。

推荐按以下顺序建设：

1. `business-discovery`
2. `requirements-definition`
3. `solution-design`
4. `implementation-planning`
5. `execute-plan`
6. `acceptance-audit`
7. `project-orchestrator`
8. `delivery-retrospective`

先让每个 Skill 职责单一。不要让审计 Skill 同时负责修复，也不要让编排 Skill 代替业务审批。

## 8. 第六步：实现协议检查器

创建：

```text
scripts/contract-check.mjs
scripts/lib/project-contract.mjs
```

协议检查至少验证：

- 状态文件结构。
- 当前阶段合法性。
- Gate 是否有确认人和时间。
- 需求与验收编号唯一。
- 需求、工作项、测试和证据引用存在。
- 完成工作项具有 PASS 证据。
- 不存在未知状态或非法转换。

在 `package.json` 中建立唯一验证命令：

```json
{
  "scripts": {
    "contract:check": "node scripts/contract-check.mjs",
    "verify": "npm run contract:check && npm run lint && npm run test && npm run build"
  }
}
```

所有阶段推进和完成声明之前都运行 `npm run verify`。

## 9. 第七步：实现受控阶段推进

创建阶段转换表：

```text
DISCOVERY → REQUIREMENTS
REQUIREMENTS → SOLUTION_DESIGN
SOLUTION_DESIGN → PLANNING
PLANNING → IMPLEMENTATION
IMPLEMENTATION → ACCEPTANCE_AUDIT
ACCEPTANCE_AUDIT → DELIVERY
DELIVERY → COMPLETED
```

阶段控制器应遵循：

- 先检查当前状态。
- 检查必需 Gate 和产物。
- 检查唯一验证命令结果。
- 原子更新状态。
- 更新后再次解析状态。
- 任一步失败时不留下半完成状态。

当前项目对应入口为 `scripts/project-control.ps1`。

## 10. 第八步：实现工作项执行闭环

为每次执行生成唯一运行编号：

```text
RUN-YYYYMMDD-HHMMSS-WI001
```

运行流程：

1. 检查工作项为唯一 `READY` 项。
2. 建立项目锁。
3. 把工作项和运行标记为活动状态。
4. 仅修改工作项允许的范围。
5. 运行定向测试。
6. 运行唯一验证命令。
7. 写入 `evidence/<RUN-ID>.md`。
8. 验证证据为 PASS 后标记工作项 `DONE`。
9. 清除活动运行和项目锁。

失败时保留真实失败记录，不得生成虚假 PASS 证据。

## 11. 第九步：实现追踪矩阵

创建 `.project/traceability.json`，连接：

```text
需求 ↔ 方案 ↔ 工作项 ↔ 测试 ↔ 证据
```

检查内容包括：

- 每个需求至少有方案、工作项、测试和证据。
- 每个产物反向引用有效需求。
- 变更后受影响产物被标记为失效。
- 待处理或失效产物不能支持交付。

## 12. 第十步：实现独立验收

创建：

```text
scripts/acceptance-audit.mjs
acceptance/fixtures/
.project/audits/
```

验收流程：

1. 读取独立审计清单。
2. 审计前计算受保护路径摘要。
3. 检查覆盖、风险、契约和最终验证。
4. 执行独立夹具。
5. 审计后再次计算摘要。
6. 生成不可覆盖的审计报告。

结果定义：

- `PASS`：所有检查通过且摘要不变。
- `FAIL`：实现验收失败，退回执行流程。
- `AUDIT_ERROR`：审计工具或夹具无法可靠判定。

## 13. 第十一步：实现项目编排器

先实现纯函数：

```text
decideNextAction(facts) → result
```

输入事实包括：

- 当前周期和版本。
- 当前阶段与状态。
- Gate 状态。
- 工作项状态。
- 最终验证状态。
- 独立审计状态。
- 缺失产物和矛盾。

输出只允许：

- `ACTIONABLE`：存在唯一合法动作。
- `WAITING_HUMAN`：等待人工确认。
- `BLOCKED`：事实不足、冲突或失败。
- `COMPLETED`：周期已完成。

保持决策函数无副作用。读取文件和执行动作分别放到运行时模块中。

## 14. 第十二步：增加保守并行

只有以下条件全部成立时才并行：

1. 工作项之间无直接或传递依赖。
2. 文件影响范围不重叠。
3. 语义资源不冲突。
4. 运行资源不冲突。
5. 隔离已经证明。

任何信息缺失都退化为串行。并行是优化，不是正确性的前提。

## 15. 第十三步：增加指标与交付复盘

指标事件至少包含：

- 周期、对象和来源。
- 开始与结束时间。
- 成功、失败和重试次数。
- 测试、构建、契约或审计质量结果。
- 模型调用量与 Token；未知时填 `null` 和原因。
- 成本；未知时填 `null` 和原因。

Gate 3 或项目配置中的最终交付 Gate 批准后，生成：

- 机器可读 JSON 摘要。
- 中文 Markdown 复盘。

复盘必须区分事实、推断、数据缺口和建议。

## 16. 第十四步：建立测试矩阵

至少覆盖：

- 每个合法与非法阶段转换。
- 所有人工 Gate 未批准场景。
- 状态矛盾、缺失产物和重复编号。
- 运行幂等、失败和超时恢复。
- 依赖循环、范围冲突和漂移停止。
- 指标校验、敏感字段拒绝和未知成本。
- 独立审计 PASS、FAIL、AUDIT_ERROR 和只读边界。
- 最终 Gate 前禁止生成交付复盘。

## 17. 新项目验收清单

新项目至少满足以下条件，才能认为 Agent 构建完成：

- [ ] 阶段和 Gate 已由负责人确认。
- [ ] 状态文件可解析且非法状态会失败。
- [ ] 需求、验收、工作项、测试和证据可双向追踪。
- [ ] 工作项失败时不能标记为完成。
- [ ] 人工 Gate 无法被 Agent 自动批准。
- [ ] 独立验收不能修改实现和实现测试。
- [ ] 唯一验证命令能够一次执行全部必要检查。
- [ ] 完成周期不会自动启动新周期。
- [ ] 缺失指标不会被估算或补造。
- [ ] 使用说明和恢复步骤可由新手复现。

## 18. 最容易犯的错误

- 只写提示词，不建立可解析状态和验证工具。
- 把所有职责塞进一个 Skill。
- 在代码中无限增加硬编码 Gate。
- 让审计角色直接修复实现。
- 使用测试数量代替需求覆盖证明。
- 将日志输出当成不可变证据。
- 自动接受复盘建议。
- 在没有可靠来源时估算成本或 Token。

完成以上步骤后，你得到的不是一个“会回答项目问题的聊天机器人”，而是一套能够失败关闭、保留证据并尊重人工决策的工程 Agent。
