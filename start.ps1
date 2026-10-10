# ============================================================
#  AI 笔记工具 —— 一键启动脚本
#  文件编码：**UTF-8 with BOM**（务必保留 BOM，否则 Windows PowerShell 5.1
#  会按 ANSI/GBK 解析本文件，导致中文乱码甚至语法错误）
#  换行：CRLF
#  用法：双击 start.bat，或执行
#        pwsh -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
#        手机 App 联调用：.\start.ps1 -Lan   （后端绑定 0.0.0.0，供局域网访问）
# ============================================================

param(
    [switch]$Lan   # 允许手机/局域网访问后端
)

# 控制台按 UTF-8 输出，保证中文提示正确显示
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # 某些宿主不支持设置输出编码，忽略即可
}

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$frontend = Join-Path $root 'frontend'
$backend = Join-Path $root 'backend'
$BACKEND_PORT = 8000
$FRONTEND_PORT = 5173
$bindHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

function Write-Step($text) { Write-Host $text -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host $text -ForegroundColor Green }
function Write-Warn($text) { Write-Host $text -ForegroundColor Yellow }
function Write-Err($text) { Write-Host $text -ForegroundColor Red }

function Test-Port($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

Write-Host ''
Write-Host '============================================' -ForegroundColor DarkCyan
Write-Host '  AI 笔记工具 · 一键启动' -ForegroundColor DarkCyan
Write-Host '============================================' -ForegroundColor DarkCyan
Write-Host ''

# —— 环境自检 ——
if (-not (Test-Path $py)) {
    Write-Err "[错误] 未找到后端虚拟环境：$py"
    Write-Warn '首次使用请初始化：'
    Write-Warn '  cd backend'
    Write-Warn '  python -m venv .venv'
    Write-Warn '  .venv\Scripts\pip install -r requirements.txt'
    Write-Warn '  （可选 OCR）  .venv\Scripts\pip install -r requirements-ocr.txt'
    exit 1
}
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Err "[错误] 前端依赖未安装"
    Write-Warn '请先执行：cd frontend ; npm install'
    exit 1
}

# —— 端口占用检查（避免重复启动）——
$backendRunning = Test-Port $BACKEND_PORT
$frontendRunning = Test-Port $FRONTEND_PORT

if ($backendRunning) { Write-Warn "后端端口 $BACKEND_PORT 已在监听，跳过启动" }
if ($frontendRunning) { Write-Warn "前端端口 $FRONTEND_PORT 已在监听，跳过启动" }

# —— 启动后端 ——
if (-not $backendRunning) {
    $shown = if ($Lan) { "0.0.0.0（局域网可访问）" } else { '127.0.0.1（仅本机）' }
    Write-Step "启动后端 FastAPI（$shown，端口 $BACKEND_PORT）..."
    Start-Process -FilePath $py `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', $bindHost, '--port', "$BACKEND_PORT") `
        -WorkingDirectory $backend
}

# —— 启动前端 ——
if (-not $frontendRunning) {
    Write-Step "启动前端 Vite（http://127.0.0.1:$FRONTEND_PORT）..."
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/k', 'npm run dev') `
        -WorkingDirectory $frontend
}

# —— 等待服务就绪 ——
function Wait-Ready($port, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Write-Host ''
Write-Step '等待服务就绪...'
$backendReady = Wait-Ready $BACKEND_PORT 40
$frontendReady = Wait-Ready $FRONTEND_PORT 40

Write-Host ''
if ($backendReady) { Write-Ok "  [OK] 后端就绪   http://127.0.0.1:$BACKEND_PORT  （接口文档 /docs）" }
else { Write-Err "  [失败] 后端未在 40 秒内就绪，请查看后端窗口的错误信息" }

if ($frontendReady) { Write-Ok "  [OK] 前端就绪   http://127.0.0.1:$FRONTEND_PORT" }
else { Write-Err "  [失败] 前端未在 40 秒内就绪，请查看前端窗口的错误信息" }

Write-Host ''
Write-Host '提示：未配置 API Key 时自动使用本地规则提取（断网也能演示）。' -ForegroundColor DarkGray
Write-Host '      关闭服务：直接关掉「后端」「前端」两个命令行窗口即可。' -ForegroundColor DarkGray

# —— 手机 App 联调提示 ——
if ($Lan) {
    Write-Host ''
    Write-Step '手机 App 连接地址（在 App 登录页「⚙ 服务器设置」里填写）：'
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -ExpandProperty IPAddress
        if ($ips) {
            foreach ($ip in $ips) { Write-Host ("     http://" + $ip + ":$BACKEND_PORT") -ForegroundColor Green }
        } else {
            Write-Warn '     未检测到局域网 IP，请用 ipconfig 查看'
        }
    } catch {
        Write-Warn '     获取 IP 失败，请用 ipconfig 查看本机地址'
    }
    Write-Host '   注意：手机与电脑需在同一 Wi-Fi；首次运行若弹出 Windows 防火墙提示，请选择「允许访问」。' -ForegroundColor Yellow
}
Write-Host ''

if ($frontendReady) {
    Start-Process "http://127.0.0.1:$FRONTEND_PORT"
} elseif ($backendReady) {
    Start-Process "http://127.0.0.1:$BACKEND_PORT/docs"
}

if (-not ($backendReady -and $frontendReady)) { exit 1 }
exit 0
