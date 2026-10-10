<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import { meaningfulRatio } from '../core/parse.js'
import { toast } from '../toast'
import Mindmap from '../components/Mindmap.vue'

const emit = defineEmits(['navigate'])
const refreshDue = inject('refreshDue', () => {})

/** 与后端 MAX_UPLOAD_MB 保持一致 */
const MAX_UPLOAD_MB = 50

const task = ref(null)
const loading = ref(false)
const error = ref('')
const showJson = ref(false)
const mindmapRef = ref(null)
const dragOver = ref(false)
/** 本次上传生成的复习项数量（艾宾浩斯排程） */
const reviewCount = ref(0)

/** 原图地址：本机模式用缩略图，连接后端模式向后端取原文件 */
const originalUrl = ref('')

async function loadOriginal(t) {
  if (originalUrl.value && originalUrl.value.startsWith('blob:')) {
    try { URL.revokeObjectURL(originalUrl.value) } catch (e) { /* ignore */ }
  }
  originalUrl.value = ''
  if (!t || t.status !== 'done') return
  const isImage = ['png', 'jpg', 'jpeg'].includes((t.file_type || '').toLowerCase())
  if (t.thumb) {
    originalUrl.value = t.thumb            // 本机模式已存缩略图
  } else if (isImage) {
    try {
      originalUrl.value = await api.taskFileUrl(t.id)   // 连接后端模式：取原文件
    } catch (e) {
      originalUrl.value = ''
    }
  }
}

const inputEl = ref(null)

/** 识别原文质量提示（本机模式提供原文；服务器模式不返回则不显示） */
const textQuality = computed(() => {
  const text = (task.value && task.value.text) || ''
  if (!text) return null
  const chars = text.replace(/\s/g, '').length
  const ratio = meaningfulRatio(text)
  if (chars < 20) return { level: 'warn', msg: `仅识别出 ${chars} 个字符，建议靠近拍摄或提高清晰度` }
  if (ratio < 0.5) return { level: 'warn', msg: '识别质量较低（有效字符占比不足），建议重拍' }
  return { level: 'ok', msg: `识别 ${chars} 字，质量正常` }
})

// —— 摄像头拍照（可选功能，FR-2）——
const cameraOpen = ref(false)
const cameraError = ref('')
const videoEl = ref(null)
/** 仅在浏览器完全不具备摄像头 API 时禁用按钮；
 *  未授权时 enumerateDevices() 本就返回空列表，不能据此禁用，否则永远点不了。 */
const cameraSupported = ref(true)
const cameraHint = ref('拍摄黑板/屏幕，识别后自动整理为结构化笔记')
/** 是否已拿到视频流（模板里需要响应式判断） */
const hasStream = ref(false)
let stream = null

async function detectCamera() {
  const md = navigator.mediaDevices
  if (!md || typeof md.getUserMedia !== 'function') {
    cameraSupported.value = false
    cameraHint.value = '当前环境不支持摄像头调用（浏览器需 HTTPS 或 localhost；App 内可直接使用）'
    return
  }
  try {
    const devices = await md.enumerateDevices()
    const cams = devices.filter((d) => d.kind === 'videoinput')
    if (!cams.length) {
      // 可能是真没摄像头，也可能是尚未授予相机权限（此时列表为空）→ 不禁用，点一下触发授权
      cameraHint.value = '未检测到摄像头设备：若设备有摄像头，点击后按提示允许「相机」权限'
    } else {
      cameraHint.value = '拍摄黑板/屏幕，识别后自动整理为结构化笔记'
    }
  } catch (e) {
    cameraHint.value = '拍摄黑板/屏幕，识别后自动整理为结构化笔记'
  }
}

/** 把 getUserMedia 的报错翻译成可操作的中文提示 */
function cameraErrorText(e) {
  const name = e && e.name ? e.name : ''
  const raw = (e && e.message) || e || ''
  const insecure = typeof window !== 'undefined' && window.isSecureContext === false
  if (insecure) {
    return '当前页面不是安全上下文（HTTPS / localhost），浏览器会禁止调用摄像头。请改用 App，或在 HTTPS 下访问。'
  }
  if (name === 'NotAllowedError' || /permission|denied/i.test(String(raw))) {
    return '相机权限被拒绝：请在系统「设置 → 应用 → AI笔记工具 → 权限」中允许「相机」，然后重试；首次使用请留意弹出的授权框。'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '未找到可用的摄像头设备。'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '摄像头被其他应用占用或系统暂不可用，请关闭其他相机应用后重试。'
  }
  if (name === 'OverconstrainedError') {
    return '摄像头不支持当前参数（已尝试兼容模式），请重试。'
  }
  return `无法访问摄像头：${raw}`
}

async function uploadFile(file) {
  if (!file) return
  error.value = ''
  reviewCount.value = 0
  if (!file.size) {
    error.value = '文件为空，请重新选择'
    toast.error(error.value)
    return
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    error.value = `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_UPLOAD_MB}MB 上限，请压缩后重试`
    toast.error(error.value)
    return
  }
  loading.value = true
  task.value = null
  originalUrl.value = ''
  try {
    task.value = await api.upload(file)
    if (task.value.status === 'error') {
      error.value = task.value.error
      toast.error(task.value.error)
    } else {
      reviewCount.value = task.value.review_items || 0
      toast.success(
        reviewCount.value > 0
          ? `解析完成，已生成 ${reviewCount.value} 个复习项`
          : '解析完成，已生成知识点思维导图'
      )
      refreshDue()
      loadOriginal(task.value)
    }
  } catch (e) {
    error.value = String(e.message || e)
    toast.error(`上传失败：${error.value}`)
  } finally {
    loading.value = false
  }
}

function onFileChange(e) {
  uploadFile(e.target.files?.[0])
  e.target.value = ''
}

function onDrop(e) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) uploadFile(file)
}

/** 打开摄像头：优先后置摄像头，参数不被支持时退化为默认摄像头，并触发系统授权 */
async function openCamera() {
  cameraError.value = ''
  if (!cameraSupported.value) {
    cameraOpen.value = true
    cameraError.value = cameraHint.value
    return
  }
  cameraOpen.value = true
  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ]
  let lastErr = null
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      break
    } catch (e) {
      lastErr = e
      // 权限类错误无需重试，直接提示
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotReadableError')) break
    }
  }
  if (!stream) {
    cameraError.value = cameraErrorText(lastErr)
    hasStream.value = false
    return
  }
  hasStream.value = true
  try {
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
    }
    // 授权成功后设备信息才可用，刷新一下提示
    detectCamera()
  } catch (e) {
    cameraError.value = `摄像头已授权但无法预览：${e.message || e}`
  }
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  hasStream.value = false
}

function closeCamera() {
  stopStream()
  cameraOpen.value = false
}

function capture() {
  const video = videoEl.value
  if (!video) return
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 1280
  canvas.height = video.videoHeight || 720
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  canvas.toBlob((blob) => {
    if (!blob) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = new File([blob], `拍照_${stamp}.png`, { type: 'image/png' })
    closeCamera()
    uploadFile(file)
  }, 'image/png')
}

function downloadMarkdown() {
  if (!task.value?.outline) return
  const blob = new Blob([task.value.outline], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.download = (task.value.filename || 'note').replace(/\.[^.]+$/, '') + '.md'
  a.href = URL.createObjectURL(blob)
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(detectCamera)
onBeforeUnmount(stopStream)
</script>

<template>
  <div>
    <div class="card">
      <h2>上传课件 / 拍照</h2>
      <p class="muted">
        支持 PDF、PPTX、图片（JPG/PNG，可拍照）、文本；单文件 ≤{{ MAX_UPLOAD_MB }}MB。
        未启用或未填 API Key 时自动使用本地规则提取（断网可演示）。
      </p>
      <div
        class="upload-zone"
        :class="{ dragover: dragOver }"
        @click="inputEl && inputEl.click()"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <input
          ref="inputEl"
          type="file"
          accept=".pdf,.pptx,.txt,.md,.png,.jpg,.jpeg"
          style="display: none"
          @change="onFileChange"
        />
        <template v-if="loading">
          <div class="upload-title"><span class="spinner"></span>正在解析与提取知识点…</div>
          <div class="muted">PDF / PPT 解析、图片 OCR，请稍候</div>
        </template>
        <template v-else>
          <div class="upload-title">点击选择文件，或拖拽到此处</div>
          <div class="muted">PDF · PPTX · JPG/PNG · TXT/MD</div>
        </template>
      </div>

      <div class="form-row" style="margin-top: 12px">
        <button class="action" :disabled="!cameraSupported" @click="openCamera">📷 拍照上传</button>
        <span class="muted">{{ cameraHint }}</span>
      </div>

      <p v-if="error" class="error" style="margin: 6px 0 0">{{ error }}</p>
    </div>

    <div v-if="loading" class="card">
      <div class="form-row" style="margin-bottom: 8px">
        <h2 style="margin: 0">正在处理…</h2>
      </div>
      <div class="skeleton" style="height: 18px; width: 42%; margin-bottom: 10px"></div>
      <div class="skeleton" style="height: 220px"></div>
    </div>

    <div v-if="task && task.status === 'done'" class="card">
      <div class="form-row">
        <h2 style="margin: 0">{{ task.filename }}</h2>
        <span class="muted hide-mobile">{{ task.created_at }}</span>
        <span style="flex: 1"></span>
        <button class="action" @click="downloadMarkdown">导出 Markdown</button>
        <button class="action" @click="mindmapRef && mindmapRef.exportPNG()">导出 PNG</button>
        <button class="action" @click="showJson = !showJson">{{ showJson ? '隐藏' : '查看' }} JSON</button>
      </div>

      <p v-if="reviewCount > 0" class="review-hint">
        <span>
          📅 已生成 <strong>{{ reviewCount }}</strong> 个复习项：首次复习在 <strong>1 天后</strong>，
          之后按 1、2、4、7、15、30 天递增。
        </span>
        <span style="flex: 1"></span>
        <button class="action primary" @click="emit('navigate', 'review')">去复习页查看</button>
      </p>

      <Mindmap ref="mindmapRef" :outline="task.outline" :filename="task.filename" />

      <!-- 原图与识别原文（两种模式都可用，便于对照识别质量）-->
      <template v-if="originalUrl || task.text">
        <div class="form-row" style="margin-top: 14px; margin-bottom: 6px">
          <h3 style="margin: 0">{{ originalUrl ? '原图与识别原文' : '识别原文' }}</h3>
          <span v-if="textQuality" class="tag" :class="textQuality.level === 'warn' ? 'tag-warn' : 'tag-ok'">
            {{ textQuality.msg }}
          </span>
        </div>
        <div class="ocr-compare">
          <img v-if="originalUrl" :src="originalUrl" class="ocr-thumb" alt="原图" />
          <pre v-if="task.text" class="pre-wrap">{{ task.text }}</pre>
        </div>
      </template>

      <pre v-if="showJson" class="pre-wrap" style="margin-top: 12px">{{ JSON.stringify(task.knowledge, null, 2) }}</pre>

      <h3>Markdown 大纲</h3>
      <pre class="pre-wrap">{{ task.outline }}</pre>
    </div>

    <!-- 摄像头拍照弹窗 -->
    <div v-if="cameraOpen" class="modal-mask" @click.self="closeCamera">
      <div class="modal">
        <h3>拍照上传</h3>
        <video ref="videoEl" class="camera-video" autoplay playsinline muted></video>
        <p v-if="cameraError" class="error">{{ cameraError }}</p>
        <div class="form-row" style="margin-top: 12px">
          <button class="action primary" :disabled="!hasStream" @click="capture">拍摄并识别</button>
          <button v-if="cameraError" class="action" @click="openCamera">重试</button>
          <button class="action" @click="closeCamera">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>
