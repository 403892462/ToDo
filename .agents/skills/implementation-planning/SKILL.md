---
name: implementation-planning
description: 在不改变业务需求的前提下，将已批准的需求基线转化为有顺序、可追踪且可独立验证的首版工作项。
---

# 实施计划

只有在已存在批准的需求基线，并且项目处于 `PLANNING` 阶段时，才使用此 Skill。

## 首先读取

- `.project/state.md`
- `docs/requirements.md`
- `docs/acceptance-catalog.md`
- `docs/decision-log.md`
- `docs/change-log.md`
- `plans/plan-first-release.md`
- 相关的现有源代码、测试和项目命令

## 工作流程

1. 把每条首版需求映射到一个或多个 `WI-*` 工作项。
2. 为每个工作项指定明确目标、需求来源、依赖项、影响文件、完成条件和验证命令。
3. 工作项应足够小，能够在一次聚焦执行中完成；但不要把机械性的零碎动作分别拆成工作项。
4. 排定依赖顺序，并拒绝循环依赖。
5. Phase 1 采用串行执行：如果两个工作项可能修改同一文件，必须明确安排先后顺序。
6. 定义一个项目级唯一验证命令，覆盖相关测试、构建和最小运行检查。
7. 识别仍需人工决定的事项，不得把它们埋在实施任务中。
8. 进入实施阶段前，运行项目协议检查器并请求确认计划。

## 完成契约

每个工作项必须能够被独立判定为 `PENDING`、`READY`、`IN_PROGRESS`、`NEEDS_CONFIRMATION`、`BLOCKED`、`FAILED`、`DONE` 或 `INVALIDATED`。

只有产物已经存在、完成条件已经满足、规定的验证已经真实执行并成功，而且已经记录证据引用时，工作项才能标记为 `DONE`。
