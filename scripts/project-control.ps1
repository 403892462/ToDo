param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('check', 'advance')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot '.project/state.md'
$discoveryPath = Join-Path $projectRoot 'docs/discovery.md'
$requirementsPath = Join-Path $projectRoot 'docs/requirements.md'
$acceptancePath = Join-Path $projectRoot 'docs/acceptance-catalog.md'
$planPath = Join-Path $projectRoot 'plans/plan-first-release.md'
$deliveryPath = Join-Path $projectRoot 'docs/delivery.md'
$solutionDesignPath = Join-Path $projectRoot 'docs/solution-design-v2.md'
$contractCliPath = Join-Path $projectRoot 'scripts/project-contract.mjs'

function Read-RequiredFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少必需文件：$Path"
    }
    return Get-Content -Raw -LiteralPath $Path
}

function Get-StateValue([string]$Content, [string]$Name) {
    $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name)):\s*([^\r\n]+)$")
    if (-not $match.Success) {
        throw "状态文件缺少字段：$Name"
    }
    return $match.Groups[1].Value.Trim().Trim('"')
}

function Assert-ContractTransition([string]$From, [string]$To) {
    & node $contractCliPath transition $From $To
    if ($LASTEXITCODE -ne 0) {
        throw "Phase 2 契约拒绝阶段转换：$From → $To"
    }
}

function Assert-DiscoveryGate {
    $discovery = Read-RequiredFile $discoveryPath
    if ($discovery -notmatch '(?m)^状态：CONFIRMED\s*$') {
        throw '业务发现文档尚未标记为 CONFIRMED。'
    }
    $versionedGate = [regex]::Match($discovery, '(?ms)^## Gate 1（v\d+\.\d+）确认\s+(.*?)(?=^## |\z)')
    $gateBody = if ($versionedGate.Success) { $versionedGate.Groups[1].Value } else {
        [regex]::Match($discovery, '(?ms)^## Gate 1 确认\s+(.*?)(?=^## |\z)').Groups[1].Value
    }
    if ($gateBody -notmatch '(?m)^- 状态：APPROVED\s*$') {
        throw '当前 Gate 1 尚未批准。'
    }
    if ($gateBody -notmatch '(?m)^- 确认人：\S.+$') {
        throw '当前 Gate 1 缺少确认人。'
    }
    if ($gateBody -notmatch '(?m)^- 确认时间：\S.+$') {
        throw '当前 Gate 1 缺少确认时间。'
    }
}

function Assert-RequirementsGate {
    $requirements = Read-RequiredFile $requirementsPath
    $acceptance = Read-RequiredFile $acceptancePath
    $baselineMatch = [regex]::Match($requirements, '(?m)^基线：Requirements Baseline (v\d+\.\d+)\s*$')
    if (-not $baselineMatch.Success) {
        throw '需求基线缺少有效版本。'
    }
    $baselineVersion = $baselineMatch.Groups[1].Value
    $escapedVersion = [regex]::Escape($baselineVersion)
    $gateMatch = [regex]::Match($requirements, "(?ms)^### Gate 2（$escapedVersion）\s+(.*?)(?=^## |\z)")
    if (-not $gateMatch.Success -or $gateMatch.Groups[1].Value -notmatch '(?m)^- 状态：APPROVED\s*$') {
        throw "Gate 2（$baselineVersion）尚未批准。"
    }
    if ($gateMatch.Groups[1].Value -notmatch "(?m)^- 基线版本：Requirements Baseline $escapedVersion\s*$" -or
        $gateMatch.Groups[1].Value -notmatch '(?m)^- 确认人：\S.+$' -or
        $gateMatch.Groups[1].Value -notmatch '(?m)^- 确认时间：\S.+$') {
        throw 'Gate 2 的版本、确认人或确认时间不完整。'
    }
    if (($requirements + $acceptance) -match 'NEEDS_CONFIRMATION|状态：(?:DRAFT|BLOCKING|PENDING)') {
        throw '需求或验收目录仍包含未确认状态。'
    }

    $frIds = [regex]::Matches($requirements, '(?m)^### (FR-\d{3}) ') | ForEach-Object { $_.Groups[1].Value }
    $linkedAcIds = [regex]::Matches($requirements, '(?m)^- 验收标准：(.+)$') | ForEach-Object {
        [regex]::Matches($_.Groups[1].Value, 'AC-\d{3}') | ForEach-Object { $_.Value }
    }
    $acIds = [regex]::Matches($acceptance, '(?m)^## (AC-\d{3}) ') | ForEach-Object { $_.Groups[1].Value }
    if ($frIds.Count -eq 0 -or $linkedAcIds.Count -lt $frIds.Count) {
        throw '存在未关联验收标准的功能需求。'
    }
    $missing = $linkedAcIds | Where-Object { $_ -notin $acIds } | Select-Object -Unique
    if ($missing) {
        throw "需求引用了不存在的验收标准：$($missing -join ', ')"
    }
}

function Assert-SolutionDesignGate([bool]$EnforceRiskGate = $false) {
    $solution = Read-RequiredFile $solutionDesignPath
    if ($solution -notmatch '(?m)^状态：APPROVED\s*$' -or
        $solution -notmatch '(?m)^需求基线：Requirements Baseline v\d+\.\d+\s*$' -or
        $solution -notmatch '(?m)^风险等级：(?:LOW|MEDIUM|HIGH)\s*$' -or
        $solution -notmatch '(?m)^设计深度：\S.+$') {
        throw '技术方案缺少批准状态、需求基线、风险等级或设计深度。'
    }
    $gate = [regex]::Match($solution, '(?ms)^## 方案确认\s+(.*?)(?=^## |\z)')
    if (-not $gate.Success -or
        $gate.Groups[1].Value -notmatch '(?m)^- 状态：APPROVED\s*$' -or
        $gate.Groups[1].Value -notmatch '(?m)^- 确认人：\S.+$' -or
        $gate.Groups[1].Value -notmatch '(?m)^- 确认时间：\S.+$') {
        throw '技术方案确认信息不完整。'
    }
    if ($EnforceRiskGate) {
        & node (Join-Path $projectRoot 'scripts/solution-design.mjs') gate $solutionDesignPath
        if ($LASTEXITCODE -ne 0) {
            throw '技术方案风险门未通过。'
        }
    }
}

function Assert-PlanGate {
    $plan = Read-RequiredFile $planPath
    if ($plan -notmatch '(?m)^状态：APPROVED\s*$') {
        throw '实施计划尚未标记为 APPROVED。'
    }
    if ($plan -notmatch '(?m)^唯一验证命令：`npm run verify`\s*$') {
        throw '实施计划未定义唯一验证命令 npm run verify。'
    }
    if ($plan -notmatch '(?ms)^## 计划确认\s+.*?^- 状态：APPROVED\s*$' -or
        $plan -notmatch '(?m)^- 确认人：\S.+$' -or
        $plan -notmatch '(?m)^- 确认时间：\S.+$') {
        throw '实施计划确认信息不完整。'
    }
    if ($plan -match 'NEEDS_CONFIRMATION|状态：BLOCKED|状态：FAILED') {
        throw '实施计划仍包含阻塞或失败状态。'
    }
}

function Assert-ImplementationComplete {
    $state = Read-RequiredFile $statePath
    $plan = Read-RequiredFile $planPath
    $workItems = [regex]::Matches($plan, '(?ms)^## WI-\d{3} .*?(?=^## |\z)')
    if ($workItems.Count -eq 0) {
        throw '实施计划中没有工作项。'
    }
    $unfinished = $workItems | Where-Object { $_.Value -notmatch '(?m)^- 状态：DONE\s*$' }
    if ($unfinished) {
        throw '仍有工作项未完成。'
    }
    foreach ($item in $workItems) {
        $evidence = [regex]::Match($item.Value, '(?m)^- 验证证据：`([^`]+)`\s*$')
        if (-not $evidence.Success -or -not (Test-Path -LiteralPath (Join-Path $projectRoot $evidence.Groups[1].Value))) {
            throw '存在已完成工作项缺少验证证据。'
        }
    }
    $lastRun = Get-StateValue $state 'last_successful_run'
    if ($lastRun -notmatch '^RUN-\d{8}-\d{6}-WI\d{3}$') {
        throw '状态文件缺少有效的最后成功运行编号。'
    }
    $finalEvidence = Join-Path $projectRoot "evidence/$lastRun.md"
    $content = Read-RequiredFile $finalEvidence
    if ($content -notmatch '(?m)^- 最终结果：PASS\s*$' -or
        $content -notmatch '(?m)^- 唯一验证命令：`npm run verify`\s*$') {
        throw '最终项目验证证据不完整或未通过。'
    }
}

function Assert-DeliveryGate {
    $delivery = Read-RequiredFile $deliveryPath
    $deliveryStatus = [regex]::Match($delivery, '(?m)^状态：(\S+)\s*$')
    if (-not $deliveryStatus.Success -or $deliveryStatus.Groups[1].Value -ne 'APPROVED') {
        throw '交付文档尚未标记为 APPROVED。'
    }
    $baselineMatch = [regex]::Match($delivery, '(?m)^需求基线：Requirements Baseline (v\d+\.\d+)\s*$')
    if (-not $baselineMatch.Success) {
        throw '交付文档缺少有效需求基线。'
    }
    $escapedVersion = [regex]::Escape($baselineMatch.Groups[1].Value)
    $gate = [regex]::Match($delivery, "(?ms)^## Gate 3（$escapedVersion）确认\s+(.*?)(?=^## |\z)")
    if (-not $gate.Success -or
        $gate.Groups[1].Value -notmatch '(?m)^- 状态：APPROVED\s*$' -or
        $gate.Groups[1].Value -notmatch '(?m)^- 确认人：\S.+$' -or
        $gate.Groups[1].Value -notmatch '(?m)^- 确认时间：\S.+$') {
        throw "Gate 3 $($baselineMatch.Groups[1].Value) 的状态、确认人或确认时间不完整。"
    }
    if ($delivery -notmatch '(?m)^- 最终结果：PASS\s*$' -or
        $delivery -notmatch '(?m)^- 唯一验证命令：`npm run verify`\s*$') {
        throw '交付文档缺少成功的最终验证结果。'
    }
}

function Assert-AcceptanceAuditGate {
    $auditDirectory = Join-Path $projectRoot '.project/audits'
    if (-not (Test-Path -LiteralPath $auditDirectory -PathType Container)) {
        throw '缺少独立验收审计目录。'
    }
    $latest = Get-ChildItem -LiteralPath $auditDirectory -Filter 'AUDIT-*.md' -File |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $latest) {
        throw '缺少独立验收审计报告。'
    }
    $audit = Read-RequiredFile $latest.FullName
    $baseline = Get-StateValue (Read-RequiredFile $statePath) 'requirements_baseline'
    if ($audit -notmatch "(?m)^- 需求基线：$([regex]::Escape($baseline))\s*$" -or
        $audit -notmatch '(?m)^- 审计结果：PASS\s*$' -or
        $audit -notmatch '(?m)^- 生产实现与实现测试摘要：UNCHANGED\s*$') {
        throw "最新独立验收报告未通过、基线不匹配或违反只读边界：$($latest.Name)"
    }
    $loopPath = Join-Path $projectRoot '.project/audit-loop.json'
    if (Test-Path -LiteralPath $loopPath -PathType Leaf) {
        $loop = Get-Content -Raw -LiteralPath $loopPath | ConvertFrom-Json
        $latestAuditId = [regex]::Match($audit, '(?m)^- 审计编号：(AUDIT-\d{8}-\d{6})\s*$').Groups[1].Value
        $lastReaudit = @($loop.reaudits) | Select-Object -Last 1
        if ($loop.status -ne 'CLOSED' -or -not $lastReaudit -or $lastReaudit.auditId -ne $latestAuditId) {
            throw '审计修复循环尚未由最新 PASS 复验关闭。'
        }
    }
}

function Assert-State([string]$State) {
    $temporaryStatePath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase2-state-{0}.md" -f [guid]::NewGuid())
    try {
        Set-Content -LiteralPath $temporaryStatePath -Value $State -Encoding utf8
        & node $contractCliPath state $temporaryStatePath
        if ($LASTEXITCODE -ne 0) {
            throw 'Phase 2 状态契约检查失败。'
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryStatePath) {
            Remove-Item -LiteralPath $temporaryStatePath
        }
    }
    $currentStage = Get-StateValue $State 'current_stage'
    $stageStatus = Get-StateValue $State 'stage_status'
    if ($currentStage -eq 'COMPLETED') {
        if ($stageStatus -ne 'COMPLETED' -or
            $State -notmatch '(?m)^  DELIVERY:\s*COMPLETED\s*$' -or
            $State -notmatch '(?m)^  COMPLETED:\s*COMPLETED\s*$') {
            throw '项目完成状态不一致。'
        }
        return
    }
    if ($stageStatus -ne 'IN_PROGRESS') {
        throw "当前 stage_status 应为 IN_PROGRESS，实际为 $stageStatus。"
    }

    if ($currentStage -eq 'REQUIREMENTS') {
        foreach ($expected in @(
            '  IDEA: COMPLETED',
            '  DISCOVERY: COMPLETED',
            '  REQUIREMENTS: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        return
    }

    if ($currentStage -eq 'PLANNING') {
        foreach ($expected in @(
            '  IDEA: COMPLETED',
            '  DISCOVERY: COMPLETED',
            '  REQUIREMENTS: COMPLETED',
            '  SOLUTION_DESIGN: COMPLETED',
            '  PLANNING: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        if ((Get-StateValue $State 'requirements_baseline') -notmatch '^v\d+\.\d+$') {
            throw '状态文件中的 requirements_baseline 应为有效版本。'
        }
        return
    }

    if ($currentStage -eq 'SOLUTION_DESIGN') {
        foreach ($expected in @(
            '  IDEA: COMPLETED',
            '  DISCOVERY: COMPLETED',
            '  REQUIREMENTS: COMPLETED',
            '  SOLUTION_DESIGN: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        return
    }

    if ($currentStage -eq 'IMPLEMENTATION') {
        foreach ($expected in @(
            '  IDEA: COMPLETED',
            '  DISCOVERY: COMPLETED',
            '  REQUIREMENTS: COMPLETED',
            '  SOLUTION_DESIGN: COMPLETED',
            '  PLANNING: COMPLETED',
            '  IMPLEMENTATION: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        if ((Get-StateValue $State 'verification_command') -ne 'npm run verify') {
            throw '状态文件中的 verification_command 应为 npm run verify。'
        }
        return
    }

    if ($currentStage -eq 'ACCEPTANCE_AUDIT') {
        foreach ($expected in @(
            '  IMPLEMENTATION: COMPLETED',
            '  ACCEPTANCE_AUDIT: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        if ((Get-StateValue $State 'active_work_item') -ne 'null' -or
            (Get-StateValue $State 'active_run') -ne 'null') {
            throw '独立验收阶段不得存在活动执行工作项或运行。'
        }
        return
    }

    if ($currentStage -eq 'DELIVERY') {
        foreach ($expected in @(
            '  IMPLEMENTATION: COMPLETED',
            '  ACCEPTANCE_AUDIT: COMPLETED',
            '  DELIVERY: IN_PROGRESS'
        )) {
            if ($State -notmatch "(?m)^$([regex]::Escape($expected))\s*$") {
                throw "状态不一致，缺少：$expected"
            }
        }
        if ((Get-StateValue $State 'active_work_item') -ne 'null' -or
            (Get-StateValue $State 'active_run') -ne 'null') {
            throw '交付阶段不得存在活动工作项或运行。'
        }
        return
    }

    if ($currentStage -notin @('IDEA', 'DISCOVERY')) {
        throw "当前工具仅支持 Gate 1 校准；当前阶段为 $currentStage。"
    }
}

function Invoke-Check {
    Assert-DiscoveryGate
    $state = Read-RequiredFile $statePath
    Assert-State $state
    $currentStage = Get-StateValue $state 'current_stage'
    if ($currentStage -in @('REQUIREMENTS', 'SOLUTION_DESIGN', 'PLANNING')) {
        Assert-RequirementsGate
    }
    if ($currentStage -in @('PLANNING', 'IMPLEMENTATION', 'ACCEPTANCE_AUDIT', 'DELIVERY', 'COMPLETED')) {
        Assert-SolutionDesignGate ($currentStage -eq 'PLANNING')
        Assert-PlanGate
    }
    if ($currentStage -in @('DELIVERY', 'COMPLETED')) {
        Assert-DeliveryGate
    }
    & node (Join-Path $projectRoot 'scripts/contract-check.mjs')
    if ($LASTEXITCODE -ne 0) {
        throw '自动契约检查未通过。'
    }
    Write-Output "协议检查通过：所需阶段门已批准，当前阶段为 $currentStage。"
}

if ($Action -eq 'check') {
    Invoke-Check
    exit 0
}

Invoke-Check
$state = Read-RequiredFile $statePath
$currentStage = Get-StateValue $state 'current_stage'
if ($currentStage -eq 'COMPLETED') {
    Write-Output '无需推进：项目已处于 COMPLETED。'
    exit 0
}

$updated = $state
$updated = [regex]::Replace($updated, '(?m)^stage_status:\s*.+$', 'stage_status: IN_PROGRESS')
$timestamp = [DateTimeOffset]::Now.ToString('o')
$updatedAt = 'updated_at: "{0}"' -f $timestamp
$updated = [regex]::Replace($updated, '(?m)^updated_at:\s*.+$', $updatedAt)

if ($currentStage -eq 'DELIVERY') {
    Assert-ContractTransition 'DELIVERY' 'COMPLETED'
    Assert-DeliveryGate
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^stage_status:\s*.+$', 'stage_status: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  DELIVERY:\s*.+$', '  DELIVERY: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  COMPLETED:\s*.+$', '  COMPLETED: COMPLETED')
    $expectedStage = 'COMPLETED'
} elseif ($currentStage -eq 'ACCEPTANCE_AUDIT') {
    Assert-ContractTransition 'ACCEPTANCE_AUDIT' 'DELIVERY'
    Assert-AcceptanceAuditGate
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: DELIVERY')
    $updated = [regex]::Replace($updated, '(?m)^  ACCEPTANCE_AUDIT:\s*.+$', '  ACCEPTANCE_AUDIT: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  DELIVERY:\s*.+$', '  DELIVERY: IN_PROGRESS')
    $expectedStage = 'DELIVERY'
} elseif ($currentStage -eq 'IMPLEMENTATION') {
    Assert-ImplementationComplete
    Assert-ContractTransition 'IMPLEMENTATION' 'ACCEPTANCE_AUDIT'
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: ACCEPTANCE_AUDIT')
    $updated = [regex]::Replace($updated, '(?m)^  IMPLEMENTATION:\s*.+$', '  IMPLEMENTATION: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  VERIFICATION:\s*.+$', '  VERIFICATION: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  ACCEPTANCE_AUDIT:\s*.+$', '  ACCEPTANCE_AUDIT: IN_PROGRESS')
    $expectedStage = 'ACCEPTANCE_AUDIT'
} elseif ($currentStage -eq 'PLANNING') {
    Assert-PlanGate
    $plan = Read-RequiredFile $planPath
    $firstPending = [regex]::Match($plan, '(?ms)^## (WI-\d{3}) .*?^- 状态：(READY|PENDING)\s*$')
    if (-not $firstPending.Success) {
        throw '实施计划中没有可启动的工作项。'
    }
    $firstWorkItem = $firstPending.Groups[1].Value
    if ($firstPending.Groups[2].Value -eq 'PENDING') {
        $firstBlock = $firstPending.Value
        $readyBlock = [regex]::Replace($firstBlock, '(?m)^- 状态：PENDING\s*$', '- 状态：READY', 1)
        $plan = $plan.Remove($firstPending.Index, $firstPending.Length).Insert($firstPending.Index, $readyBlock)
        Set-Content -LiteralPath $planPath -Value $plan -Encoding utf8
    }
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: IMPLEMENTATION')
    $updated = [regex]::Replace($updated, '(?m)^verification_command:\s*.+$', 'verification_command: "npm run verify"')
    $updated = [regex]::Replace($updated, '(?m)^active_work_item:\s*.+$', ('active_work_item: "{0}"' -f $firstWorkItem))
    $updated = [regex]::Replace($updated, '(?m)^  PLANNING:\s*.+$', '  PLANNING: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  IMPLEMENTATION:\s*.+$', '  IMPLEMENTATION: IN_PROGRESS')
    $expectedStage = 'IMPLEMENTATION'
} elseif ($currentStage -eq 'SOLUTION_DESIGN') {
    Assert-SolutionDesignGate $true
    Assert-ContractTransition 'SOLUTION_DESIGN' 'PLANNING'
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: PLANNING')
    $updated = [regex]::Replace($updated, '(?m)^  SOLUTION_DESIGN:\s*.+$', '  SOLUTION_DESIGN: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  PLANNING:\s*.+$', '  PLANNING: IN_PROGRESS')
    $expectedStage = 'PLANNING'
} elseif ($currentStage -eq 'REQUIREMENTS') {
    Assert-RequirementsGate
    Assert-ContractTransition 'REQUIREMENTS' 'SOLUTION_DESIGN'
    $requirements = Read-RequiredFile $requirementsPath
    $baselineVersion = [regex]::Match($requirements, '(?m)^基线：Requirements Baseline (v\d+\.\d+)\s*$').Groups[1].Value
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: SOLUTION_DESIGN')
    $updated = [regex]::Replace($updated, '(?m)^requirements_baseline:\s*.+$', ('requirements_baseline: "{0}"' -f $baselineVersion))
    $updated = [regex]::Replace($updated, '(?m)^  REQUIREMENTS:\s*.+$', '  REQUIREMENTS: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  SOLUTION_DESIGN:\s*.+$', '  SOLUTION_DESIGN: IN_PROGRESS')
    $expectedStage = 'SOLUTION_DESIGN'
} else {
    $updated = [regex]::Replace($updated, '(?m)^current_stage:\s*.+$', 'current_stage: REQUIREMENTS')
    $updated = [regex]::Replace($updated, '(?m)^  IDEA:\s*.+$', '  IDEA: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  DISCOVERY:\s*.+$', '  DISCOVERY: COMPLETED')
    $updated = [regex]::Replace($updated, '(?m)^  REQUIREMENTS:\s*.+$', '  REQUIREMENTS: IN_PROGRESS')
    $expectedStage = 'REQUIREMENTS'
}

Set-Content -LiteralPath $statePath -Value $updated -Encoding utf8
$saved = Read-RequiredFile $statePath
Assert-State $saved
if ((Get-StateValue $saved 'current_stage') -ne $expectedStage) {
    throw '状态写入后的阶段校验失败。'
}

Write-Output "阶段推进完成：$expectedStage 已开始。"
