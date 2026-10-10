/** 本地引擎单元测试（Node 直接跑，不需要浏览器）
 *  运行： node tests/engine.test.mjs
 */
import assert from 'node:assert/strict'

import { normalizeKnowledge, parseJsonContent } from '../src/core/extract.js'
import { fallbackExtract, MAX_POINTS } from '../src/core/fallback.js'
import { knowledgeToMarkdown, markdownToKnowledge } from '../src/core/knowledge.js'
import { meaningfulRatio, textIsUsable, pptxXmlToText } from '../src/core/parse.js'
import * as R from '../src/core/review.js'

const SAMPLE = `
# 第一章 软件过程
软件过程是软件生命周期中的一系列活动
- 需求分析
- 设计
- 编码与测试
1.1 过程模型
瀑布模型：阶段化、文档驱动
增量模型：分批交付
# 第二章 需求工程
需求获取方法
用户访谈
原型法
`

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failures.push(`${name}: ${e.message}`)
    console.log(`  FAIL  ${name}: ${e.message}`)
  }
}

/* ---------------- 规则兜底提取 ---------------- */
test('fallback: Markdown 风格文本建树', () => {
  const tree = fallbackExtract(SAMPLE, '测试课件')
  assert.equal(tree.title, '测试课件')
  const titles = tree.children.map((c) => c.title)
  assert.ok(titles.includes('第一章 软件过程'), `缺少第一章，实际：${titles}`)
  assert.ok(titles.includes('第二章 需求工程'))
  const ch1 = tree.children.find((c) => c.title === '第一章 软件过程')
  assert.equal(ch1.children[0].title, '过程模型')
  assert.ok(ch1.key_points.length >= 1)
})

test('fallback: 无标题文本退化为根节点要点', () => {
  const tree = fallbackExtract('苹果 香蕉 橙子\n都是水果', '水果')
  assert.equal(tree.title, '水果')
  assert.ok(tree.key_points.length >= 2)
})

test('fallback: 空文本不崩', () => {
  const tree = fallbackExtract('   \n  ', '空')
  assert.equal(tree.title, '空')
  assert.deepEqual(tree.children, [])
})

test('fallback: 每节点要点上限', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `要点内容第${i}条`).join('\n')
  const tree = fallbackExtract(lines, 'T')
  assert.equal(tree.key_points.length, MAX_POINTS)
})

/* ---------------- PPTX XML 解析 ---------------- */
test('pptx: 按段落抽取文本', () => {
  const xml = `<?xml version="1.0"?><p:sld xmlns:a="x"><p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>第三章 测试</a:t></a:r></a:p>
      <a:p><a:r><a:t>要点一</a:t></a:r><a:r><a:t>补充</a:t></a:r></a:p>
      <a:p><a:r><a:t>要点二</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const lines = pptxXmlToText(xml)
  assert.deepEqual(lines, ['第三章 测试', '要点一补充', '要点二'])
})

test('pptx: 实体解码', () => {
  const lines = pptxXmlToText('<a:p><a:r><a:t>A &amp; B &lt;x&gt;</a:t></a:r></a:p>')
  assert.deepEqual(lines, ['A & B <x>'])
})

/* ---------------- 知识点树 ↔ Markdown ---------------- */
test('knowledge: 树 → Markdown → 树', () => {
  const tree = {
    title: '根',
    key_points: ['要点A'],
    children: [{ title: '子', key_points: ['要点B'], children: [] }],
  }
  const md = knowledgeToMarkdown(tree)
  assert.ok(md.includes('# 根'))
  assert.ok(md.includes('## 子'))
  assert.ok(md.includes('- 要点A'))
  const back = markdownToKnowledge(md)
  assert.equal(back.children[0].title, '根')
  assert.equal(back.children[0].children[0].title, '子')
})

/* ---------------- LLM 输出归一化 ---------------- */
test('extract: JSON 容错解析', () => {
  assert.deepEqual(parseJsonContent('```json\n{"title":"A"}\n```'), { title: 'A' })
  assert.deepEqual(parseJsonContent('噪声 {"title":"B"} 尾巴'), { title: 'B' })
  assert.equal(parseJsonContent('not json'), null)
})

test('extract: 层级上限 3 层', () => {
  const deep = { title: 'L1', children: [{ title: 'L2', children: [{ title: 'L3', children: [{ title: 'L4' }] }] }] }
  const tree = normalizeKnowledge(deep)
  assert.equal(tree.children[0].children[0].title, 'L3')
  assert.deepEqual(tree.children[0].children[0].children, [])
})

test('extract: 要点去重限长且 ≤5 条', () => {
  const tree = normalizeKnowledge({ title: 'T', key_points: ['a', 'a', 'b', 'c', 'd', 'e', 'f'] })
  assert.deepEqual(tree.key_points, ['a', 'b', 'c', 'd', 'e'])
})

/* ---------------- 复习排程 ---------------- */
test('review: 间隔表推进 1→2→4→7→15→30 并标记掌握', () => {
  assert.deepEqual(R.EBBINGHAUS_INTERVALS, [1, 2, 4, 7, 15, 30])
  const DAY = 24 * 3600 * 1000
  const now = Date.UTC(2026, 0, 1, 9, 0, 0)
  const item = R.makeReviewItem('t1', 'demo.txt', { path: 'a', title: 'a', key_points: [] }, now)
  assert.equal(item.stage, 0)
  assert.equal(item.next_review_at, now + 1 * DAY)

  const expect = [2, 4, 7, 15, 30]
  expect.forEach((days, idx) => {
    R.advance(item, now)
    assert.equal(item.stage, idx + 1)
    assert.equal(item.next_review_at, now + days * DAY)
  })
  R.advance(item, now)
  assert.equal(item.stage, R.MAX_STAGE)
  assert.equal(item.status, 'mastered')
})

test('review: 直接完成（master）', () => {
  const item = R.makeReviewItem('t2', 'x.txt', { path: 'p', title: '标题', key_points: [] })
  R.master(item)
  assert.equal(item.stage, R.MAX_STAGE)
  assert.equal(item.status, 'mastered')
})

test('review: 保持率随间隔衰减', () => {
  const DAY = 24 * 3600 * 1000
  const base = Date.UTC(2026, 0, 1)
  const item = R.makeReviewItem('t3', 'x.txt', { path: 'p', title: 't', key_points: [] }, base)
  const fresh = R.retentionPercent(item, base)
  const after1 = R.retentionPercent(item, base + DAY)
  const after3 = R.retentionPercent(item, base + 3 * DAY)
  assert.equal(fresh, 100)
  assert.ok(after1 < fresh && after3 < after1, `衰减异常: ${fresh}/${after1}/${after3}`)
})

test('review: 摊平知识点（含路径与根节点规则）', () => {
  const tree = {
    title: '计算机网络',
    children: [
      { title: '2.1 OSI', key_points: ['物理层'], children: [{ title: '物理层', key_points: ['比特流'] }] },
    ],
  }
  const items = R.flattenKnowledge(tree)
  assert.deepEqual(items.map((i) => i.path), ['计算机网络 / 2.1 OSI', '计算机网络 / 2.1 OSI / 物理层'])
  const withRoot = R.flattenKnowledge({ title: '根', key_points: ['总述'], children: [] })
  assert.equal(withRoot[0].title, '根')
  assert.deepEqual(R.flattenKnowledge({ title: '空' }), [])
})

test('review: 总览与按课件进度', () => {
  const DAY = 24 * 3600 * 1000
  const now = Date.UTC(2026, 5, 1)
  const items = [
    { ...R.makeReviewItem('k1', 'a.pptx', { path: 'p1', title: 'n1', key_points: [] }, now), next_review_at: now - DAY },
    R.makeReviewItem('k1', 'a.pptx', { path: 'p2', title: 'n2', key_points: [] }, now),
  ]
  items[1].status = 'mastered'
  items[1].stage = R.MAX_STAGE

  const s = R.summary(items, now)
  assert.equal(s.total, 2)
  assert.equal(s.mastered, 1)
  assert.equal(s.active, 1)
  assert.equal(s.due, 1)
  assert.equal(s.progress_percent, 50)
  assert.ok(s.stage_percent > 0)

  const rows = R.progressByTask(items, now)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].filename, 'a.pptx')
  assert.equal(rows[0].due, 1)
  assert.equal(rows[0].percent, 50)

  const groups = R.upcomingGroups([R.makeReviewItem('k2', 'b.txt', { path: 'p', title: 't', key_points: [] }, now)], 7, now)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, '明天')
})

/* ---------------- 文本质量（乱码/扫描件判定） ---------------- */
test('parse: 文本可用性判定', () => {
  assert.ok(textIsUsable('这是正常的课件文本内容，包含足够数量的中文字符，可以用于提取知识点结构。'))
  assert.ok(!textIsUsable('··· ·····\n1.1 OSI ····'))
  assert.ok(meaningfulRatio('··· ·····') < 0.5)
  assert.ok(!textIsUsable('太短'))
})

console.log(`\n${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('失败用例：')
  failures.forEach((f) => console.log('  - ' + f))
  process.exit(1)
}
