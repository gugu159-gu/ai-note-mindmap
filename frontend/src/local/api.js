/** 本地 API 门面：接口形状与后端 REST 完全一致，但全部在手机端执行
 *
 * 页面代码（Convert/Review/History/Settings）无需改动，只需切换数据源。
 */
import {
  DEFAULT_AI_CONFIG,
  llmExtract,
} from '../core/extract.js'
import { fallbackExtract } from '../core/fallback.js'
import { knowledgeToMarkdown } from '../core/knowledge.js'
import { parseFile, extOf, SUPPORTED_EXTS } from '../core/parse.js'
import * as R from '../core/review.js'
import { localDb } from './db.js'

export const MAX_UPLOAD_MB = 50

const AI_CONFIG_KEY = 'ai_config'
const PROFILE_KEY = 'local_profile'

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function nowStr(ts = Date.now()) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function maskKey(key) {
  if (!key) return ''
  return key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : '****'
}

/* ------------------------------------------------------------ 账号（本地模式） */

export async function localProfile() {
  let p = await localDb.kvGet(PROFILE_KEY)
  if (!p) {
    p = { id: 'local', username: 'local', display_name: '本机用户', created_at: nowStr() }
    await localDb.kvSet(PROFILE_KEY, p)
  }
  return p
}

export async function updateProfile(patch) {
  const p = { ...(await localProfile()), ...patch }
  await localDb.kvSet(PROFILE_KEY, p)
  return p
}

/* ------------------------------------------------------------ 设置 */

export async function getAiConfig() {
  const cfg = await localDb.kvGet(AI_CONFIG_KEY)
  return { ...DEFAULT_AI_CONFIG, ...(cfg || {}) }
}

export async function saveAiConfig(patch) {
  const merged = { ...(await getAiConfig()), ...(patch || {}) }
  if (!merged.prompt_template) merged.prompt_template = DEFAULT_AI_CONFIG.prompt_template
  await localDb.kvSet(AI_CONFIG_KEY, merged)
  return merged
}

/* ------------------------------------------------------------ 任务 */

async function runPipeline(file, filename, onProgress) {
  const text = await parseFile(file, filename, onProgress)
  const cfg = await getAiConfig()
  let knowledge = await llmExtract(text, cfg)
  let source = 'llm'
  if (!knowledge) {
    const stem = filename.replace(/\.[^.]+$/, '') || '知识点'
    knowledge = fallbackExtract(text, stem)
    source = 'fallback'
  }
  return {
    knowledge,
    outline: knowledgeToMarkdown(knowledge),
    source,
    // 保存解析/识别出的原文（截断），便于用户核对识别质量
    text: String(text || '').slice(0, 20000),
  }
}

/** 生成原图缩略图（JPEG dataURL），用于结果页对照与后续核对 */
async function makeThumb(file) {
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return ''
    if (!/^image\//.test(file.type || '')) return ''
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    if (bmp.close) bmp.close()
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch (e) {
    return ''
  }
}

export async function upload(file, onProgress) {
  const filename = file?.name || 'unnamed'
  const ext = extOf(filename)
  if (!SUPPORTED_EXTS.includes(ext)) {
    throw new Error(`不支持的文件类型 .${ext}（支持 ${SUPPORTED_EXTS.join(' / ')}）`)
  }
  if (file.size && file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`文件超过 ${MAX_UPLOAD_MB}MB 上限，请压缩或拆分后重试`)
  }

  const id = uid()
  const task = {
    id,
    filename,
    file_type: ext,
    status: 'done',
    error: '',
    outline: '',
    knowledge: null,
    created_at: Date.now(),
    source: '',
    text: '',
    thumb: '',
  }

  task.thumb = await makeThumb(file)

  try {
    const { knowledge, outline, source, text } = await runPipeline(file, filename, onProgress)
    task.knowledge = knowledge
    task.outline = outline
    task.source = source
    task.text = text
  } catch (e) {
    task.status = 'error'
    task.error = String(e.message || e)
  }

  // 生成复习计划（仅成功时）
  let reviewCount = 0
  if (task.status === 'done') {
    const entries = R.flattenKnowledge(task.knowledge)
    const items = entries.map((entry) => R.makeReviewItem(id, filename, entry))
    reviewCount = items.length
    if (items.length) await localDb.putMany('reviews', items)
  }

  await localDb.put('tasks', task)
  return taskToOut(task, reviewCount)
}

export function taskToOut(task, reviewItems = 0) {
  return {
    id: task.id,
    filename: task.filename,
    file_type: task.file_type,
    status: task.status,
    error: task.error || '',
    outline: task.outline || '',
    knowledge: task.knowledge || {},
    created_at: nowStr(task.created_at),
    review_items: reviewItems,
    source: task.source || '',
    text: task.text || '',            // 解析/识别出的原文（本机模式提供，用于核对质量）
    thumb: task.thumb || '',          // 原图缩略图（图片类输入）
  }
}

export async function listTasks() {
  const tasks = await localDb.all('tasks')
  const reviews = await localDb.all('reviews')
  const counts = {}
  for (const r of reviews) counts[r.task_id] = (counts[r.task_id] || 0) + 1
  return tasks
    .sort((a, b) => b.created_at - a.created_at)
    .map((t) => taskToOut(t, counts[t.id] || 0))
}

export async function getTask(id) {
  const task = await localDb.get('tasks', id)
  if (!task) throw new Error('任务不存在')
  return taskToOut(task)
}

export async function deleteTask(id) {
  const task = await localDb.get('tasks', id)
  if (!task) throw new Error('任务不存在')
  const removed = await localDb.removeByIndex('reviews', 'task_id', id)
  await localDb.remove('tasks', id)
  return { ok: true, removed_review_items: removed }
}

/* ------------------------------------------------------------ 复习 */

async function allReviews() {
  return (await localDb.all('reviews')).sort((a, b) => a.next_review_at - b.next_review_at)
}

export async function reviewSummary() {
  return R.summary(await allReviews())
}

export async function reviewDue() {
  const now = Date.now()
  return (await allReviews())
    .filter((i) => i.status === 'active' && i.next_review_at <= now)
    .map((i) => R.itemToDict(i, now))
}

export async function reviewUpcoming(days = 7) {
  return R.upcomingGroups(await allReviews(), days)
}

export async function reviewProgress() {
  return R.progressByTask(await allReviews())
}

export async function reviewList(taskId) {
  const now = Date.now()
  const items = await allReviews()
  return (taskId ? items.filter((i) => i.task_id === taskId) : items).map((i) => R.itemToDict(i, now))
}

async function mutateReview(id, mutate) {
  const item = await localDb.get('reviews', id)
  if (!item) throw new Error('复习项不存在')
  mutate(item)
  await localDb.put('reviews', item)
  return item
}

export async function reviewComplete(id) {
  const now = Date.now()
  const item = await mutateReview(id, (it) => R.advance(it, now))
  const data = R.itemToDict(item, now)
  data.message =
    item.status === 'active'
      ? `已记录第 ${item.stage} 次复习，下次复习：${data.next_review_date}`
      : `已完成全部 ${R.MAX_STAGE} 次复习，标记为已掌握`
  return data
}

export async function reviewMaster(id) {
  const item = await mutateReview(id, (it) => R.master(it))
  const data = R.itemToDict(item)
  data.message = `${item.title}：复习计划已完成`
  return data
}

export async function reviewReset(id) {
  const now = Date.now()
  const item = await mutateReview(id, (it) => {
    it.stage = 0
    it.status = 'active'
    it.last_reviewed_at = null
    it.next_review_at = now
  })
  return R.itemToDict(item, now)
}

export async function reviewDelete(id) {
  await localDb.remove('reviews', id)
  return { ok: true }
}

export async function reviewCompleteAll(taskId) {
  const now = Date.now()
  const items = await allReviews()
  const targets = items.filter((i) => i.status === 'active' && (!taskId || i.task_id === taskId))
  for (const it of targets) {
    R.master(it, now)
    await localDb.put('reviews', it)
  }
  return {
    ok: true,
    completed: targets.length,
    message: targets.length ? `已完成 ${targets.length} 个知识点的复习计划` : '没有待完成的复习项',
    summary: R.summary(await allReviews(), now),
  }
}

/* ------------------------------------------------------------ 数据导出/导入（备份用） */

export async function exportAll() {
  return {
    version: 1,
    exported_at: nowStr(),
    tasks: await localDb.all('tasks'),
    reviews: await localDb.all('reviews'),
    ai_config: await getAiConfig(),
    profile: await localProfile(),
  }
}

export async function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('备份文件格式不正确')
  if (Array.isArray(payload.tasks)) await localDb.putMany('tasks', payload.tasks)
  if (Array.isArray(payload.reviews)) await localDb.putMany('reviews', payload.reviews)
  if (payload.ai_config) await saveAiConfig(payload.ai_config)
  if (payload.profile) await updateProfile(payload.profile)
  return {
    tasks: (payload.tasks || []).length,
    reviews: (payload.reviews || []).length,
  }
}

export const localApi = {
  // —— 账号：本地模式无需登录，直接使用本机档案 ——
  authStatus: async () => ({ has_users: true, local: true }),
  me: async () => {
    const p = await localProfile()
    return {
      id: p.id,
      username: p.username,
      display_name: p.display_name || '本机用户',
      created_at: p.created_at || '',
      last_login_at: '',
      claimed_items: 0,
      token: '',
      local: true,
    }
  },
  login: async () => {
    const p = await localProfile()
    return { id: p.id, username: p.username, display_name: p.display_name, token: '' }
  },
  register: async ({ display_name } = {}) => {
    const p = await updateProfile(display_name ? { display_name } : {})
    return { id: p.id, username: p.username, display_name: p.display_name, token: '' }
  },
  logout: async () => ({ ok: true, local: true }),

  /** 本机模式：原图就是已保存的缩略图 */
  taskFileUrl: async (id) => {
    const task = await localDb.get('tasks', id)
    return (task && task.thumb) || ''
  },

  upload,
  listTasks,
  getTask,
  deleteTask,
  getSettings: async () => {
    const cfg = await getAiConfig()
    return {
      enabled: cfg.enabled,
      base_url: cfg.base_url,
      api_key_masked: maskKey(cfg.api_key),
      model: cfg.model,
      max_tokens: cfg.max_tokens,
      prompt_template: cfg.prompt_template,
    }
  },
  saveSettings: async (data) => {
    const current = await getAiConfig()
    const patch = { ...data }
    if (!patch.api_key) patch.api_key = current.api_key   // 传空表示保留原值
    const merged = await saveAiConfig(patch)
    return {
      enabled: merged.enabled,
      base_url: merged.base_url,
      api_key_masked: maskKey(merged.api_key),
      model: merged.model,
      max_tokens: merged.max_tokens,
      prompt_template: merged.prompt_template,
    }
  },
  reviewSummary,
  reviewDue,
  reviewUpcoming,
  reviewProgress,
  reviewList,
  reviewComplete,
  reviewMaster,
  reviewReset,
  reviewDelete,
  reviewCompleteAll,
  exportAll,
  importAll,
  updateProfile,
}
