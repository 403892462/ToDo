# 业务想法转项目工作流

## 技能路由

- 模糊想法与业务澄清：`business-discovery`
- 问题定义转需求基线：`requirements-definition`
- 已批准需求或变更转技术方案与风险门：`solution-design`
- 需求基线转实施工作项：`implementation-planning`
- 按工作项实施、验证和恢复：`execute-plan`
- 实施完成后的独立验收与只读审计：`acceptance-audit`

## Phase 2 阶段契约

- v2.0 起采用 `REQUIREMENTS → SOLUTION_DESIGN → PLANNING → IMPLEMENTATION → ACCEPTANCE_AUDIT → DELIVERY`。
- 所有变更必须经过方案影响评估；实施完成后必须经过独立验收审计。
- `ACCEPTANCE_AUDIT` 失败只能退回执行流程修复，审计角色不得直接修改被审计实现或实现测试。
- 稳定格式、生效范围和历史兼容规则见 `docs/phase2-contract.md`。

## 界面原型确认门

- 对包含用户界面的项目，在 Gate 2 后、实施规划前提供关键界面与状态预览。
- 原型确认至少覆盖核心流程、空状态、成功、异常、编辑和不可逆操作。
- 未完成 UI 原型确认时，不得进入实施阶段；现有项目补审时暂停交付 Gate。
- 原型审查仅确认界面和交互；若改变已批准业务规则，必须记录 `CHG-*` 并使受影响下游内容失效。

## 强制规则

- 已确认需求是业务事实的最高优先级。
- 未确认规则进入 `NEEDS_CONFIRMATION`，不得自行补全。
- 不跳过阶段门，不直接手工伪造通过状态。
- 测试或验证失败时不得标记 `DONE`。
- 同一时间只允许一个修改流程；Phase 1 串行实施工作项。
- 需求变化后记录 `CHG-*`，使受影响下游内容失效。
- 不把密钥、完整环境变量或不必要的生产数据写入证据。

推进阶段或宣称完成前运行项目协议检查和唯一验证命令。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
