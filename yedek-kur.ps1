# Fabrika Bakım — günlük otomatik yedek görevi kurulumu
# Kullanım: yedek-kur.bat  (veya: powershell -ExecutionPolicy Bypass -File yedek-kur.ps1)

param(
  [string]$Time = '02:00',
  [string]$TaskName = 'FabrikaBakim-Gunluk-Yedek'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'backend\scripts\proje-yedek.js'

if (-not (Test-Path -LiteralPath $script)) {
  throw "Yedek betiği bulunamadı: $script"
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { throw 'Node.js bulunamadı. Önce Node.js 20+ kurun.' }
$node = $nodeCmd.Source

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$script`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Fabrika Bakım projesini (kod + veri + dosyalar) her gün yedekler.' `
    -RunLevel Limited `
    -Force | Out-Null
} catch {
  Write-Host ''
  Write-Host 'Görev oluşturulamadı:' $_.Exception.Message -ForegroundColor Red
  Write-Host 'Bu pencereyi "Yönetici olarak çalıştır" ile açıp tekrar deneyin.'
  exit 1
}

Write-Host ''
Write-Host "Görev oluşturuldu: $TaskName" -ForegroundColor Green
Write-Host "  Saat     : her gün $Time"
Write-Host "  Node     : $node"
Write-Host "  Betik    : $script"
Write-Host "  Çalışma  : $root"
Write-Host ''
Write-Host 'Bilgisayar kapalıysa görev, açıldığında ilk fırsatta çalışır.'
Write-Host 'Hemen bir yedek almak için: yedek-al.bat'
Write-Host 'Görevi kaldırmak için     : yedek-kaldir.bat'
