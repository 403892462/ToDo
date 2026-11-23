param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^WI-\d{3}$')]
    [string]$WorkItem,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^RUN-\d{8}-\d{6}-WI\d{3}$')]
    [string]$RunId
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot '.project/state.md'
$lockPath = Join-Path $projectRoot '.project/lock.md'
$planPath = Join-Path $projectRoot 'plans/plan-first-release.md'
$runPath = Join-Path $projectRoot ".project/runs/$RunId.md"

if (Test-Path -LiteralPath $lockPath) {
    throw '项目锁已存在，必须先按恢复记录处理。'
}

$state = Get-Content -Raw -LiteralPath $statePath
$plan = Get-Content -Raw -LiteralPath $planPath
$baselineMatch = [regex]::Match($state, '(?m)^requirements_baseline:\s*"([^"]+)"\s*$')
if (-not $baselineMatch.Success) {
    throw '状态文件缺少需求基线版本。'
}
$baselineVersion = $baselineMatch.Groups[1].Value
if ($state -notmatch '(?m)^current_stage:\s*IMPLEMENTATION\s*$') {
    throw '当前阶段不是 IMPLEMENTATION。'
}
if ($state -notmatch "(?m)^active_work_item:\s*`"$([regex]::Escape($WorkItem))`"\s*$") {
    throw "状态文件中的活动工作项不是 $WorkItem。"
}
if ($state -notmatch '(?m)^active_run:\s*null\s*$') {
    throw '已有活动运行，不能创建新运行。'
}

$blockPattern = "(?ms)(^## $([regex]::Escape($WorkItem)) .*?)(?=^## |\z)"
$blockMatch = [regex]::Match($plan, $blockPattern)
if (-not $blockMatch.Success -or $blockMatch.Value -notmatch '(?m)^- 状态：READY\s*$') {
    throw "$WorkItem 不存在或不是 READY。"
}

$updatedBlock = [regex]::Replace($blockMatch.Value, '(?m)^- 状态：READY\s*$', '- 状态：IN_PROGRESS', 1)
$plan = $plan.Remove($blockMatch.Index, $blockMatch.Length).Insert($blockMatch.Index, $updatedBlock)
$timestamp = [DateTimeOffset]::Now.ToString('o')
$activeRun = 'active_run: "{0}"' -f $RunId
$state = [regex]::Replace($state, '(?m)^active_run:\s*.+$', $activeRun)
$state = [regex]::Replace($state, '(?m)^updated_at:\s*.+$', ('updated_at: "{0}"' -f $timestamp))

$lock = @"
# 项目锁

- 运行编号：$RunId
- 工作项：$WorkItem
- 需求基线：$baselineVersion
- 开始时间：$timestamp
- 状态：IN_PROGRESS
"@
$run = @"
# 运行记录 $RunId

- 工作项：$WorkItem
- 需求基线：$baselineVersion
- 开始时间：$timestamp
- 状态：IN_PROGRESS
- 预期输入：已批准实施计划、需求基线 $baselineVersion、Node.js/npm 环境
- 已完成动作：创建项目锁并激活运行。
- 未完成动作：实现工作项、运行验证、记录证据、更新状态并释放锁。
"@

Set-Content -LiteralPath $planPath -Value $plan -Encoding utf8
Set-Content -LiteralPath $statePath -Value $state -Encoding utf8
Set-Content -LiteralPath $lockPath -Value $lock -Encoding utf8
Set-Content -LiteralPath $runPath -Value $run -Encoding utf8
Write-Output "已启动 $WorkItem，运行编号 $RunId。"
