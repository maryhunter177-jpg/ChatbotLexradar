[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Za-z._-]+$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$NodeRuntimeDir,
  [string]$OutputDir = ''
)

$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $OutputDir) { $OutputDir = Join-Path $repo 'artifacts' }
$runtime=(Resolve-Path -LiteralPath $NodeRuntimeDir).Path
$node=Join-Path $runtime 'node.exe'; $license=Join-Path $runtime 'LICENSE'
if (-not (Test-Path $node -PathType Leaf) -or -not (Test-Path $license -PathType Leaf)) { throw 'O runtime deve conter node.exe e LICENSE oficiais.' }
$major=[int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw 'Empacote Node.js 20 ou superior.' }

$destination=Join-Path $OutputDir "LexRadar-Bot-Connector-$Version"
if (Test-Path $destination) { throw "Destino ja existe: $destination" }
New-Item -ItemType Directory -Path $destination,(Join-Path $destination 'runtime') -Force | Out-Null
Copy-Item (Join-Path $repo 'src') $destination -Recurse
Copy-Item (Join-Path $repo 'client') $destination -Recurse
Copy-Item (Join-Path $repo 'package.json') $destination
Copy-Item (Join-Path $PSScriptRoot '*.ps1') $destination
Copy-Item (Join-Path $PSScriptRoot '*.cmd') $destination
Copy-Item $node (Join-Path $destination 'runtime')
Copy-Item $license (Join-Path $destination 'runtime')
Set-Content (Join-Path $destination 'VERSION') $Version -Encoding ASCII
Copy-Item (Join-Path $repo 'docs\CLIENT-CONNECTOR.md') (Join-Path $destination 'LEIA-ME.md')

$forbidden=Get-ChildItem $destination -Recurse -File | Where-Object { $_.Name -in @('.env','config.json','admin-token.dat','bridge-token.dat','connector-key') }
if ($forbidden) { throw 'O pacote contem credencial ou configuracao privada e nao pode ser distribuido.' }
$zip="$destination.zip"
Compress-Archive -Path (Join-Path $destination '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Pacote sem credenciais criado: $zip"
