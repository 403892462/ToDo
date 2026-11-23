# 方案评估契约

## 评估输入

JSON 文件包含：

```json
{
  "changeId": "CHG-011",
  "informationComplete": true,
  "declaredRisk": "LOW",
  "impacts": [],
  "simplificationReason": "仅修改不参与业务判定的说明文字"
}
```

- `changeId`：稳定需求、变更或方案编号。
- `informationComplete`：是否具备判断风险所需信息。
- `declaredRisk`：`LOW`、`MEDIUM` 或 `HIGH`。
- `impacts`：可包含 `data-model`、`security`、`permissions`、`external-system`、`irreversible`、`public-api`、`cross-module`。
- `simplificationReason`：低风险简化方案必填。

## 评估输出

- `status`：`READY` 或 `NEEDS_CONFIRMATION`。
- `riskLevel`：最终风险等级。
- `designDepth`：`SIMPLE`、`FULL` 或 `UNDETERMINED`。
- `reason`：确定该结果的原因。
- `mandatoryFullImpacts`：命中的强制完整方案类别。

评估工具只判定设计深度，不修改需求、方案或项目状态。

