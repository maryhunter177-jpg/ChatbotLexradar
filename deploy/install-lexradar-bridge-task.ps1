[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VpsHost,
  [string]$VpsUser = 'root',
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\lexradar-vps",
  [string]$TaskName = 'LexRadar Bridge',
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'run-lexradar-bridge.ps1')).Path
$project = (Resolve-Path -LiteralPath $ProjectDir).Path
$identity = (Resolve-Path -LiteralPath $IdentityFile).Path
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -VpsHost `"$VpsHost`" -VpsUser `"$VpsUser`" -IdentityFile `"$identity`" -ProjectDir `"$project`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Tunel SSH e ponte somente leitura LexRadar -> bot' -Force | Out-Null
Write-Host "Tarefa '$TaskName' instalada. Ela iniciara no proximo logon."
Write-Host "Para iniciar agora: Start-ScheduledTask -TaskName '$TaskName'"
