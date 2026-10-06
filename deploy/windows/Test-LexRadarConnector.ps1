[CmdletBinding()]
param([switch]$OpenReport)
. (Join-Path $PSScriptRoot 'Common.ps1')

$home=Get-ConnectorHome
$checks=[System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name,[bool]$Ok,[string]$Detail) { $checks.Add([pscustomobject]@{ item=$Name; ok=$Ok; detail=$Detail }) }

try { $config=Read-ConnectorConfig; Add-Check 'Configuracao' $true 'Arquivo valido e legivel.' } catch { Add-Check 'Configuracao' $false $_.Exception.Message; $config=$null }
try { $node=Get-NodeExecutable; $version=& $node --version; Add-Check 'Runtime' ($LASTEXITCODE -eq 0) "Node $version" } catch { Add-Check 'Runtime' $false $_.Exception.Message; $node=$null }
$ssh=Get-Command ssh.exe -ErrorAction SilentlyContinue
Add-Check 'OpenSSH' ([bool]$ssh) $(if($ssh){'Disponivel.'}else{'Recurso OpenSSH Client ausente.'})
if ($config) {
  Add-Check 'Usuario restrito' ($config.vpsUser -ne 'root') $(if($config.vpsUser -eq 'root'){'Configuracao insegura: root.'}else{'Conta dedicada configurada.'})
  Add-Check 'Chave dedicada' (Test-Path -LiteralPath $config.identityFile -PathType Leaf) 'Apenas a existencia foi verificada.'
  Add-Check 'Assinatura da VPS' (Test-Path -LiteralPath $config.knownHostsFile -PathType Leaf) 'Arquivo conhecido encontrado.'
}
if ($node) {
  try {
    $output=& $node (Join-Path $home 'app\src\bridge.js') --dry-run 2>&1 | Select-Object -Last 1
    $parsed=$output | ConvertFrom-Json
    Add-Check 'LexRadar local' ($parsed.event -eq 'bridge.validated') "Base reconhecida; $($parsed.eligible) registro(s) elegivel(is)."
  } catch { Add-Check 'LexRadar local' $false 'Abra o LexRadar uma vez e repita o diagnostico.' }
}
try { $health=Invoke-RestMethod 'http://127.0.0.1:3100/connector/status' -TimeoutSec 2; Add-Check 'Conector ativo' ($health.ready -eq $true) 'Proxy local respondeu.' } catch { Add-Check 'Conector ativo' $false 'Inicie pelo atalho LexRadar Bot.' }
try {
  if (-not $config) { throw 'Sem configuracao.' }
  $health=Invoke-RestMethod "http://127.0.0.1:$($config.tunnelPort)/health" -TimeoutSec 2
  Add-Check 'Tunel seguro' ($health.ok -eq $true) 'API da VPS respondeu pelo loopback.'
} catch { Add-Check 'Tunel seguro' $false 'Tunel indisponivel.' }

$report=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Diagnostico LexRadar Bot.txt'
$lines=@('DIAGNOSTICO LEXRADAR BOT',("Gerado em: {0:u}" -f (Get-Date)),'Nenhum token, chave, telefone, CPF, placa ou caminho privado foi incluido.','')
$lines += $checks | ForEach-Object { "[{0}] {1}: {2}" -f $(if($_.ok){'OK'}else{'FALHA'}),$_.item,$_.detail }
$lines | Set-Content -LiteralPath $report -Encoding UTF8
$checks | Format-Table -AutoSize
Write-Host "Relatorio seguro criado na Area de Trabalho: $(Split-Path $report -Leaf)"
if ($OpenReport) { Start-Process notepad.exe $report }
if ($checks.Where({-not $_.ok}).Count) { exit 1 }
