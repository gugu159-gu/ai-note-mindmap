/** 本地引擎：知识点树 → Markdown 大纲（与后端 services/knowledge.py 等价） */

export function knowledgeToMarkdown(node) {
  const lines = []
  const walk = (n, depth) => {
    const title = (n && n.title) || ''
    if (title) lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${title}`)
    for (const kp of (n && n.key_points) || []) lines.push(`- ${kp}`)
    for (const child of (n && n.children) || []) walk(child, depth + 1)
  }
  walk(node, 0)
  return lines.filter((l) => l).join('\n')
}

export function markdownToKnowledge(md, rootTitle = '知识点') {
  const root = { title: rootTitle, key_points: [], children: [] }
  const stack = [[0, root]]
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim()
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      const level = Math.min(m[1].length, 3)
      const node = { title: m[2].trim(), key_points: [], children: [] }
      while (stack.length && stack[stack.length - 1][0] >= level) stack.pop()
      const parent = stack.length ? stack[stack.length - 1][1] : root
      parent.children.push(node)
      stack.push([level, node])
    } else if (line.startsWith('- ')) {
      const point = line.slice(2).trim()
      const node = stack.length ? stack[stack.length - 1][1] : root
      if (point && !node.key_points.includes(point)) node.key_points.push(point)
    }
  }
  return root
}
