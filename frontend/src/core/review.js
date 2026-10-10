/** 本地引擎：复习排程（与后端 services/review.py 等价）
 *
 * 艾宾浩斯遗忘曲线：默认间隔 1、2、4、7、15、30 天，共 6 次。
 */

export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30]
export const MAX_STAGE = EBBINGHAUS_INTERVALS.length

export function intervalsLabel() {
  return EBBINGHAUS_INTERVALS.join('、')
}

/** 知识点树 → 可复习条目（除根节点外每个节点一条；根节点带要点时也纳入） */
export function flattenKnowledge(node, path = '', depth = 0, out = []) {
  if (!node || typeof node !== 'object') return out
  const title = String(node.title || '知识点').trim()
  const curPath = path ? `${path} / ${title}` : title
  const points = (node.key_points || []).map((p) => String(p).trim()).filter(Boolean)

  if (depth > 0 || points.length) out.push({ path: curPath, title, key_points: points })
  for (const child of node.children || []) flattenKnowledge(child, curPath, depth + 1, out)
  return out
}

const DAY = 24 * 3600 * 1000

export function makeReviewItem(taskId, filename, entry, now = Date.now(), userId = null) {
  return {
    id: `${taskId}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    user_id: userId,
    task_id: taskId,
    filename,
    path: entry.path.slice(0, 255),
    title: entry.title.slice(0, 120),
    key_points: entry.key_points,
    stage: 0,
    status: 'active',
    next_review_at: now + EBBINGHAUS_INTERVALS[0] * DAY,
    last_reviewed_at: null,
    created_at: now,
  }
}

export function nextIntervalDays(item) {
  const index = Math.min(item.stage || 0, MAX_STAGE - 1)
  return EBBINGHAUS_INTERVALS[index]
}

/** 完成一次复习：stage+1，按间隔表排下一次；走完即掌握 */
export function advance(item, now = Date.now()) {
  item.stage = (item.stage || 0) + 1
  item.last_reviewed_at = now
  if (item.stage >= MAX_STAGE) {
    item.status = 'mastered'
    item.next_review_at = now + EBBINGHAUS_INTERVALS[MAX_STAGE - 1] * DAY
  } else {
    item.next_review_at = now + EBBINGHAUS_INTERVALS[item.stage] * DAY
  }
  return item
}

/** 直接完成（跳过剩余间隔） */
export function master(item, now = Date.now()) {
  item.stage = MAX_STAGE
  item.status = 'mastered'
  item.last_reviewed_at = now
  item.next_review_at = now + EBBINGHAUS_INTERVALS[MAX_STAGE - 1] * DAY
  return item
}

/** 记忆保持率 R = e^(-t/S)，S 取当前阶段间隔天数 */
export function retentionPercent(item, now = Date.now()) {
  const base = item.last_reviewed_at || item.created_at || now
  const stability = Math.max(nextIntervalDays(item), 1)
  const elapsedDays = Math.max((now - base) / DAY, 0)
  const ratio = Math.exp(-elapsedDays / stability)
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtDateTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${fmtDate(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function itemToDict(item, now = Date.now()) {
  const due = item.status === 'active' && item.next_review_at != null && item.next_review_at <= now
  const overdueDays = due && item.next_review_at ? Math.max(Math.floor((now - item.next_review_at) / DAY), 0) : 0
  let daysUntil = null
  if (item.next_review_at) {
    const a = new Date(now); a.setHours(0, 0, 0, 0)
    const b = new Date(item.next_review_at); b.setHours(0, 0, 0, 0)
    daysUntil = Math.round((b - a) / DAY)
  }
  return {
    id: item.id,
    task_id: item.task_id,
    filename: item.filename,
    path: item.path,
    title: item.title,
    key_points: item.key_points || [],
    stage: item.stage || 0,
    max_stage: MAX_STAGE,
    status: item.status,
    next_review_at: fmtDateTime(item.next_review_at),
    next_review_date: fmtDate(item.next_review_at),
    last_reviewed_at: fmtDateTime(item.last_reviewed_at),
    created_at: fmtDateTime(item.created_at),
    is_due: due,
    overdue_days: overdueDays,
    days_until: daysUntil,
    retention: retentionPercent(item, now),
  }
}

/** 未来 N 天安排，按日期分组 */
export function upcomingGroups(items, days = 7, now = Date.now()) {
  const horizon = now + days * DAY
  const rows = items
    .filter((i) => i.status === 'active' && i.next_review_at > now && i.next_review_at <= horizon)
    .sort((a, b) => a.next_review_at - b.next_review_at)

  const grouped = {}
  for (const row of rows) {
    const key = fmtDate(row.next_review_at)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(itemToDict(row, now))
  }

  const today = new Date(now); today.setHours(0, 0, 0, 0)
  return Object.keys(grouped)
    .sort()
    .map((date) => {
      const d = new Date(`${date}T00:00:00`)
      const delta = Math.round((d - today) / DAY)
      const label = delta === 0 ? '今天' : delta === 1 ? '明天' : `${delta} 天后`
      return { date, label, items: grouped[date], count: grouped[date].length }
    })
}

/** 总览统计（含完成进度） */
export function summary(items, now = Date.now()) {
  const total = items.length
  const mastered = items.filter((i) => i.status === 'mastered').length
  const active = total - mastered
  const due = items.filter((i) => i.status === 'active' && i.next_review_at <= now).length
  const upcoming7d = items.filter(
    (i) => i.status === 'active' && i.next_review_at > now && i.next_review_at <= now + 7 * DAY
  ).length
  const stagesDone = items.reduce((s, i) => s + Math.min(i.stage || 0, MAX_STAGE), 0)
  const stagesTotal = total * MAX_STAGE
  return {
    total,
    active,
    due,
    mastered,
    upcoming_7d: upcoming7d,
    stages_done: stagesDone,
    stages_total: stagesTotal,
    progress_percent: total ? Math.round((mastered / total) * 100) : 0,
    stage_percent: stagesTotal ? Math.round((stagesDone / stagesTotal) * 100) : 0,
    intervals: [...EBBINGHAUS_INTERVALS],
    intervals_label: intervalsLabel(),
  }
}

/** 按课件汇总进度 */
export function progressByTask(items, now = Date.now()) {
  const grouped = {}
  for (const item of items) {
    const g = (grouped[item.task_id] = grouped[item.task_id] || {
      task_id: item.task_id,
      filename: item.filename || '（未知来源）',
      total: 0,
      mastered: 0,
      due: 0,
      stages_done: 0,
    })
    g.total += 1
    g.stages_done += Math.min(item.stage || 0, MAX_STAGE)
    if (item.status === 'mastered') g.mastered += 1
    else if (item.next_review_at <= now) g.due += 1
  }
  return Object.values(grouped)
    .map((g) => ({
      ...g,
      active: g.total - g.mastered,
      stages_total: g.total * MAX_STAGE,
      percent: g.total ? Math.round((g.mastered / g.total) * 100) : 0,
      stage_percent: g.stages_total ? Math.round((g.stages_done / g.stages_total) * 100) : 0,
    }))
    .sort((a, b) => b.due - a.due || a.percent - b.percent || a.filename.localeCompare(b.filename))
}
