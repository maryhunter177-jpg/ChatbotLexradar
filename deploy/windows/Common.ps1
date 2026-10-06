Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ConnectorHome { Join-Path $env:LOCALAPPDATA 'LexRadar Bot Connector' }
function Get-ConnectorConfigPath { Join-Path (Get-ConnectorHome) 'config.json' }

function Read-ConnectorConfig {
  $file = Get-ConnectorConfigPath
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Conector nao configurado. Execute Instalar.cmd.' }
  Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Unprotect-ConnectorSecret([string]$Name) {
  $file = Join-Path (Join-Path (Get-ConnectorHome) 'secrets') "$Name.dat"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Credencial $Name nao encontrada. Reinstale o conector." }
  $secure = Get-Content -LiteralPath $file -Raw | ConvertTo-SecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-NodeExecutable {
  $bundled = Join-Path (Get-ConnectorHome) 'runtime\node.exe'
  if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { throw 'Runtime Node.js nao encontrado. Reinstale usando o pacote completo do conector.' }
  $major = [int]((& $command.Source --version).TrimStart('v').Split('.')[0])
  if ($major -lt 20) { throw 'Node.js 20 ou superior e necessario.' }
  $command.Source
}

function Write-ConnectorStatus([hashtable]$Values) {
  $home = Get-ConnectorHome
  $file = Join-Path $home 'status.json'
  $current = @{}
  if (Test-Path -LiteralPath $file) {
    try { (Get-Content $file -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $current[$_.Name] = $_.Value } } catch {}
  }
  foreach ($entry in $Values.GetEnumerator()) { $current[$entry.Key] = $entry.Value }
  $temporary = "$file.tmp"
  $current | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $file -Force
}

function Stop-ConnectorProcesses {
  $file = Join-Path (Get-ConnectorHome) 'pids.json'
  if (-not (Test-Path -LiteralPath $file)) { return }
  try { $pids = Get-Content $file -Raw | ConvertFrom-Json } catch { return }
  foreach ($id in @($pids.bridge, $pids.proxy, $pids.ssh)) {
    if (-not $id) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -like '*LexRadar Bot Connector*') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
