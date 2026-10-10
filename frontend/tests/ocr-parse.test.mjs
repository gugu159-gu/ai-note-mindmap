/** 单机模式拍照识别链路验证：图片 → OCR → 规则提取 → 知识点树 → Markdown
 *  运行： node tests/ocr-parse.test.mjs [图片路径]
 *  说明：与 App 内 core/parse.js 的 parseImage 完全同一套代码（tesseract.js）；
 *        首次运行会从 CDN 下载中文识别模型（约 15MB），之后走本地缓存。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const imgPath = process.argv[2] || path.resolve(here, '..', '..', 'demo_拍照.png')

const { parseImage } = await import('../src/core/parse.js')
const { fallbackExtract } = await import('../src/core/fallback.js')
const { knowledgeToMarkdown } = await import('../src/core/knowledge.js')
const { textIsUsable, meaningfulRatio } = await import('../src/core/parse.js')

console.log(`图片: ${imgPath}`)
console.log('开始 OCR（首次需下载语言模型，请耐心等待）…')

const t0 = Date.now()
let lastLog = ''
const text = await parseImage(imgPath, (m) => {
  const line = `${m.status} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`
  if (line !== lastLog) {
    lastLog = line
    process.stdout.write(`\r  进度: ${line}                    `)
  }
})
const cost = ((Date.now() - t0) / 1000).toFixed(1)

console.log('\n')
console.log('='.repeat(60))
console.log(`OCR 原始识别结果（耗时 ${cost}s）：`)
console.log('='.repeat(60))
console.log(text.trim() || '（未识别到文字）')

console.log('\n' + '='.repeat(60))
console.log('文本质量判定（与后端同一套阈值）')
console.log('='.repeat(60))
console.log(`  可用: ${textIsUsable(text)}   有效字符占比: ${meaningfulRatio(text).toFixed(2)}   字符数: ${text.replace(/\s/g, '').length}`)

console.log('\n' + '='.repeat(60))
console.log('规则提取 → 知识点树（LLM 未启用时的兜底路径）')
console.log('='.repeat(60))
const tree = fallbackExtract(text, path.basename(imgPath).replace(/\.[^.]+$/, ''))
const dump = (n, d = 0) => {
  console.log(`${'  '.repeat(d)}- ${n.title}${n.key_points.length ? '  [' + n.key_points.length + ' 要点]' : ''}`)
  n.key_points.forEach((p) => console.log(`${'  '.repeat(d + 1)}· ${p}`))
  n.children.forEach((c) => dump(c, d + 1))
}
dump(tree)

console.log('\n' + '='.repeat(60))
console.log('生成的 Markdown 大纲（导图数据源）')
console.log('='.repeat(60))
console.log(knowledgeToMarkdown(tree))
