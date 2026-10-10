# ============================================================
#  构建 Android APK（debug 版）
#  文件编码：UTF-8 with BOM（勿去掉 BOM，否则 PowerShell 5.1 读中文会乱码）
#  依赖：JDK 17、Android SDK（platform 34 + build-tools 34）
#  用法：powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
# ============================================================

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$android = Join-Path $frontend 'android'

function Write-Step($t) { Write-Host $t -ForegroundColor Cyan }
function Write-Ok($t) { Write-Host $t -ForegroundColor Green }
function Write-Err($t) { Write-Host $t -ForegroundColor Red }

# —— 定位 JDK 17（AGP 8.2 / Gradle 8.2 不支持 JDK 21）——
$jdkCandidates = @(
    'C:\Program Files\Microsoft\jdk-17.0.14.7-hotspot',
    'C:\Program Files\Eclipse Adoptium\jdk-17',
    'C:\Program Files\Java\jdk-17',
    (Join-Path $env:USERPROFILE '.jdks\jdk-17')
)
$jdk = $jdkCandidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
if (-not $jdk) {
    $found = Get-ChildItem 'C:\Program Files' -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'jdk-17|jdk17' } | Select-Object -First 1
    if ($found) { $jdk = $found.FullName }
}
if (-not $jdk) {
    Write-Err '[错误] 未找到 JDK 17（AGP 8.2 需要 JDK 17，JDK 21 会失败）'
    Write-Err '       请安装 JDK 17 后重试，或修改本脚本顶部的 $jdkCandidates'
    exit 1
}
$env:JAVA_HOME = $jdk
Write-Step "使用 JDK: $jdk"

# —— 检查 Android SDK ——
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) {
    Write-Err "[错误] 未找到 Android SDK：$sdk"
    Write-Err '       请安装 Android SDK（platform 34 + build-tools 34），或设置 ANDROID_HOME'
    exit 1
}
$localProps = Join-Path $android 'local.properties'
"sdk.dir=" + ($sdk -replace '\\', '\\') | Set-Content -Path $localProps -Encoding ASCII
Write-Step "使用 Android SDK: $sdk"

# —— 1. 构建前端 ——
Write-Step '[1/3] 构建前端资源（vite build）...'
Push-Location $frontend
& npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err '前端构建失败'; exit 1 }

# —— 2. 同步到 Android 工程 ——
Write-Step '[2/3] 同步资源到 Android 工程（cap sync）...'
& npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err 'cap sync 失败'; exit 1 }
Pop-Location

# —— 3. 打包 APK ——
Write-Step '[3/3] Gradle 打包 APK（首次会下载依赖，请耐心等待）...'
Push-Location $android
& '.\gradlew.bat' assembleDebug
$rc = $LASTEXITCODE
Pop-Location

$apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
if ($rc -eq 0 -and (Test-Path $apk)) {
    $size = [Math]::Round((Get-Item $apk).Length / 1MB, 1)
    Write-Host ''
    Write-Ok "构建成功：$apk  ($size MB)"
    Write-Host '安装：手机连电脑后执行  adb install -r "' -NoNewline
    Write-Host $apk -NoNewline
    Write-Host '"'
    Write-Host '或把 APK 传到手机点击安装。'
    exit 0
} else {
    Write-Err '构建失败，请查看上方 Gradle 输出'
    exit 1
}
