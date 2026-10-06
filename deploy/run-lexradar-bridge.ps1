[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VpsHost,
  [string]$VpsUser = 'root',
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\lexradar-vps",
  [int]$LocalPort = 3100,
  [int]$RemotePort = 3100,
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  [switch]$Once,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectDir).Path
$identity = (Resolve-Path -LiteralPath $IdentityFile).Path
$envFile = Join-Path $project '.env'
$logDir = Join-Path $project 'logs'

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "Crie $envFile a partir de .env.example." }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw 'OpenSSH Client (ssh.exe) nao encontrado.' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 20 ou superior nao encontrado.' }
if ($LocalPort -lt 1 -or $LocalPort -gt 65535 -or $RemotePort -lt 1 -or $RemotePort -gt 65535) { throw 'Porta invalida.' }

Push-Location $project
try {
  Write-Host 'Validando leitura local do LexRadar (nenhum dado sera enviado)...'
  & node.exe src/bridge.js --dry-run
  if ($LASTEXITCODE -ne 0) { throw 'A validacao local da ponte falhou.' }
  if ($DryRun) {
    Write-Host "OK: a ponte usara 127.0.0.1:$LocalPort -> $VpsHost`:127.0.0.1:$RemotePort."
    return
  }

  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $sshArgs = @(
    '-N', '-T',
    '-i', $identity,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', "127.0.0.1:$LocalPort`:127.0.0.1:$RemotePort",
    "$VpsUser@$VpsHost"
  )

  do {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $sshLog = Join-Path $logDir "bridge-ssh-$stamp.log"
    $bridgeOut = Join-Path $logDir "bridge-$stamp.log"
    $bridgeErr = Join-Path $logDir "bridge-$stamp.err.log"
    $ssh = $null
    $bridge = $null
    try {
      $ssh = Start-Process -FilePath 'ssh.exe' -ArgumentList $sshArgs -PassThru -WindowStyle Hidden -RedirectStandardError $sshLog
      $healthy = $false
      foreach ($attempt in 1..15) {
        if ($ssh.HasExited) { throw "O tunel SSH encerrou. Consulte $sshLog" }
        try {
          $health = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/health" -TimeoutSec 2
          if ($health.ok -eq $true) { $healthy = $true; break }
        } catch { Start-Sleep -Seconds 1 }
      }
      if (-not $healthy) { throw 'O tunel abriu, mas o health check do bot nao respondeu.' }
      Write-Host "Tunel seguro ativo em 127.0.0.1:$LocalPort."

      $bridgeArgs = @('src/bridge.js')
      if ($Once) { $bridgeArgs += '--once' }
      $bridge = Start-Process -FilePath 'node.exe' -ArgumentList $bridgeArgs -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr
      while (-not $bridge.HasExited -and -not $ssh.HasExited) { Start-Sleep -Seconds 2 }
      if ($Once -and $bridge.HasExited) {
        if ($bridge.ExitCode -ne 0) { throw "A sincronizacao falhou. Consulte $bridgeErr" }
        Write-Host "Sincronizacao concluida. Consulte $bridgeOut"
        break
      }
      Write-Warning 'Tunel ou ponte encerrou; nova tentativa em 5 segundos.'
    } finally {
      if ($bridge -and -not $bridge.HasExited) { Stop-Process -Id $bridge.Id -ErrorAction SilentlyContinue }
      if ($ssh -and -not $ssh.HasExited) { Stop-Process -Id $ssh.Id -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Seconds 5
  } while (-not $Once)
} finally {
  Pop-Location
}
