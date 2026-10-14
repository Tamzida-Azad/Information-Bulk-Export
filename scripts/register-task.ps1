# Registers Windows Scheduled Task for EOD Generator
# Cadence: weekdays 8:30 PM (local machine time)

$ErrorActionPreference = 'Stop'

$taskName = 'EOD-Generator'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $PSScriptRoot 'run-eod.bat'
$profileDir = Join-Path $projectRoot 'browser-profile'

if (-not (Test-Path $batPath)) {
  throw "Missing runner: $batPath"
}

if (-not (Test-Path $profileDir)) {
  Write-Warning "Dedicated browser profile not found at $profileDir - run: npm run save-auth"
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $projectRoot

$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '8:30PM')
)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$description = 'EOD Generator: scrape configured Slack source channels and post weekday EOD.'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force | Out-Null

Write-Host "Scheduled task registered: $taskName"
Write-Host "Project:  $projectRoot"
Write-Host 'Schedule: Mon-Fri 8:30 PM (local time)'
Write-Host 'Runner:   scripts\run-eod.bat'
Write-Host "Profile:  $profileDir"
Write-Host ''
Write-Host 'Shell commands:'
Write-Host '  npm run generate-eod:dry'
Write-Host '  npm run generate-eod:headed'
Write-Host '  npm run generate-eod:force'
Write-Host '  bash scripts/run-eod.sh'
Write-Host '  npm run save-auth'
