# 独立验收清单契约

```json
{
  "auditId": "AUDIT-20261111-000001",
  "baseline": "v2.0",
  "acceptanceIds": ["AC-065"],
  "returnWorkItem": "WI-026",
  "protectedPaths": ["src", "scripts/lib"],
  "checks": {
    "coverage": { "status": "PASS", "evidence": ".project/traceability.json" },
    "risk": { "status": "PASS", "evidence": "docs/solution-design-v2.md" },
    "contract": { "status": "PASS", "evidence": "evidence/contract-check.md" },
    "finalVerification": { "status": "PASS", "evidence": "evidence/final.md" }
  },
  "independentFixtures": ["acceptance/fixtures/example-pass.json"],
  "retestConditions": ["修复后重新运行受影响验证", "重新执行全部独立样例"]
}
```

- `auditId` 必须唯一且使用 `AUDIT-YYYYMMDD-NNNNNN`。
- 四类检查均必须存在，状态只能是 `PASS` 或 `FAIL`，并引用证据。
- 独立夹具包含 `fixtureId`、`source: INDEPENDENT`、`acceptanceId`、`status` 和 `evidence`。
- 夹具格式错误或 `source` 不是 `INDEPENDENT` 时判为 `AUDIT_ERROR`。
- `protectedPaths` 必须覆盖生产实现与实现测试；报告路径不得位于受保护路径内。

## 复验附加字段

```json
{
  "previousAuditId": "AUDIT-20261111-000001",
  "repairRunId": "RUN-20261111-000002-WI026",
  "repairEvidence": "evidence/RUN-20261111-000002-WI026.md"
}
```

- 三个字段必须同时存在并与 `.project/audit-loop.json` 一致。
- 原失败报告和修复证据必须仍存在，修复证据的最终结果必须为 PASS。
- 复验报告使用新审计编号和新路径；控制器拒绝覆盖原报告。
