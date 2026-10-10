/** 本地引擎：本地规则兜底提取（与后端 services/fallback.py 等价）
 *
 * 规则：
 * - PPTX 解析输出的 "# 标题" 行 → 建章节节点
 * - 编号标题（1. / 1.1 / （一）等）→ 建节点
 * - 其余行 → 作为当前节点要点（去重、限长、每节点 ≤5 条）
 * - 层级 ≤3 层、子节点 ≤20，无标题时退化为「根节点 + 要点列表」
 */

export const MAX_DEPTH = 3
export const MAX_CHILDREN = 20
export const MAX_POINTS = 5
export const POINT_MAX_LEN = 60

function matchHeading(line) {
  let m = line.match(/^(#{1,3})\s+(.+)$/)
  if (m) return [m[1].length, m[2].trim()]

  // 中文编号：1、 / 1.1、 / 1.1.1、
  m = line.match(/^(\d+(?:[.．]\d+){0,2})[、．]\s*(.+)$/)
  if (m) return [Math.min((m[1].match(/\./g) || []).length + 1, MAX_DEPTH), m[2].trim()]

  // ASCII 编号：1. 标题 / 1.1 标题（限制位数避免误判年份等）
  m = line.match(/^(\d{1,2}(?:\.\d{1,2}){0,2})\s+(.+)$/)
  if (m) return [Math.min((m[1].match(/\./g) || []).length + 1, MAX_DEPTH), m[2].trim()]

  // 中文数字：(一) / 一、
  m = line.match(/^[（(]?[一二三四五六七八九十]+[）)][、.．]\s*(.+)$/)
  if (m) return [1, m[1].trim()]

  return [0, null]
}

function stripBullet(line) {
  return line.replace(/^[-•*▪]\s*/, '').trim()
}

function addPoint(node, point) {
  const p = String(point || '').trim()
  if (!p || p.length < 2) return
  if (node.key_points.includes(p)) return
  if (node.key_points.length >= MAX_POINTS) return
  node.key_points.push(p.slice(0, POINT_MAX_LEN))
}

export function fallbackExtract(text, title = '知识点') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l)

  if (!lines.length) return { title: String(title).slice(0, 60), key_points: [], children: [] }

  const root = { title: String(title).slice(0, 60), key_points: [], children: [] }
  const stack = [[0, root]]   // [depth, node]
  const current = () => stack[stack.length - 1][1]

  for (const line of lines) {
    const [level, heading] = matchHeading(line)
    if (heading !== null) {
      const node = { title: heading.slice(0, 60), key_points: [], children: [] }
      while (stack.length > 1 && stack[stack.length - 1][0] >= level) stack.pop()
      const parent = current()
      if (parent.children.length < MAX_CHILDREN) {
        parent.children.push(node)
        stack.push([Math.min(level, MAX_DEPTH), node])
      } else {
        addPoint(current(), heading)   // 子节点溢出：降级为要点
      }
      continue
    }
    addPoint(current(), stripBullet(line))
  }

  if (!root.children.length && !root.key_points.length) {
    for (const ln of lines.slice(0, 20)) addPoint(root, stripBullet(ln))
  }
  return root
}
