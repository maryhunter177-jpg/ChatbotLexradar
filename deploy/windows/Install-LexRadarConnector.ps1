[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9.-]*$')][string]$VpsHost,
  [ValidatePattern('^[a-z_][a-z0-9_-]{0,31}$')][string]$VpsUser,
  [string]$IdentityFile,
  [string]$KnownHostsFile,
  [int]$TunnelPort = 3199,
  [int]$PanelPort = 3100,
  [int]$RemotePort = 3100,
  [int]$SyncIntervalSeconds = 30
)

$ErrorActionPreference='Stop'
if (-not $VpsHost) { $VpsHost=Read-Host 'Endereco da VPS fornecido pelo suporte' }
if (-not $VpsUser) { $VpsUser=Read-Host 'Usuario SSH restrito fornecido pelo suporte' }
if (-not $IdentityFile) { $IdentityFile=Read-Host 'Caminho da chave SSH dedicada' }
if (-not $KnownHostsFile) { $KnownHostsFile=Read-Host 'Caminho do arquivo known_hosts assinado pelo suporte' }
if ($VpsUser -eq 'root') { throw 'Use uma conta SSH restrita e dedicada; root nao e permitido.' }
if ($TunnelPort -eq $PanelPort) { throw 'A porta do tunel e a porta do painel devem ser diferentes.' }
foreach ($port in @($TunnelPort,$PanelPort,$RemotePort)) { if ($port -lt 1 -or $port -gt 65535) { throw 'Porta invalida.' } }
if ($SyncIntervalSeconds -lt 10 -or $SyncIntervalSeconds -gt 3600) { throw 'Intervalo deve ficar entre 10 e 3600 segundos.' }
$identitySource=(Resolve-Path -LiteralPath $IdentityFile).Path
$knownHostsSource=(Resolve-Path -LiteralPath $KnownHostsFile).Path
$packageRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $packageRoot 'src\bridge.js'))) { $packageRoot=(Resolve-Path -LiteralPath $PSScriptRoot).Path }
$scriptSource=Join-Path $packageRoot 'deploy\windows'
if (-not (Test-Path $scriptSource)) { $scriptSource=$PSScriptRoot }

$home=Join-Path $env:LOCALAPPDATA 'LexRadar Bot Connector'
$app=Join-Path $home 'app'; $scripts=Join-Path $home 'scripts'; $secrets=Join-Path $home 'secrets'
New-Item -ItemType Directory -Path $app,$scripts,$secrets,(Join-Path $home 'logs') -Force | Out-Null
Copy-Item (Join-Path $packageRoot 'src') $app -Recurse -Force
Copy-Item (Join-Path $packageRoot 'client') $app -Recurse -Force
Copy-Item (Join-Path $packageRoot 'package.json') $app -Force
Copy-Item (Join-Path $scriptSource 'Common.ps1') $scripts -Force
Copy-Item (Join-Path $scriptSource 'Start-LexRadarConnector.ps1') $scripts -Force
Copy-Item (Join-Path $scriptSource 'Test-LexRadarConnector.ps1') $scripts -Force
Copy-Item (Join-Path $scriptSource 'Uninstall-LexRadarConnector.ps1') $scripts -Force
if (Test-Path (Join-Path $packageRoot 'runtime\node.exe')) { Copy-Item (Join-Path $packageRoot 'runtime') $home -Recurse -Force }

$identityTarget=Join-Path $secrets 'connector-key'
$knownHostsTarget=Join-Path $secrets 'known_hosts'
Copy-Item $identitySource $identityTarget -Force
Copy-Item $knownHostsSource $knownHostsTarget -Force
$windowsIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $secrets /inheritance:r /grant:r "${windowsIdentity}:(OI)(CI)F" | Out-Null

Write-Host 'Cole o token administrativo fornecido pelo responsavel pela VPS.'
$adminToken=Read-Host -AsSecureString
Write-Host 'Cole o token exclusivo da ponte de importacao.'
$bridgeToken=Read-Host -AsSecureString
if ($adminToken.Length -lt 16 -or $bridgeToken.Length -lt 16) { throw 'Os tokens fornecidos sao invalidos ou muito curtos.' }
$adminToken | ConvertFrom-SecureString | Set-Content (Join-Path $secrets 'admin-token.dat')
$bridgeToken | ConvertFrom-SecureString | Set-Content (Join-Path $secrets 'bridge-token.dat')

$version='development'
if (Test-Path (Join-Path $packageRoot 'VERSION')) { $version=(Get-Content (Join-Path $packageRoot 'VERSION') -Raw).Trim() }
@{
  version=$version; vpsHost=$VpsHost; vpsUser=$VpsUser; identityFile=$identityTarget; knownHostsFile=$knownHostsTarget
  tunnelPort=$TunnelPort; panelPort=$PanelPort; remotePort=$RemotePort; syncIntervalMs=($SyncIntervalSeconds*1000)
} | ConvertTo-Json | Set-Content (Join-Path $home 'config.json') -Encoding UTF8

$launcher=Join-Path $scripts 'Start-LexRadarConnector.ps1'
$shell=New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LexRadar Bot.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'LexRadar Bot.lnk'))) {
  $shortcut=$shell.CreateShortcut($shortcutPath); $shortcut.TargetPath='powershell.exe'
  $shortcut.Arguments="-NoProfile -ExecutionPolicy Bypass -File \`"$launcher\`" -Mode Open"
  $shortcut.WorkingDirectory=$home; $shortcut.Save()
}

$taskName='LexRadar Bot Connector'
$arguments="-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$launcher\`" -Mode Worker"
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings=New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Conector local seguro do LexRadar Bot' -Force | Out-Null

Write-Host 'Instalacao concluida. Execute o atalho LexRadar Bot.'
