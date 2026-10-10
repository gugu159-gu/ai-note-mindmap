/** PDF 解析路径验证（Node 侧跑与 App 内相同的 pdf.js 代码）
 *  运行： node tests/pdf-parse.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pdfPath = path.resolve(here, '..', '..', 'demo_计算机网络.pdf')

const { parsePdf, textIsUsable, meaningfulRatio } = await import('../src/core/parse.js')

let passed = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? ' :: ' + extra : ''}`) }
  else { failures.push(name); console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`) }
}

try {
  const buf = await readFile(pdfPath)
  const file = new File([buf], 'demo_计算机网络.pdf', { type: 'application/pdf' })
  console.log(`  PDF 大小: ${Math.round(buf.length / 1024)} KB`)

  const text = await parsePdf(file)
  check('PDF 文本抽取成功', typeof text === 'string' && text.length > 50, `chars=${text.length}`)
  check('文本可用性通过', textIsUsable(text), `ratio=${meaningfulRatio(text).toFixed(2)}`)
  check('包含中文内容', /[\u4e00-\u9fff]/.test(text), text.split('\n')[0])
  check('识别到章节内容', text.includes('OSI') && text.includes('TCP/IP'),
    text.split('\n').slice(0, 4).join(' / '))

  // 兜底提取链路（与 App 内一致）
  const { fallbackExtract } = await import('../src/core/fallback.js')
  const { knowledgeToMarkdown } = await import('../src/core/knowledge.js')
  const tree = fallbackExtract(text, '计算机网络')
  check('规则兜底生成树', (tree.children || []).length >= 3,
    `children=${(tree.children || []).map((c) => c.title).join(' | ')}`)
  const md = knowledgeToMarkdown(tree)
  check('生成 Markdown 大纲', md.includes('# 计算机网络') && md.includes('- '), `${md.split('\n').length} 行`)
} catch (e) {
  failures.push('EXCEPTION ' + (e && e.stack ? e.stack : e))
  console.log('  EXCEPTION ' + (e && e.message ? e.message : e))
}

console.log(`\n${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f))
  process.exit(1)
}
