/** 本地引擎：文件解析（PDF / PPTX / 图片 OCR / 文本）→ 纯文本
 *
 * 与后端 services/parser.py 等价，但全部在手机端完成：
 * - PDF：pdf.js 抽取文本层；文本层不可用（扫描件/乱码）时渲染页面并 OCR 兜底
 * - PPTX：JSZip 解开 OOXML，按段落抽取 <a:t> 文本，首段作标题
 * - 图片：tesseract.js 中文 OCR（首次使用需联网下载语言包，之后可离线）
 */

export const SUPPORTED_EXTS = ['pdf', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg']

export const MIN_MEANINGFUL_RATIO = 0.5
export const MIN_TEXT_CHARS = 30
export const OCR_MAX_PAGES = 10
export const OCR_RENDER_SCALE = 2

/* ------------------------------------------------------------ 文本质量 */

export function meaningfulRatio(text) {
  const chars = String(text || '').replace(/\s/g, '')
  if (!chars.length) return 0
  let good = 0
  for (const ch of chars) if (/[0-9A-Za-z\u4e00-\u9fff\u3040-\u30ff]/.test(ch)) good++
  return good / chars.length
}

export function textIsUsable(text) {
  const s = String(text || '').trim()
  if (s.length < MIN_TEXT_CHARS) return false
  return meaningfulRatio(s) >= MIN_MEANINGFUL_RATIO
}

export function extOf(filename) {
  const name = String(filename || '').toLowerCase()
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1) : ''
}

/* ------------------------------------------------------------ PDF */

let pdfjsPromise = null
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // 使用 legacy 构建：兼容较旧的 Android WebView，且不含 top-level await
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      // worker 由 Vite 作为资源打包（?url）
      const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

async function readArrayBuffer(file) {
  if (file && typeof file.arrayBuffer === 'function') return await file.arrayBuffer()
  return file
}

export async function parsePdf(file) {
  const pdfjs = await loadPdfjs()
  const data = await readArrayBuffer(file)
  const doc = await pdfjs.getDocument({ data }).promise
  try {
    const parts = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(textItemsToLines(content.items))
    }
    const text = parts.join('\n')
    if (textIsUsable(text)) return text

    // 文本层不可用 → 渲染页面 OCR 兜底（扫描件）
    const ocr = await ocrPdfPages(doc)
    if (textIsUsable(ocr)) return ocr

    if (text.trim()) throw new Error('PDF 文本层无法识别（字体缺少 Unicode 映射，OCR 兜底也未识别出内容）')
    throw new Error('PDF 未提取到文本（可能是扫描件，且 OCR 未识别出内容）')
  } finally {
    try { doc.destroy() } catch (e) { /* ignore */ }
  }
}

/** 把 pdf.js 的文本片段还原成带换行的文本
 *
 * 直接拼接会把整页压成一行，导致后续「按标题行建树」的规则失效；
 * 这里用 hasEOL 标记与 Y 坐标变化共同判定换行。
 */
export function textItemsToLines(items) {
  const lines = []
  let current = ''
  let lastY = null

  for (const item of items || []) {
    const str = typeof item.str === 'string' ? item.str : ''
    const y = item.transform ? Math.round(item.transform[5]) : null

    if (current && lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
      lines.push(current)
      current = ''
    }
    current += str

    if (item.hasEOL) {
      lines.push(current)
      current = ''
    }
    if (y !== null) lastY = y
  }
  if (current) lines.push(current)

  return lines
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l)
    .join('\n')
}

async function ocrPdfPages(doc) {
  let canvas = null
  try {
    const pages = Math.min(doc.numPages, OCR_MAX_PAGES)
    const texts = []
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
      canvas = canvas || document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      texts.push(await ocrImage(canvas))
    }
    return texts.join('\n')
  } catch (e) {
    return ''
  }
}

/* ------------------------------------------------------------ PPTX */

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

export function pptxXmlToText(xml) {
  const paragraphs = String(xml).split(/<a:p[ >]/).slice(1)
  const lines = []
  for (const para of paragraphs) {
    const runs = [...para.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]))
    const text = runs.join('').trim()
    if (text) lines.push(text)
  }
  return lines
}

export async function parsePptx(file) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await readArrayBuffer(file))
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)[1])
      const nb = Number(b.match(/slide(\d+)\.xml/)[1])
      return na - nb
    })

  const out = []
  for (const name of slideFiles) {
    const xml = await zip.file(name).async('string')
    const lines = pptxXmlToText(xml)
    if (!lines.length) continue
    out.push(`# ${lines[0]}`)          // 首段视为标题，便于兜底建树
    out.push(...lines.slice(1))
  }
  return out.join('\n')
}

/* ------------------------------------------------------------ 图片 OCR */

//: OCR 前统一图像尺寸：手机原图常有 4000px+，过大反而拖慢且降低准确率
export const OCR_MAX_DIM = 2000
export const OCR_MIN_DIM = 1000
//: 原生 ML Kit 输入的最长边（性能优先：1600px 已足够识别，且 base64 体积更小）
export const OCR_NATIVE_MAX_DIM = 1600

let ocrWorkerPromise = null
async function getOcrWorker(onProgress) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const mod = await import('tesseract.js')
      const Tesseract = mod.default || mod
      const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
        logger: (m) => { if (onProgress && m.status) onProgress(m) },
      })
      try {
        await worker.setParameters({
          preserve_interword_spaces: '1',   // 保留中文词间空格，避免整行粘连
          tessedit_pageseg_mode: '6',       // 统一文本块（课件/板书场景更稳）
        })
      } catch (e) { /* 参数不被支持时忽略 */ }
      return worker
    })()
  }
  return ocrWorkerPromise
}

/** OCR 前预处理（tesseract 专用）：尺寸归一化 + 灰度 + 对比度拉伸
 *
 * 灰度/对比度用 canvas 的 filter 交由底层实现（GPU/原生），比逐像素 JS 循环快一个数量级。
 */
export async function preprocessForOcr(image) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return image
  try {
    const bitmap = await createImageBitmap(image)
    const maxSide = Math.max(bitmap.width, bitmap.height)
    let scale = 1
    if (maxSide > OCR_MAX_DIM) scale = OCR_MAX_DIM / maxSide
    else if (maxSide < OCR_MIN_DIM) scale = Math.min(2, OCR_MIN_DIM / maxSide)

    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    try {
      ctx.filter = 'grayscale(1) contrast(135%)'   // 原生滤镜，无需逐像素处理
      ctx.drawImage(bitmap, 0, 0, w, h)
      ctx.filter = 'none'
    } catch (e) {
      ctx.drawImage(bitmap, 0, 0, w, h)
    }
    if (bitmap.close) bitmap.close()
    return canvas
  } catch (e) {
    return image
  }
}

/**
 * ML Kit 专用预处理：**只做尺寸归一化，保留彩色**
 * - ML Kit 模型基于自然图像训练，灰度化反而降低精度
 * - 限制最长边可显著减少 base64 体积与原生解码/推理耗时
 */
export async function downscaleToDataUrl(image, maxDim = OCR_NATIVE_MAX_DIM, quality = 0.85) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return typeof image === 'string' ? image : null
  }
  try {
    const bitmap = await createImageBitmap(image)
    const maxSide = Math.max(bitmap.width, bitmap.height)
    const scale = maxSide > maxDim ? maxDim / maxSide : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (bitmap.close) bitmap.close()
    return canvas.toDataURL('image/jpeg', quality)
  } catch (e) {
    return typeof image === 'string' ? image : null
  }
}

/** 预热量：应用启动时调用，提前把 ML Kit 模型载入内存（首次识别不再等模型加载） */
export async function mlkitWarmup() {
  const plugin = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.MlkitOcr
    : null
  if (!plugin || typeof plugin.warmup !== 'function') return false
  try {
    await plugin.warmup()
    return true
  } catch (e) {
    return false
  }
}

/** 原生 ML Kit 离线识别（Android 端插件；不可用时返回 null 以便降级） */
export async function mlkitOcr(image, onProgress) {
  const plugin = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.MlkitOcr
    : null
  if (!plugin || typeof plugin.recognize !== 'function') return null

  const t0 = Date.now()
  const dataUrl = await downscaleToDataUrl(image)
  if (!dataUrl) return null
  const tPre = Date.now() - t0
  if (onProgress) onProgress({ status: 'ML Kit 离线识别中', progress: 0.5 })
  const result = await plugin.recognize({ image: dataUrl })
  const tTotal = Date.now() - t0
  console.log(`[ocr] ML Kit 预处理 ${tPre}ms（${Math.round(dataUrl.length / 1024)}KB）→ 识别+传输 ${tTotal - tPre}ms`)
  if (onProgress) onProgress({ status: 'ML Kit 离线识别中', progress: 1 })
  return String((result && result.text) || '')
}

export async function ocrImage(image, onProgress) {
  // 优先使用原生 ML Kit（离线、中文更准）；不可用时降级到 tesseract.js
  try {
    const nativeText = await mlkitOcr(image, onProgress)
    if (nativeText !== null) return nativeText
  } catch (e) {
    // ML Kit 失败 → 继续走 tesseract
    if (onProgress) onProgress({ status: 'ML Kit 不可用，改用 tesseract', progress: 0.2 })
  }

  try {
    const worker = await getOcrWorker(onProgress)
    const prepared = await preprocessForOcr(image)
    const { data } = await worker.recognize(prepared)
    return String((data && data.text) || '')
  } catch (e) {
    throw new Error(
      '本机 OCR 引擎不可用（首次使用需联网下载中文识别模型）：' + (e.message || e)
    )
  }
}

export async function parseImage(file, onProgress) {
  return await ocrImage(file, onProgress)
}

/* ------------------------------------------------------------ 文本 */

export async function parseTextFile(file) {
  if (typeof file === 'string') return file
  if (file && typeof file.text === 'function') return await file.text()
  return String(file || '')
}

/* ------------------------------------------------------------ 统一入口 */

export async function parseFile(file, filename, onProgress) {
  const ext = extOf(filename)
  if (ext === 'pdf') return await parsePdf(file)
  if (ext === 'pptx') return await parsePptx(file)
  if (ext === 'txt' || ext === 'md') return await parseTextFile(file)
  if (['png', 'jpg', 'jpeg'].includes(ext)) return await parseImage(file, onProgress)
  throw new Error(`不支持的文件类型 .${ext}（支持 ${SUPPORTED_EXTS.join(' / ')}）`)
}
