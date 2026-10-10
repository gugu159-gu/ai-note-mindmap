/** 本地独立模式端到端测试（Node + fake-indexeddb）
 *  运行： node tests/local-api.test.mjs
 *  覆盖：本机档案 → 上传(解析+兜底提取+生成复习计划) → 任务/复习查询 → 间隔推进 →
 *        进度统计 → 未来安排 → 备份导出/导入 → 删除任务联动清理
 */
import 'fake-indexeddb/auto'

import assert from 'node:assert/strict'

const { localApi: api } = await import('../src/local/api.js')

const DAY = 24 * 3600 * 1000
let passed = 0
const failures = []
const results = []

function check(name, cond, extra = '') {
  if (cond) {
    passed++
    results.push(`  PASS  ${name}${extra ? ' :: ' + extra : ''}`)
  } else {
    failures.push(name)
    results.push(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`)
  }
}

const SAMPLE = [
  '# 第一章 软件过程',
  '软件过程是软件生命周期中的一系列活动',
  '- 需求分析',
  '- 设计',
  '- 编码与测试',
  '1.1 过程模型',
  '瀑布模型：阶段化、文档驱动',
  '增量模型：分批交付',
  '# 第二章 需求工程',
  '需求获取方法：访谈、问卷、原型',
  '需求规格说明书的编写',
].join('\n')

async function main() {
  // 清空上次残留
  for (const t of await api.listTasks()) await api.deleteTask(t.id)

  // 1. 本机档案
  const me = await api.me()
  check('本机档案可用', me && me.local === true, `username=${me.username}`)
  const renamed = await api.updateProfile({ display_name: '测试用户' })
  check('可修改本机显示名称', renamed.display_name === '测试用户')

  // 2. 上传 → 解析 → 提取 → 复习计划
  const file = new File([SAMPLE], 'demo_local.txt', { type: 'text/plain' })
  const task = await api.upload(file)
  check('上传解析成功', task.status === 'done', `status=${task.status} err=${task.error || '-'}`)
  check('生成复习项', task.review_items > 0, `review_items=${task.review_items}`)
  check('生成 Markdown 大纲', (task.outline || '').includes('# 第一章 软件过程'))
  check('知识点树章节数 ≥ 2', (task.knowledge?.children || []).length >= 2,
    `children=${(task.knowledge?.children || []).map((c) => c.title).join(' | ')}`)

  // 3. 本地库读取
  const tasks = await api.listTasks()
  check('任务写入本地库', tasks.length === 1, `tasks=${tasks.length}`)
  check('任务列表带复习项计数', tasks[0].review_items === task.review_items)
  const fetched = await api.getTask(task.id)
  check('可按 id 读取任务', fetched.id === task.id)

  // 4. 复习总览（首次复习应在 1 天后）
  const s1 = await api.reviewSummary()
  check('总览统计正确', s1.total === task.review_items, `total=${s1.total}/${task.review_items}`)
  check('间隔表为 1/2/4/7/15/30', JSON.stringify(s1.intervals) === JSON.stringify([1, 2, 4, 7, 15, 30]), s1.intervals_label)
  check('当前无到期项', (await api.reviewDue()).length === 0)

  // 5. 复习项查询与推进
  const items = await api.reviewList(task.id)
  check('复习项按任务可查', items.length === task.review_items, `items=${items.length}`)
  const first = items[0]
  await api.reviewReset(first.id)
  check('重置后立即到期', (await api.reviewDue()).some((d) => d.id === first.id))

  const done = await api.reviewComplete(first.id)
  check('完成一次 → stage=1', done.stage === 1, `stage=${done.stage}/${done.max_stage}`)
  const after = (await api.reviewList(task.id)).find((i) => i.id === first.id)
  const gapDays = Math.round((new Date(after.next_review_at.replace(' ', 'T')) - Date.now()) / DAY)
  check('下次复习在 2 天后', gapDays === 2, `gap=${gapDays} 天 (${after.next_review_at})`)
  check('完成消息含下次日期', /下次复习：\d{4}-\d{2}-\d{2}/.test(done.message), done.message)

  // 6. 直接完成 + 进度统计
  const second = items[1] || first
  const mastered = await api.reviewMaster(second.id)
  check('可直接完成（master）', mastered.status === 'mastered' && mastered.stage === mastered.max_stage)

  const progress = await api.reviewProgress()
  check('按课件进度可用', progress.length === 1,
    `percent=${progress[0].percent}% mastered=${progress[0].mastered}/${progress[0].total}`)
  const s2 = await api.reviewSummary()
  check('整体进度已更新', s2.progress_percent > 0 && s2.mastered >= 1, `progress=${s2.progress_percent}% mastered=${s2.mastered}`)

  // 7. 未来安排
  const upcoming = await api.reviewUpcoming(7)
  check('未来 7 天安排可用', upcoming.length >= 1, upcoming.map((g) => `${g.label}:${g.count}`).join(' '))

  // 8. 一键完成整份课件
  const all = await api.reviewCompleteAll(task.id)
  check('一键完成该课件计划', all.completed === task.review_items - 2 || all.completed >= 0, `completed=${all.completed}`)
  const s3 = await api.reviewSummary()
  check('完成后进度 100%', s3.progress_percent === 100, `progress=${s3.progress_percent}% due=${s3.due}`)

  // 9. AI 配置（本机独立存储）
  const savedCfg = await api.saveSettings({ enabled: true, model: 'deepseek-chat', api_key: 'sk-test-1234567890' })
  check('AI 配置保存并掩码返回', savedCfg.api_key_masked.includes('****'), savedCfg.api_key_masked)
  const cfg2 = await api.getSettings()
  check('配置可回读', cfg2.enabled === true && cfg2.model === 'deepseek-chat')
  const keep = await api.saveSettings({ enabled: false })   // 不传 key → 保留原值
  check('空 key 保留原值', keep.enabled === false && keep.api_key_masked === savedCfg.api_key_masked)

  // 10. 备份导出 / 导入
  const backup = await api.exportAll()
  check('备份包含任务与复习项', backup.tasks.length === 1 && backup.reviews.length > 0,
    `tasks=${backup.tasks.length} reviews=${backup.reviews.length}`)
  const imported = await api.importAll(backup)
  check('备份可导入（幂等）', imported.tasks === 1 && imported.reviews === backup.reviews.length, JSON.stringify(imported))

  // 11. 删除任务联动清理
  const del = await api.deleteTask(task.id)
  check('删除任务清理复习项', del.removed_review_items === backup.reviews.length, `removed=${del.removed_review_items}`)
  check('删除后无任务', (await api.listTasks()).length === 0)
  check('删除后无复习项', (await api.reviewSummary()).total === 0)

  // 12. 错误处理
  let errorMsg = ''
  try {
    await api.upload(new File(['x'], 'bad.exe', { type: 'application/octet-stream' }))
  } catch (e) {
    errorMsg = e.message
  }
  check('非法类型被拒绝', errorMsg.includes('不支持的文件类型'), errorMsg)
}

try {
  await main()
} catch (e) {
  failures.push('EXCEPTION ' + (e && e.stack ? e.stack : e))
}

console.log(results.join('\n'))
console.log(`\n${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('失败：')
  failures.forEach((f) => console.log('  - ' + f))
  process.exit(1)
}
