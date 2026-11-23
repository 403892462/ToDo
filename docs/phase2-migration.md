# Phase 2 自举迁移与兼容记录

状态：VERIFIED

迁移基线：Requirements Baseline v2.0

## 迁移范围

- 为现有 Todo 项目新增 `SOLUTION_DESIGN` 与 `ACCEPTANCE_AUDIT` 阶段、Phase 2 Skill、契约、追踪、审计和恢复产物。
- Phase 2 契约从 v2.0 开始生效；v1.3 及以前内容继续作为只读历史事实。
- 公网部署和 Phase 3 编排能力不属于本次迁移。

## 历史保护

- 未改写 v1.0～v1.3 的已批准 Gate、已完成工作项、运行记录和验证证据。
- `acceptance/fixtures/phase1-history.json` 保存四个代表性历史交付证据的 SHA-256 摘要。
- `acceptance/phase1-compatibility.test.mjs` 自动检查历史摘要、历史 Gate 和 v2.0 生效边界。

## 自举方案兼容

- `docs/solution-design-v2.md` 是正式 `solution-design` Skill 建立前形成的人工完整方案。
- `RISK-001` 的自举例外保留为历史决定，不被静默改写。
- 新风险门对该方案执行结构、风险处置和确认记录检查；兼容测试必须通过。

## 迁移结果

- 历史产物：保持有效。
- Phase 2 新产物：按 `.project/traceability.json` 纳入双向追踪。
- 无法映射的历史缺口：无。
- 后续入口：完成 WI-028 后进入独立验收审计；PASS 后进入 Gate 3 v2.0 交付候选。

