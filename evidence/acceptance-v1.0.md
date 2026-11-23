# 需求基线 v1.0 验收映射

| 验收标准 | 自动验证证据 |
| --- | --- |
| AC-001 | `src/lib/ai/ai-parse.test.ts` 结构化字段映射；`task-creation.test.tsx` 结构化创建 |
| AC-002 | `ai-parse-route.test.ts` 仅任务名响应；`task-repository.test.ts` 可选属性创建 |
| AC-003 | `ai-parse.test.ts` 不确定结果；`task-creation.test.tsx` 原文创建及提示 |
| AC-004 | `ai-parse-route.test.ts` 三类失败；`task-creation.test.tsx` 错误与网络降级 |
| AC-005 | `task-ui.test.tsx` 已有任务展示 |
| AC-006 | `task-ui.test.tsx` 空状态 |
| AC-007 | `task-ui.test.tsx` 四类属性编辑；`task-repository.test.ts` 持久保存 |
| AC-008 | `task-ui.test.tsx` 完成及恢复；`task-repository.test.ts` 状态持久化 |
| AC-009 | `task-ui.test.tsx` 取消删除 |
| AC-010 | `task-ui.test.tsx` 永久删除；`task-repository.test.ts` 重载后不存在 |
| AC-011 | `task-ui.test.tsx` 标签匹配；`task-repository.test.ts` 精确筛选 |
| AC-012 | `task-ui.test.tsx` 选中标签无匹配结果 |
| AC-013 | `task-repository.test.ts` 新仓库实例重载本机数据 |
| AC-014 | `task-creation.test.tsx` 确认、拒绝与未授权路径 |
| AC-015 | `task-creation.test.tsx` 空白输入不调用 AI、不创建任务 |

最终项目级验证命令与结果记录在 `evidence/RUN-20261104-161310-WI006.md`。
