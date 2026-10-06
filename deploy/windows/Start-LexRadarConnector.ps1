[CmdletBinding()]
param([ValidateSet('Open','Worker','Stop')][string]$Mode = 'Open')

. (Join-Path $PSScriptRoot 'Common.ps1')
$home = Get-ConnectorHome

if ($Mode -eq 'Stop') { Stop-ConnectorProcesses; Write-Host 'Conector encerrado.'; exit 0 }

if ($Mode -eq 'Open') {
  $status = $null
  try { $status = Invoke-RestMethod 'http://127.0.0.1:3100/connector/status' -TimeoutSec 2 } catch {}
  if (-not $status) {
    $workerArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$PSCommandPath\`" -Mode Worker"
    Start-Process powershell.exe -ArgumentList $workerArguments -WindowStyle Hidden
    foreach ($attempt in 1..20) {
      Start-Sleep -Milliseconds 500
      try { $status = Invoke-RestMethod 'http://127.0.0.1:3100/connector/status' -TimeoutSec 1; break } catch {}
    }
  }
  if (-not $status) { throw 'O conector nao iniciou. Execute Diagnostico.cmd e envie o relatorio ao suporte.' }
  Start-Process 'http://127.0.0.1:3100'
  exit 0
}

$createdNew = $false
$mutex = [Threading.Mutex]::new($true, 'Local\LexRadarBotConnector', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

$config = Read-ConnectorConfig
$node = Get-NodeExecutable
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) { throw 'Cliente OpenSSH do Windows nao encontrado. Instale o recurso OpenSSH Client.' }
if ($config.vpsUser -eq 'root') { throw 'A conta root nao e aceita no conector do cliente.' }
if (-not (Test-Path -LiteralPath $config.identityFile -PathType Leaf)) { throw 'Chave SSH dedicada nao encontrada.' }
if (-not (Test-Path -LiteralPath $config.knownHostsFile -PathType Leaf)) { throw 'Assinatura publica da VPS nao encontrada.' }

$logDir = Join-Path $home 'logs'; New-Item -ItemType Directory $logDir -Force | Out-Null
$sshLog = Join-Path $logDir 'ssh.log'; $bridgeLog = Join-Path $logDir 'bridge.log'; $proxyLog = Join-Path $logDir 'proxy.log'
$adminToken = Unprotect-ConnectorSecret 'admin-token'
$bridgeToken = Unprotect-ConnectorSecret 'bridge-token'
$quotedIdentity='"{0}"' -f $config.identityFile
$knownHostsOption='"UserKnownHostsFile={0}"' -f $config.knownHostsFile
$sshArgs = @('-N','-T','-i',$quotedIdentity,'-o',$knownHostsOption,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-L',"127.0.0.1:$($config.tunnelPort):127.0.0.1:$($config.remotePort)","$($config.vpsUser)@$($config.vpsHost)")

$sshProcess = $bridgeProcess = $proxyProcess = $null
$failed = $false
try {
  Write-ConnectorStatus @{ tunnelConnected=$false }
  $sshProcess = Start-Process $ssh.Source -ArgumentList $sshArgs -PassThru -WindowStyle Hidden -RedirectStandardError $sshLog
  $healthy = $false
  foreach ($attempt in 1..20) {
    if ($sshProcess.HasExited) { throw 'O tunel SSH foi encerrado. Consulte o diagnostico.' }
    try { $health = Invoke-RestMethod "http://127.0.0.1:$($config.tunnelPort)/health" -TimeoutSec 1; if ($health.ok) { $healthy=$true; break } } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $healthy) { throw 'A VPS nao respondeu pelo tunel seguro.' }

  $env:BOT_ADMIN_TOKEN = $adminToken
  $env:CONNECTOR_PANEL_PORT = [string]$config.panelPort
  $env:CONNECTOR_UPSTREAM_URL = "http://127.0.0.1:$($config.tunnelPort)"
  $env:CONNECTOR_STATUS_FILE = Join-Path $home 'status.json'
  $env:CONNECTOR_VERSION = [string]$config.version
  $proxyProcess = Start-Process $node -ArgumentList @('client/connector-proxy.js') -WorkingDirectory (Join-Path $home 'app') -PassThru -WindowStyle Hidden -RedirectStandardOutput $proxyLog -RedirectStandardError (Join-Path $logDir 'proxy-error.log')

  Remove-Item Env:BOT_ADMIN_TOKEN -ErrorAction SilentlyContinue
  $adminToken = $null
  $env:BOT_BRIDGE_TOKEN = $bridgeToken
  $env:BOT_REMOTE_URL = "http://127.0.0.1:$($config.tunnelPort)"
  $env:BRIDGE_INTERVAL_MS = [string]$config.syncIntervalMs
  $env:LEXRADAR_STATE_PATH = ''
  $bridgeProcess = Start-Process $node -ArgumentList @('src/bridge.js') -WorkingDirectory (Join-Path $home 'app') -PassThru -WindowStyle Hidden -RedirectStandardOutput $bridgeLog -RedirectStandardError (Join-Path $logDir 'bridge-error.log')
  Remove-Item Env:BOT_BRIDGE_TOKEN -ErrorAction SilentlyContinue
  $bridgeToken = $null

  @{ ssh=$sshProcess.Id; proxy=$proxyProcess.Id; bridge=$bridgeProcess.Id } | ConvertTo-Json | Set-Content (Join-Path $home 'pids.json') -Encoding UTF8
  Write-ConnectorStatus @{ tunnelConnected=$true; startedAt=(Get-Date).ToUniversalTime().ToString('o') }
  while (-not $sshProcess.HasExited -and -not $bridgeProcess.HasExited -and -not $proxyProcess.HasExited) {
    Start-Sleep -Seconds 5
    try {
      $last = Get-Content $bridgeLog -Tail 1 | ConvertFrom-Json
      if ($last.event -eq 'bridge.synced') { Write-ConnectorStatus @{ lexradarDetected=$true; lastSyncAt=(Get-Date).ToUniversalTime().ToString('o'); eligibleCount=[int]$last.eligible } }
    } catch {}
  }
  throw 'Um componente do conector foi encerrado inesperadamente.'
} catch {
  $failed = $true
  Write-ConnectorStatus @{ tunnelConnected=$false; error='Falha de conexao. Execute o diagnostico.' }
  $_ | Out-String | Add-Content (Join-Path $logDir 'connector-error.log')
} finally {
  foreach ($process in @($bridgeProcess,$proxyProcess,$sshProcess)) { if ($process -and -not $process.HasExited) { Stop-Process $process.Id -Force -ErrorAction SilentlyContinue } }
  Remove-Item Env:BOT_ADMIN_TOKEN,Env:BOT_BRIDGE_TOKEN -ErrorAction SilentlyContinue
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
if ($failed) { exit 1 }
