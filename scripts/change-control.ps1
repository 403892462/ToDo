param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('reopen-requirements', 'reopen-discovery', 'analyze-impact', 'apply-impact')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^CHG-\d{3}$')]
    [string]$ChangeId,

    [string]$ImpactPath,

    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot '.project/state.md'
$changePath = Join-Path $projectRoot 'docs/change-log.md'
$lockPath = Join-Path $projectRoot '.project/lock.md'

if ($Action -ne 'analyze-impact' -and (Test-Path -LiteralPath $lockPath)) { throw '存在项目锁，不能开启需求变更流程。' }
$state = Get-Content -Raw -LiteralPath $statePath
$changes = Get-Content -Raw -LiteralPath $changePath
if ($state -notmatch '(?m)^current_stage:\s*COMPLETED\s*$' -or $state -notmatch '(?m)^stage_status:\s*COMPLETED\s*$') {
    throw '只有已完成且无活动运行的项目可以通过此命令重新进入需求阶段。'
}
$change = [regex]::Match($changes, "(?ms)^## $([regex]::Escape($ChangeId)) .*?(?=^## |\z)")
if (-not $change.Success -or $change.Value -notmatch '(?m)^- 状态：APPROVED\s*$') {
    throw "$ChangeId 不存在或尚未批准。"
}

if ($Action -in @('analyze-impact', 'apply-impact')) {
    if (-not $ImpactPath -or -not (Test-Path -LiteralPath $ImpactPath -PathType Leaf)) {
        throw '影响分析必须提供存在的 -ImpactPath JSON 文件。'
    }
    if (-not $ReportPath) {
        $ReportPath = Join-Path $projectRoot ".project/change-impacts/$ChangeId.md"
    }
    $command = if ($Action -eq 'apply-impact') { 'apply' } else { 'analyze' }
    & node (Join-Path $projectRoot 'scripts/change-impact.mjs') $command $ImpactPath (Join-Path $projectRoot '.project/traceability.json') $ReportPath
    if ($LASTEXITCODE -ne 0) {
        throw "变更影响分析未通过；退出码：$LASTEXITCODE"
    }
    if ($Action -eq 'analyze-impact') {
        Write-Output "已完成 $ChangeId 影响分析；报告：$ReportPath"
        exit 0
    }
}

$timestamp = [DateTimeOffset]::Now.ToString('o')
$targetStage = if ($Action -eq 'reopen-discovery') { 'DISCOVERY' } else { 'REQUIREMENTS' }
$state = [regex]::Replace($state, '(?m)^current_stage:\s*.+$', "current_stage: $targetStage")
$state = [regex]::Replace($state, '(?m)^stage_status:\s*.+$', 'stage_status: IN_PROGRESS')
$state = [regex]::Replace($state, '(?m)^updated_at:\s*.+$', ('updated_at: "{0}"' -f $timestamp))
$state = [regex]::Replace($state, '(?m)^  DISCOVERY:\s*.+$', $(if ($targetStage -eq 'DISCOVERY') { '  DISCOVERY: IN_PROGRESS' } else { '  DISCOVERY: COMPLETED' }))
$state = [regex]::Replace($state, '(?m)^  REQUIREMENTS:\s*.+$', $(if ($targetStage -eq 'REQUIREMENTS') { '  REQUIREMENTS: IN_PROGRESS' } else { '  REQUIREMENTS: INVALIDATED' }))
foreach ($stage in @('SOLUTION_DESIGN', 'PLANNING', 'IMPLEMENTATION', 'VERIFICATION', 'ACCEPTANCE_AUDIT', 'DELIVERY', 'COMPLETED')) {
    $state = [regex]::Replace($state, "(?m)^  ${stage}:\s*.+$", "  ${stage}: INVALIDATED")
}
Set-Content -LiteralPath $statePath -Value $state -Encoding utf8
Write-Output "已按 $ChangeId 重新进入 $targetStage；受影响下游阶段已失效。"
