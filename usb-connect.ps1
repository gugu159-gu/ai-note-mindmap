# ============================================================
#  用数据线连接手机与电脑后端（USB 通道）
#  原理：adb reverse 把「手机上的 127.0.0.1:8000」反向映射到「电脑的 8000 端口」，
#        于是手机 App 通过数据线即可访问电脑后端，无需 Wi-Fi、无需局域网暴露。
#  文件编码：UTF-8 with BOM（勿去 BOM），换行：CRLF
#  用法：powershell -ExecutionPolicy Bypass -File .\usb-connect.ps1
# ============================================================

param(
    [int]$Port = 8000,
    [switch]$StartBackend
)

try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Write-Step($t) { Write-Host $t -ForegroundColor Cyan }
function Write-Ok($t) { Write-Host $t -ForegroundColor Green }
function Write-Warn($t) { Write-Host $t -ForegroundColor Yellow }
function Write-Err($t) { Write-Host $t -ForegroundColor Red }

# —— 定位 adb ——
$adbCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
    'C:\Android\Sdk\platform-tools\adb.exe'
)
if ($env:ANDROID_HOME) { $adbCandidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
if ($env:ANDROID_SDK_ROOT) { $adbCandidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
$adb = $adbCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $adb) {
    Write-Err '[错误] 未找到 adb.exe，请安装 Android SDK platform-tools 或设置 ANDROID_HOME'
    exit 1
}
Write-Step "adb: $adb"

# —— 等待设备就绪 ——
Write-Step '检查手机连接（需已开启 USB 调试并在手机上允许本电脑）...'
& $adb start-server | Out-Null
$state = ''
for ($i = 0; $i -lt 20; $i++) {
    $out = (& $adb devices) -join "`n"
    if ($out -match '(?m)^\S+\s+device\s*$') { $state = 'device'; break }
    if ($out -match 'unauthorized') { $state = 'unauthorized'; break }
    if ($out -match 'offline') { $state = 'offline'; break }
    Start-Sleep -Milliseconds 700
}

switch ($state) {
    'device' { Write-Ok '  手机已授权 ✓' }
    'unauthorized' {
        Write-Err '  手机未授权：请在手机屏幕上点「允许 USB 调试」并勾选「一律允许」'
        exit 2
    }
    'offline' {
        Write-Err '  设备 offline：解锁手机 → 开发者选项里关掉再打开「USB 调试」→ 重新插线'
        Write-Warn '   （HyperOS/MIUI 若反复掉线，建议改用「无线调试」配对）'
        exit 3
    }
    default {
        Write-Err '  未检测到手机：检查数据线（需支持数据传输）、USB 模式选「传输文件(MTP)」'
        exit 4
    }
}

# —— 建立反向端口映射 ——
Write-Step "建立 USB 反向映射：手机 127.0.0.1:$Port → 电脑 $Port ..."
& $adb reverse --remove-all 2>$null | Out-Null
& $adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
$list = (& $adb reverse --list) -join ' '
if ($list -match "tcp:$Port") {
    Write-Ok "  映射已建立：$list"
} else {
    Write-Err '  映射建立失败'
    exit 5
}

# —— 可选：顺带启动后端（USB 通道下后端只需监听本机 127.0.0.1，无需暴露到局域网）——
$backendUp = $false
try {
    $resp = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 4
    $backendUp = ($resp.status -eq 'ok')
} catch { $backendUp = $false }

if (-not $backendUp -and $StartBackend) {
    $py = Join-Path $root 'backend\.venv\Scripts\python.exe'
    if (Test-Path $py) {
        Write-Step '启动后端（仅本机监听）...'
        Start-Process -FilePath $py `
            -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port") `
            -WorkingDirectory (Join-Path $root 'backend')
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3).status -eq 'ok') { $backendUp = $true; break } } catch { }
        }
    } else {
        Write-Warn "  未找到后端虚拟环境：$py"
    }
}

if ($backendUp) { Write-Ok "  电脑后端正常：http://127.0.0.1:$Port" }
else { Write-Warn "  电脑后端未运行，请先执行 .\start.ps1（或用本脚本加 -StartBackend）" }

# —— 手机端配置指引 ——
Write-Host ''
Write-Host '──────── 手机 App 里这样填 ────────' -ForegroundColor DarkCyan
Write-Host "  1. 打开 App → 登录页底部「⚙ 服务器设置」"
Write-Host "  2. 后端地址填： http://127.0.0.1:$Port"
Write-Host '  3. 点「保存」→「测试连接」，显示「连接成功」即可'
Write-Host '  4. 之后注册/登录，数据将保存在电脑的 SQLite 中'
Write-Host ''
Write-Host '注意：' -ForegroundColor Yellow
Write-Host '  · 拔掉数据线或重启 adb 后映射会失效，重新运行本脚本即可'
Write-Host '  · 本模式下后端只需监听 127.0.0.1，不必暴露到局域网（更安全）'
Write-Host '  · 想改用「本机独立」模式：App 登录页点「← 切换使用方式」'
Write-Host ''

if (-not $backendUp) { exit 6 }
exit 0
