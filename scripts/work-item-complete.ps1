param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^WI-\d{3}$')]
    [string]$WorkItem,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^RUN-\d{8}-\d{6}-WI\d{3}$')]
    [string]$RunId,

    [Parameter(Mandatory = $true)]
    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot '.project/state.md'
$lockPath = Join-Path $projectRoot '.project/lock.md'
$planPath = Join-Path $projectRoot 'plans/plan-first-release.md'
$runPath = Join-Path $projectRoot ".project/runs/$RunId.md"
$recoveryPath = Join-Path $projectRoot '.project/recovery.md'
$resolvedEvidence = Join-Path $projectRoot $EvidencePath

foreach ($path in @($statePath, $lockPath, $planPath, $runPath, $resolvedEvidence)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "缺少完成工作项所需文件：$path"
    }
}

$lock = Get-Content -Raw -LiteralPath $lockPath
$state = Get-Content -Raw -LiteralPath $statePath
$plan = Get-Content -Raw -LiteralPath $planPath
$run = Get-Content -Raw -LiteralPath $runPath
if ($lock -notmatch "(?m)^- 运行编号：$([regex]::Escape($RunId))\s*$" -or
    $lock -notmatch "(?m)^- 工作项：$([regex]::Escape($WorkItem))\s*$") {
    throw '项目锁与待完成运行不匹配。'
}
$activeRunPattern = '(?m)^active_run:\s*"{0}"\s*$' -f [regex]::Escape($RunId)
if ($state -notmatch $activeRunPattern) {
    throw '状态文件中的活动运行与待完成运行不匹配。'
}

$blockPattern = "(?ms)(^## $([regex]::Escape($WorkItem)) .*?)(?=^## |\z)"
$blockMatch = [regex]::Match($plan, $blockPattern)
if (-not $blockMatch.Success -or $blockMatch.Value -notmatch '(?m)^- 状态：IN_PROGRESS\s*$') {
    throw "$WorkItem 不存在或不是 IN_PROGRESS。"
}

$updatedBlock = [regex]::Replace($blockMatch.Value, '(?m)^- 状态：IN_PROGRESS\s*$', '- 状态：DONE', 1)
$evidenceLine = '- 验证证据：`{0}`' -f $EvidencePath
$updatedBlock = [regex]::Replace($updatedBlock, '(?m)^- 验证证据：.*$', $evidenceLine, 1)
$plan = $plan.Remove($blockMatch.Index, $blockMatch.Length).Insert($blockMatch.Index, $updatedBlock)

$number = [int]$WorkItem.Substring(3)
$nextWorkItem = 'WI-{0:D3}' -f ($number + 1)
$nextPattern = "(?ms)(^## $([regex]::Escape($nextWorkItem)) .*?)(?=^## |\z)"
$nextMatch = [regex]::Match($plan, $nextPattern)
if ($nextMatch.Success) {
    if ($nextMatch.Value -notmatch '(?m)^- 状态：PENDING\s*$') {
        throw "$nextWorkItem 不是 PENDING，无法激活。"
    }
    $nextBlock = [regex]::Replace($nextMatch.Value, '(?m)^- 状态：PENDING\s*$', '- 状态：READY', 1)
    $plan = $plan.Remove($nextMatch.Index, $nextMatch.Length).Insert($nextMatch.Index, $nextBlock)
    $activeWorkItem = 'active_work_item: "{0}"' -f $nextWorkItem
} else {
    $activeWorkItem = 'active_work_item: null'
}

$timestamp = [DateTimeOffset]::Now.ToString('o')
$state = [regex]::Replace($state, '(?m)^active_work_item:\s*.+$', $activeWorkItem)
$state = [regex]::Replace($state, '(?m)^active_run:\s*.+$', 'active_run: null')
$state = [regex]::Replace($state, '(?m)^last_successful_run:\s*.+$', ('last_successful_run: "{0}"' -f $RunId))
$state = [regex]::Replace($state, '(?m)^updated_at:\s*.+$', ('updated_at: "{0}"' -f $timestamp))
$run = [regex]::Replace($run, '(?m)^- 状态：IN_PROGRESS\s*$', '- 状态：DONE')
$run += "`n- 完成时间：$timestamp`n- 验证证据：$EvidencePath`n- 最终结果：PASS`n"
$recovery = "# 恢复记录`n`n当前没有待恢复运行。`n"

Set-Content -LiteralPath $planPath -Value $plan -Encoding utf8
Set-Content -LiteralPath $statePath -Value $state -Encoding utf8
Set-Content -LiteralPath $runPath -Value $run -Encoding utf8
Set-Content -LiteralPath $recoveryPath -Value $recovery -Encoding utf8
Remove-Item -LiteralPath $lockPath
Write-Output "$WorkItem 已完成；证据为 $EvidencePath；下一工作项为 $nextWorkItem。"
