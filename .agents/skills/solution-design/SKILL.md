---
name: solution-design
description: 在需求基线或已批准变更进入实施规划前，评估技术影响与风险，选择简化或完整方案，并以风险门阻止信息不足或未处理高风险进入规划。
---

# 技术方案设计

把已批准需求转化为可供实施规划引用的技术方案。此 Skill 不修改业务事实，不替代需求确认，也不直接实施方案。

## 首先读取

- `AGENTS.md` 与 `docs/phase2-contract.md`；
- `.project/state.md`；
- 当前需求基线、验收目录和适用的 `CHG-*`；
- 适用的 UI Gate、现有架构约束和相关实现边界；
- 已存在的方案与风险登记。

## 风险评估

1. 所有变更都必须形成风险评估，不得因改动看似简单而跳过。
2. 信息不足以判断影响时，输出 `NEEDS_CONFIRMATION` 并停止，不得默认低风险。
3. 命中数据模型、安全、权限、外部系统、不可逆操作、公共 API 或跨模块修改时，强制使用完整方案。
4. 未命中上述类别且风险为 `LOW` 时，可使用简化方案，但必须记录简化理由和影响边界。
5. `MEDIUM`、`HIGH` 或任一强制完整方案类别都使用完整方案。

使用 `node scripts/solution-design.mjs assess <assessment.json>` 生成确定性的分级结果。输入格式见 [方案契约](references/contract.md)。

## 方案产物

- 简化方案使用 `.project/templates/solution-design-simple.md`。
- 完整方案使用 `.project/templates/solution-design-full.md`。
- 风险登记使用 `.project/templates/risk-register.md`。
- 方案必须引用需求基线或已批准变更，并记录范围、影响、失败处理、验证策略和状态。
- 不在方案、风险或证据中记录密钥、完整环境变量或不必要的生产数据。

## 方案门

方案负责人确认前运行：

```text
node scripts/solution-design.mjs gate <方案文件>
```

以下任一情况必须失败：

- 方案结构或必需字段无法解析；
- 状态不是 `APPROVED`；
- 风险等级或设计深度与规则不一致；
- 存在状态为 `OPEN`、`PENDING` 或 `NEEDS_CONFIRMATION` 的高风险；
- 高风险没有关闭、缓解，或没有负责人明确接受。

只有方案门通过后才能进入实施规划。受控阶段推进仍由项目状态工具执行。

## 边界与恢复

- 需求含糊时返回需求流程确认，不自行补业务规则。
- 方案变化若改变已批准业务事实，必须创建 `CHG-*`，不得静默修改需求。
- 工具或文档解析失败时按失败关闭；修复结构后重新运行，不手工伪造通过结果。
- 已批准方案发生变化时保留原记录，并按变更影响规则使受影响下游产物失效。

