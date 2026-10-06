[CmdletBinding(SupportsShouldProcess)]
param([switch]$KeepDiagnostics)
. (Join-Path $PSScriptRoot 'Common.ps1')

$home=Get-ConnectorHome
$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'LexRadar Bot Connector'))
if ([IO.Path]::GetFullPath($home) -ne $expected -or -not $home.StartsWith([IO.Path]::GetFullPath($env:LOCALAPPDATA),[StringComparison]::OrdinalIgnoreCase)) {
  throw 'Destino de desinstalacao invalido.'
}
Stop-ConnectorProcesses
Unregister-ScheduledTask -TaskName 'LexRadar Bot Connector' -Confirm:$false -ErrorAction SilentlyContinue
foreach ($shortcut in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LexRadar Bot.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'LexRadar Bot.lnk'))) {
  Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
}
if ($KeepDiagnostics -and (Test-Path (Join-Path $home 'logs'))) {
  $destination=Join-Path ([Environment]::GetFolderPath('Desktop')) ("LexRadar-Bot-Logs-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
  Copy-Item (Join-Path $home 'logs') $destination -Recurse
}
if ($PSCmdlet.ShouldProcess($expected,'Remover o conector, configuracao local e credenciais protegidas')) {
  Remove-Item -LiteralPath $expected -Recurse -Force
}
Write-Host 'Conector removido. O LexRadar e os dados dele nao foram alterados.'
