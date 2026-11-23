# Phase 2 工程流程契约

状态：ACTIVE

契约版本：phase2-v2

生效基线：Requirements Baseline v2.0

## 生效范围

- 本契约适用于明确采用 Phase 2 且需求基线不低于 v2.0 的项目状态与新增产物。
- v1.3 及以前的 Gate、工作项、运行记录和证据均为历史事实，不要求按本契约重写。
- Phase 2 自举期间形成的人工技术方案保留原始确认记录，后续通过兼容审计验证。

## 阶段顺序

```text
IDEA → DISCOVERY → REQUIREMENTS → SOLUTION_DESIGN → PLANNING
→ IMPLEMENTATION → ACCEPTANCE_AUDIT → DELIVERY → COMPLETED
```

- `REQUIREMENTS` 不得直接进入 `PLANNING`。
- `IMPLEMENTATION` 不得直接进入 `DELIVERY`。
- `ACCEPTANCE_AUDIT` 失败时仅允许退回 `IMPLEMENTATION`；原失败记录不得覆盖。
- `VERIFICATION` 作为 Phase 1 历史阶段允许出现在旧状态中，但不属于 Phase 2 主流程。

## 状态值

- 当前阶段状态：`IN_PROGRESS`、`COMPLETED`。
- 阶段明细状态：`PENDING`、`IN_PROGRESS`、`COMPLETED`、`INVALIDATED`。
- 工作项状态：`PENDING`、`READY`、`IN_PROGRESS`、`DONE`、`FAILED`、`BLOCKED`、`NEEDS_CONFIRMATION`、`INVALIDATED`。

## 必需产物

进入 Phase 2 状态控制时必须能够读取并解析：

- `.project/state.md`
- `docs/discovery.md`
- `docs/requirements.md`
- `docs/acceptance-catalog.md`
- `docs/solution-design-v2.md`
- `plans/plan-first-release.md`

缺少文件、必需字段、未知阶段、未知状态或非法阶段转换时必须返回失败，不得降级为警告。

## 稳定引用

- 目标、规则、需求、验收、变更、决策、风险、工作项和运行分别使用 `GOAL-*`、`BR-*`、`FR-*`、`AC-*`、`CHG-*`、`DEC-*`、`RISK-*`、`WI-*`、`RUN-*`。
- 本工作项只建立编号和解析边界；完整双向追踪与覆盖检查由 WI-025 实现。

