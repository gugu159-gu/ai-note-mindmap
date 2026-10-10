# AI 笔记工具

上传课件（PDF/PPTX）或拍照 → 自动提取知识点 → 生成可交互思维导图。

> 6 人小组 / 课程设计：**砍功能不砍主线**（上传 → 解析 → 提取 → 导图）。

## 快速开始

### 方式一：一键启动（Windows）

```bat
start.bat
```

或 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会分别拉起后端（8000）与前端（5173），**等待端口真正就绪后**再打开浏览器；
若端口已在监听则跳过重复启动。关闭服务只需关掉弹出的两个命令行窗口。

> ⚠️ **启动脚本编码约束（改动时务必遵守，否则中文报错）**
> - `start.bat`：**纯 ASCII、CRLF 换行、不加 BOM**。cmd.exe 用系统 OEM 代码页（简中为 936/GBK）解析 .bat，写入中文会乱码或直接解析失败。所有中文提示都放在 `start.ps1` 里。
> - `start.ps1`：**必须保存为 UTF-8 with BOM、CRLF**。Windows PowerShell 5.1 对无 BOM 脚本按 ANSI/GBK 读取，会导致中文乱码甚至语法错误。
> - 脚本内部已设置 `[Console]::OutputEncoding = UTF-8`，配合 .bat 中的 `chcp 65001` 保证中文正确显示。

### 方式二：手动启动

**后端（FastAPI + SQLite）**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows；Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://127.0.0.1:8000  （Swagger: /docs）
```

> 可选：图片/扫描件 OCR 依赖 `rapidocr + onnxruntime`（见 requirements-ocr.txt）。
> 安装失败不影响 PDF/PPT/文本主线，上传图片时会提示安装。

**前端（Vue3 + Vite + markmap）**

```bash
cd frontend
npm install
npm run dev                     # http://127.0.0.1:5173（/api 已代理到后端）
```

### 测试（兜底管线，无需 API Key）

```bash
cd backend
python tests/test_pipeline.py   # 或 pip install pytest 后执行 pytest
```

> 测试使用**独立数据库**（临时目录 `ai_notes_test.db`），不会影响 `backend/ai_notes.db` 里的真实数据；
> 也可用环境变量 `AI_NOTES_DB` 指定数据库文件位置（如 `set AI_NOTES_DB=D:\data\my.db`）。

前端 / 本机模式的测试：

```powershell
cd frontend
node tests/engine.test.mjs        # 核心算法（建树 / 抽取 / 复习调度）：16 项
node tests/local-api.test.mjs     # 本机模式门面（上传→建树→复习→备份）：32 项
```

> ⚠️ **必须一个文件一个文件跑。** `node tests/engine.test.mjs tests/local-api.test.mjs` 看着像能一次跑两个，
> 实际**只执行第一个文件、静默忽略后面的参数**——照抄会误以为两个都过了。
> `tests/ocr-parse.test.mjs` 会**长时间挂起不返回**（疑似要联网拉 tesseract 资源），如需运行请单独跑并设短超时。

## 功能说明

| 能力 | 说明 |
|---|---|
| **账号体系** | 注册 / 登录 / 登出完整流程；口令以 **PBKDF2-HMAC-SHA256（随机盐 + 20 万次迭代）** 哈希入库；会话为服务端 `sessions` 表 + **HttpOnly Cookie**（30 天）；未登录访问业务接口一律 401 |
| **数据按用户隔离** | 任务、知识点、复习计划均按 `user_id` 归属；跨用户读写一律 404；历史遗留的无归属数据会被**系统里第一个注册的账号**接管一次 |
| 三类输入 | PDF、PPTX、图片（JPG/PNG，支持**摄像头拍照**直接上传）、纯文本 |
| 单文件上限 | ≤ 50MB（后端流式落盘校验，前端提前拦截） |
| PDF 解析 | 文本层直读；**文本层缺失或字形无 Unicode 映射（扫描件/乱码）时自动渲染页面并 OCR 兜底** |
| 图片 OCR | rapidocr（中文），模型惰性单例加载 |
| 知识点提取 | 可配置 LLM（OpenAI 兼容，默认 DeepSeek）；**未配置/失败时自动降级本地规则提取** |
| 结构化 schema | 统一 `{title, key_points[], children[]}`，层级 ≤3 层（LLM 与兜底输出可互换） |
| 思维导图 | markmap 交互渲染（折叠/缩放），工具条支持适应窗口与缩放 |
| **复习提醒（艾宾浩斯遗忘曲线）** | 每个知识点自动排入复习计划，间隔 **1、2、4、7、15、30 天**；「复习」页提示今天该复习哪些、逾期几天、记忆保持率约多少，标记「已复习」后自动排下一次，走完 6 次即标记已掌握 |
| **完成进度** | 「复习」页展示**整体完成进度条**（已掌握 X/Y）、**各课件完成进度条**与阶段完成度；知识点可**直接「完成」**，也可一键「完成该计划」把某课件剩余知识点全部标记为已掌握 |
| 导出 | Markdown 大纲、PNG 图片（2 倍分辨率白底） |
| **识别原文与质量** | 结果页展示**解析/识别出的原文**（含质量标签：字符数、有效字符占比）、**原图对照**；两种模式均支持（本机模式用端内 OCR 与缩略图；连接后端模式用后端 OCR 与 `/api/tasks/{id}/file` 原图接口） |
| 历史与配置 | SQLite 任务历史（**搜索 / 分页 / 每份课件复习进度**；删除任务联动清理复习项）；AI 配置页（模型/Key/提示词，Key 掩码且不回显） |
| 界面与适配 | 统一设计变量（色/字/间距/圆角/阴影）；**手机端自动切换底部导航**、表格转卡片；全局 toast 轻提示；标签页哈希路由 |

> 说明：摄像头拍照在**无摄像头的设备上会自动禁用并给出提示**（改用文件上传），不影响其他功能。

## 运行模式：本机独立 / 连接后端

应用支持两种运行模式，**首次打开会让你选择**，之后可在「设置 → 运行模式」随时切换：

| 模式 | 处理位置 | 数据存储 | 是否需要电脑 |
|---|---|---|---|
| **本机独立**（手机 App 默认） | 解析、提取、复习排程全部在设备内（JS 引擎） | 设备本地 IndexedDB | ❌ 不需要 |
| **连接电脑后端** | 后端 FastAPI + Python | 电脑上的 SQLite | ✅ 需要（同一 Wi‑Fi） |

### 本机独立模式（无需电脑）

| 能力 | 说明 |
|---|---|
| PDF 解析 | pdf.js 抽取文本层，按坐标还原行结构；扫描件渲染页面后走 OCR 兜底 |
| PPTX 解析 | JSZip 解开 OOXML，按段落抽取文本，首段作标题 |
| 图片 OCR | **原生 Android 上优先使用 ML Kit 中文模型（完全离线，模型随 APK 打包）**；Web/无插件时降级到 tesseract.js |
| 知识点提取 | 无 Key 时用**本地规则兜底**（与后端同一套规则）；填了自己的 API Key 则调用 LLM |
| 复习排程 | 与后端一致的 1·2·4·7·15·30 天间隔推进、保持率估算、进度统计 |
| 数据 | IndexedDB 本地存储；「设置 → 导出数据备份」可导出 JSON（含任务/知识点/复习计划/AI 配置），换机可导入 |
| 账号 | 无需登录，使用「本机用户」档案（可改显示名称） |

> 本机模式的数据只在这台设备上；删除应用数据会一并清除，建议定期导出备份。

## 手机 App（Android）

用 **Capacitor** 把同一套 Vue 前端封装为原生 Android App（包名 `com.ainotes.app`，应用名「AI笔记工具」，`minSdk 22 / targetSdk 34`）。

### 已构建产物

```
frontend/android/app/build/outputs/apk/debug/app-debug.apk        # 约 3.9 MB
```

### 使用步骤

**方式 A：本机独立（推荐，无需电脑）**

1. 安装 APK → 打开 → 首次启动选择「**本机独立使用**」
2. 直接上传 PDF / PPTX / 文本 即可生成思维导图与复习计划
3. 需要更强提取效果时，在「设置 → AI 提取配置」填入自己的 API Key（不填则用本地规则）

**方式 B：连接电脑后端**

有两种通道，**数据线方式不需要 Wi‑Fi**：

**B‑1 数据线（演示推荐，稳定、不依赖网络）**

```powershell
powershell -ExecutionPolicy Bypass -File .\usb-connect.ps1               # 建立 USB 通道
powershell -ExecutionPolicy Bypass -File .\usb-connect.ps1 -StartBackend # 顺便启动后端
```

原理：`adb reverse tcp:8000 tcp:8000` 把「手机上的 `127.0.0.1:8000`」反向映射到「电脑的 8000 端口」。
随后在 App 的「⚙ 服务器设置」里填 **`http://127.0.0.1:8000`** → 测试连接 → 注册/登录。
此模式下后端**只需监听 `127.0.0.1`**，不必暴露到局域网（更安全）。

> ⚠️ 拔掉数据线或重启 adb 后映射失效，重新运行 `usb-connect.ps1` 即可。

**B‑2 局域网 Wi‑Fi**

1. **以局域网模式启动后端**（默认只监听 127.0.0.1，手机连不上）

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Lan
   ```

   脚本会打印可直接填进 App 的地址，例如 `http://192.168.31.204:8000`
2. 手机与电脑连**同一 Wi-Fi**
3. 在 App 的「⚙ 服务器设置」里填该地址 → **测试连接** → 注册/登录

> 首次以 `-Lan` 运行时，Windows 防火墙可能弹出提示，请选择「允许访问」（本机已有 Python 的放行规则）。

**安装 APK**（两种方式通用）

```powershell
adb install -r frontend\android\app\build\outputs\apk\debug\app-debug.apk
```

> 若连不上又不想重装 App：登录页底部有「**← 切换使用方式**」可回到模式选择，改用「本机独立」模式。

### 手机端实现要点

| 项 | 说明 |
|---|---|
| **离线 OCR** | 自研原生插件 `MlkitOcrPlugin`（`android/app/src/main/java/com/ainotes/app/`）调用 **Google ML Kit 文字识别中文模型**（`com.google.mlkit:text-recognition-chinese:16.0.1`）。模型随 APK 打包，**运行期完全离线**；识别前只做**尺寸归一化（最长边 1600px，JPEG q0.85，保留彩色）**——ML Kit 是自然图像模型，灰度化反而掉精度（灰度 + 对比度拉伸仅用于 tesseract 降级路径）。启动时预热模型图，详见下节实测。插件不可用（如浏览器）时降级到 tesseract.js |
| 鉴权 | 原生壳里跨站 Cookie 不可用，改为 **`Authorization: Bearer <token>`**（登录/注册响应返回 token，App 存在 localStorage）；后端同时保留 Cookie 方式供浏览器使用 |
| 后端地址 | 运行时可在登录页 / 设置页配置并持久化（`ai_notes_api_base`），支持同一份 APK 连不同后端的电脑 |
| 明文 HTTP | `capacitor.config.json` 中 `server.cleartext = true`、`androidScheme = http`，允许访问局域网 http 服务 |
| 网络权限 | 已声明 `android.permission.INTERNET` |
| 界面 | 手机宽度下侧边栏自动转为底部导航，登录页只保留表单 |
| 文件上传 | 使用系统文件选择器（拍照上传需设备具备摄像头；无摄像头时按钮自动禁用并提示） |

### 离线 OCR 性能实测（真机）

测试机 **Redmi K80（24117RK2CC / Android 16 / WebView 143）**；测试图由脚本生成：3024×2016（≈12MP）、11 行 112px 粗体中文，模拟手机拍课件。三条路径**按轮次交错执行、各 3 轮**（顺序执行会被热机爬坡带偏），数字为端到端耗时（含前端预处理）：

| 路径 | 总耗时（3 轮） | 中位 | 预处理 | 原生解码 | 原生推理 | base64 | 字符错误 |
|---|---|---|---|---|---|---|---|
| A 全分辨率直传（优化前行为） | 155 / 172 / 183 ms | 172 ms | 0 | 19–26 ms | 100–124 ms | 400 KB | 4 处 |
| **B canvas 缩放 1600（当前实现）** | 116 / 138 / 138 ms | **138 ms** | 25–29 ms | 7–13 ms | 66–81 ms | 145 KB | **2 处** |
| C 解码期降采样（曾作为候选） | 219 / 220 / 221 ms | 220 ms | 94–98 ms | 8–20 ms | 91–92 ms | 145 KB | 4 处 |

**结论：采用 B，不采用 C。**

- C 看起来把原生解码从 ~11ms 压到 ~8ms，但 `createImageBitmap(url, {resizeWidth, resizeQuality:'high'})` 的解码期缩放自身要 **~96ms 预处理**，而 B 的 canvas 路径只要 ~28ms；且 C 的重采样核产出的像素让**推理反而更慢**（91ms vs B 的 66–81ms）。**端到端 C 比 B 慢 1.59×**。
- 更关键：C 的识别错误是 B 的**严格超集**——B 错 2 处（循环→循坏、预→颈），C 把这两处**全部继承**，还多错 2 处（**第三章→第三拿**、模型→樓型）。准确率是硬门槛，C 直接出局。
- 因此 `parse.js` 的 `downscaleToDataUrl()` **保持 canvas 路径不变**。
- A → B 的真实收益是 **1.25×（中位）/ 1.33×（最差）**，B 同时也是三条路径里**最准**的（字符错误 2 处，比优化前的 A 还少）。

> ⚠️ 早先记录过的「B 相对 A 约 **2.6×**」**是错的，已作废**。那是顺序执行 A→B→C 造成的热机爬坡：A 跑第一个，独自承担了 ML Kit 首次推理的模型图初始化（同一张 12MP 图，推理 1779ms → 稳态 100–124ms，差 10 倍以上）。**任何 OCR 性能数字都必须来自交错多轮测量。**

> 📏 **本机噪声地板**（下结论前必读）：同一张图、模型已热，连续 12 次的端到端耗时是 58–95ms（中位 70ms），单看推理是 46–82ms，**散布达 1.8×**；启动后短期内还偶发过单次 245ms 尖峰（不可复现）。**这台机器上小于 ~30ms 的差异不可信**，单次测量尤其不可信。

### 启动预热为什么要跑一次真实推理

`warmup()` 里只调 `TextRecognition.getClient()` 是**不够的**：它只创建客户端对象，不做任何推理，而 ML Kit 的模型图是**懒加载**的——那笔开销会落到用户的**第一张照片**上。修复前实测（同一张 1600×1067 图）：

| 第几次识别 | 原生解码 | 原生推理 | 总计 |
|---|---|---|---|
| 1（= 用户第一张照片） | 24 ms | **228 ms** | **263 ms** |
| 2 | 6 ms | 54 ms | 66 ms |
| 3 | 7 ms | 58 ms | 72 ms |

第一张是稳态的 **3.7 倍**。修复办法是在 `warmup()` 里补一次**带真字的哑图**推理（**不能用空白图**：空白图只会初始化文字检测器，字符识别模型依旧是冷的），启动日志随即变为：

```
D MlkitOcr: recognizer created in 168ms
D MlkitOcr: warmup done in 370ms (create=168ms graphInit=202ms textLen=4)
```

`textLen=4` 证明哑图上那 4 个汉字被**真实识别**出来了，即两段模型都已初始化。此后重启 App 后**不做任何中间识别**、直接注入一张 3024×2016 测试图走完整应用链路：

```
D MlkitOcr: decode=13ms infer=96ms total=109ms blocks=2
I Capacitor/Console: [ocr] ML Kit 预处理 76ms（64KB）→ 识别+传输 118ms
```

第一张照片的推理由 **228ms 降到 96ms**，已落进热态区间（61–96ms）。多次重启测得 `graphInit` 稳定在 127–202ms。预热整体约 300–370ms，在 `App.vue` 的 `onMounted` 里异步发起，**不阻塞界面**。

> 残留的首次开销（~35–50ms）与本机噪声地板同量级，无法可靠区分，未继续追。另经尺寸阶梯实测（小 360×140 → 中 800×533 → 大 1600×1067×2：63 / 74 / 129 / 114 ms）确认**不存在尺寸相关的懒加载**，大图只是固有更慢，因此没有把哑图放大到工作尺寸。

### 重新打包

```powershell
powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
```

脚本会自动定位 JDK 17、写入 `android/local.properties` 的 SDK 路径，依次执行 `vite build` → `cap sync android` → `gradlew assembleDebug`，并输出 APK 路径。

> 环境要求：**JDK 17**（AGP 8.2/Gradle 8.2 不支持 JDK 21）、Android SDK（platform 34 + build-tools 34）、Node 18+。
> 前端改动后必须重新执行 `npm run build` + `npx cap sync android` 才会进入 APK。

### 拍照权限（Android）

WebView 调用摄像头需要**在清单里声明 CAMERA**，否则系统会直接拒绝、连授权弹窗都不会出现（表现为 `NotAllowedError / Permission denied`）。本项目已在 `frontend/android/app/src/main/AndroidManifest.xml` 中声明：

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

授权链路：点击「📷 拍照上传」→ 页面调用 `getUserMedia` → Capacitor 的 `BridgeWebChromeClient.onPermissionRequest` 拉起**系统授权弹窗** → 允许后 WebView 获得摄像头（Capacitor 已设置 `setMediaPlaybackRequiresUserGesture(false)`，预览可自动播放）。

若之前拒绝过授权，请到 **系统设置 → 应用 → AI笔记工具 → 权限 → 相机 → 允许**，再回到 App 点「重试」。

> ⚠️ **手机浏览器**（非 App）通过 `http://局域网IP:5173` 访问时，浏览器把该地址视为不安全上下文，会禁止调用摄像头——这不是权限问题。App 内使用不受此限制（`http://localhost` 属安全上下文）。

## 界面说明

- **登录页**：首次使用自动切到「注册」模式；左侧介绍产品能力，右侧表单（用户名 / 昵称 / 密码 / 确认密码），错误就地提示
- **应用外壳**：左侧固定侧边栏（品牌 → 功能导航 → 底部用户卡片与「退出」），右侧为页头（页面标题 + 描述）与内容区；当前页在侧边栏有高亮强调条
- **导航**：宽屏为侧边栏；**≤720px 自动切换为底部导航**，页头右侧出现当前用户与退出按钮；**切换页面自动回到顶部**（不会停在上一个页面的滚动位置）
- **直达链接**：`#convert` / `#review` / `#history` / `#settings` —— 可收藏、分享，刷新后停留在当前页
- **操作反馈**：所有动作通过 toast 提示（成功 / 失败 / 信息）——宽屏在页头右下方，**手机上浮在底部导航之上**，都不会遮挡标题或导航；危险操作（删除任务、完成整份计划、退出登录）有二次确认
- **响应式**：历史表格在窄屏变为卡片列表；按钮组换行；上传区在手机上加大触控区域；**手机上输入框按 16px 渲染**（避免 iOS Safari 聚焦时自动放大整页）
- **思维导图**：手机上长标签自动折行，保证节点文字可读；工具栏「适应 / ＋ / －」可缩放，点「适应」恢复整树可见
- **安全区**：`viewport-fit=cover` + `env(safe-area-inset-*)`，刘海屏/手势条机型上底部导航与内容留白自动避让系统栏
- **可访问性**：键盘焦点可见（`:focus-visible`）、语义化按钮与表单标签、尊重「减少动态效果」偏好（`prefers-reduced-motion`）

## 账号与数据归属

| 项 | 说明 |
|---|---|
| 注册 | 用户名 3–32 位（字母/数字/`_-.`），密码 ≥6 位；注册成功即登录 |
| 登录 | 口令校验失败统一提示「用户名或密码不正确」，不区分账号是否存在 |
| 会话 | 服务端 `sessions` 表保存随机 token，浏览器只持有 HttpOnly Cookie（`ainotes_sid`，SameSite=Lax）；过期自动失效并清理 |
| 登出 | 删除服务端会话 + 清除 Cookie |
| 隔离 | 任务/复习项全部按 `user_id` 过滤；访问他人资源返回 404（不泄露存在性） |
| 历史数据 | 升级前产生的无归属数据，由**第一个注册的账号**自动接管（仅当系统只有一个账号时执行一次），避免多人环境下抢占 |
| AI 配置 | 目前是**全局共用**（`backend/config.json`），登录后即可读写；如需按用户隔离可后续迁移到数据库表 |

## 复习排程（艾宾浩斯遗忘曲线）

心理学依据：赫尔曼·艾宾浩斯揭示的遗忘规律——新学内容若不及时复习会快速遗忘。系统据此为每个知识点安排**递增间隔**的复习：

| 第几次 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 距上次（天） | 1 | 2 | 4 | 7 | 15 | 30 |

- 上传课件后自动为每个知识点（树中节点）生成复习项，**首次复习在 1 天后**
- 「复习」页展示：今天待复习（含逾期天数与记忆保持率估算）、学习中/已掌握统计、未来 7 天安排
- 顶部「复习」标签带待复习数量角标；标记「已复习」后自动推进到下一间隔
- 记忆保持率按 `R = e^(-t/S)` 估算（S 取当前阶段间隔天数），用于提示复习紧迫度

### 如何完成复习计划 & 查看进度

| 目标 | 操作 |
|---|---|
| 推进一次复习 | 待复习条目上点「**已复习**」→ stage +1，自动排入下一间隔（1→2→4→7→15→30 天） |
| 完成单个知识点 | 点「**完成**」→ 直接标记为已掌握（跳过剩余间隔） |
| 完成整份课件 | 「各课件完成进度」行点「**完成该计划**」→ 该课件剩余知识点全部标记已掌握（有二次确认） |
| 看整体进度 | 顶部「**整体完成进度**」进度条：已掌握 X/Y 个知识点，并附复习阶段完成度 |
| 看单份课件进度 | 「**各课件完成进度**」列表：每行一个进度条 + 已掌握 X/Y + 阶段完成度 + 待复习数；`active=0` 时显示「✓ 已完成」 |
| 回退/重来 | 「重置」把某知识点退回待复习（stage 归 0） |

## AI 配置

「设置」页配置接口地址 / API Key / 模型（存 `backend/config.json`）。

- 未启用或未填 Key → 自动降级**本地规则提取**（答辩断网可演示）。
- 默认 DeepSeek（OpenAI 兼容接口，也支持其他兼容服务）。
- **提示词模板已收进「高级设置」折叠区，默认隐藏**：不展开也能正常保存（沿用已加载模板，不会被清空）；展开后可自定义，或一键「填入内置默认模板」。折叠状态下会显示当前状态（使用内置默认模板 / 已自定义 N 字）。
- ⚠️ `config.json` 含明文 Key，已被 `.gitignore` 忽略，请勿外发。

## 目录结构

```
ai-note-mindmap/
├── start.ps1 / start.bat     # 一键启动（后端 + 前端；加 -Lan 供局域网访问）
├── usb-connect.ps1           # 数据线通道：adb reverse（手机 127.0.0.1:8000 → 电脑后端）
├── demo_计算机网络.pdf       # 演示素材：PDF 课件（可用 tools 脚本再生成）
├── demo_软件工程.pptx        # 演示素材：PPT 课件
├── demo_拍照.png             # 演示素材：课堂拍照
├── docs/                     # 初期报告 / SRS / 相似项目参考 / 可行性报告
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 入口（启动时打印实际数据库路径）
│   │   ├── config.py         # AI 配置读写（config.json）
│   │   ├── models.py         # User / UserSession / Task / ReviewItem（含轻量迁移）
│   │   ├── schemas.py        # Pydantic 请求/响应模型
│   │   ├── routers/          # auth / upload / tasks / settings / reviews
│   │   └── services/
│   │       ├── auth.py       # 口令哈希、会话、当前用户依赖、历史数据认领
│   │       ├── parser.py     # PDF（含 OCR 兜底）/ PPTX / 图片 OCR / 文本
│   │       ├── extractor.py  # LLM 提取（OpenAI 兼容）+ 输出归一化
│   │       ├── fallback.py   # 本地规则兜底提取
│   │       ├── knowledge.py  # 知识点树 ↔ Markdown
│   │       ├── review.py     # 复习排程（间隔推进/保持率/进度，按用户隔离）
│   │       └── pipeline.py   # 处理管线（解析 → 提取 → 大纲）
│   ├── tools/make_demo_pdf.py  # 演示 PDF 生成工具（中文字体 + 子集化）
│   └── tests/test_pipeline.py  # 24 个用例（独立测试库），无需 API Key
└── frontend/
    └── src/
        ├── api.js                  # 接口封装（带会话 Cookie、401 广播）
        ├── auth.js                 # 登录状态（当前用户、启动探测、登出）
        ├── toast.js                # 全局轻提示
        ├── style.css               # 设计变量 + 组件样式 + 响应式
        ├── App.vue                 # 应用外壳：登录门禁 + 侧边栏 + 页头 + toast
        ├── components/Mindmap.vue  # markmap 渲染 + 工具条 + PNG 导出
        └── views/  Login（登录/注册）/ Convert / Review / History / Settings
```

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/status` | 是否已有账号（登录页引导注册用，无需登录） |
| POST | `/api/auth/register` | 注册并自动登录（建立会话 Cookie） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出（删除服务端会话 + 清 Cookie） |
| GET | `/api/auth/me` | 当前登录用户（前端启动时用于恢复登录态） |
| POST | `/api/upload` | 上传课件/图片 → 解析 → 提取知识点 → 生成复习计划 |
| GET | `/api/tasks/{id}/file` | 取该任务上传的原文件（用于结果页显示「原图」） |
| GET/DELETE | `/api/tasks[/{id}]` | 任务历史（删除任务联动清理其复习项） |
| GET/PUT | `/api/settings` | AI 配置（Key 掩码返回） |
| GET | `/api/reviews/summary` | 复习总览：待复习/学习中/已掌握/未来 7 天 + 整体完成进度 |
| GET | `/api/reviews/progress` | 按课件汇总完成进度（进度条数据源） |
| GET | `/api/reviews/due` | 今天该复习的知识点（含逾期天数、记忆保持率） |
| GET | `/api/reviews/upcoming?days=7` | 未来 N 天复习安排（按日期分组） |
| GET | `/api/reviews?task_id=` | 某课件生成的全部复习项 |
| POST | `/api/reviews/{id}/complete` | 标记已复习 → 推进到下一间隔 |
| POST | `/api/reviews/{id}/master` | 直接完成该知识点的复习计划 |
| POST | `/api/reviews/complete-all?task_id=` | 一键完成复习计划（不传 task_id 则完成全部未掌握项） |
| POST | `/api/reviews/{id}/reset` | 重置复习进度 |
| DELETE | `/api/reviews/{id}` | 删除单个复习项 |

## 演示流程建议

1. 启动两个服务，打开 http://127.0.0.1:5173
2. 上传 `demo_软件工程.pptx` → 秒出三章节思维导图（LLM 模式）
3. 关闭「设置」页的 LLM 开关，再上传 `demo_计算机网络.pdf` → 本地规则兜底同样出图（证明断网可演示）
4. 上传 `demo_拍照.png` → OCR 识别板书内容并生成要点导图（**需有摄像头的设备才能演示现场拍照**）
5. 切到「复习」页 → 查看该课件生成的复习项、未来 7 天安排；点「已复习」演示间隔推进（1→2→4→7→15→30 天）
6. 导出 Markdown / PNG 作为成果物
