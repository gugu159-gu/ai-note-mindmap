/** 本地引擎：LLM 知识点提取 + 输出归一化（与后端 services/extractor.py 等价） */

export const MAX_TEXT_CHARS = 8000
export const MAX_DEPTH = 3

export const DEFAULT_PROMPT =
  '你是一名学习笔记助手。请从下面的课件文本中提取结构化知识点，' +
  '严格按 JSON 树输出（不要输出任何解释或代码块标记）。\n' +
  '结构：{"title": 根标题, "key_points": [要点1, 要点2], "children": [{"title": 子标题, "key_points": [...], "children": [...]}]}\n' +
  '要求：层级不超过 3 层；每个 key_points 2-5 条、每条 20 字以内；无内容的节点省略 children。\n\n课件文本：\n{{text}}'

export const DEFAULT_AI_CONFIG = {
  enabled: false,
  base_url: 'https://api.deepseek.com',
  api_key: '',
  model: 'deepseek-chat',
  max_tokens: 4096,
  prompt_template: DEFAULT_PROMPT,
}

function normPoints(points) {
  if (!Array.isArray(points)) return []
  const out = []
  for (const p of points) {
    const s = String(p).trim()
    if (s && !out.includes(s)) out.push(s.slice(0, 60))
  }
  return out.slice(0, 5)
}

/** 把任意 JSON 归一化为标准知识点树；深度上限 MAX_DEPTH */
export function normalizeKnowledge(data, depth = 0) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { title: '知识点', key_points: [], children: [] }
  }
  const node = {
    title: String(data.title || '知识点').slice(0, 60),
    key_points: normPoints(data.key_points),
    children: [],
  }
  const children = data.children
  if (Array.isArray(children) && depth + 1 < MAX_DEPTH) {
    for (const c of children.slice(0, 20)) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        node.children.push(normalizeKnowledge(c, depth + 1))
      }
    }
  }
  return node
}

/** 容忍 ```json 包裹与前后噪声 */
export function parseJsonContent(content) {
  if (!content) return null
  let text = String(content).trim()
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) text = m[1].trim()
  try {
    return JSON.parse(text)
  } catch (e) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch (e2) {
        return null
      }
    }
    return null
  }
}

/**
 * 调用 OpenAI 兼容接口提取知识点；任何失败返回 null（由上层降级到本地规则）。
 * 手机端直接在 App 内请求第三方接口（需用户自备 API Key）。
 */
export async function llmExtract(text, cfg, fetchImpl) {
  const conf = { ...DEFAULT_AI_CONFIG, ...(cfg || {}) }
  if (!conf.enabled || !conf.api_key) return null

  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) return null

  const template = conf.prompt_template || '{text}'
  const userText = template.replace('{{text}}', String(text || '').slice(0, MAX_TEXT_CHARS))
  const base = String(conf.base_url || DEFAULT_AI_CONFIG.base_url).replace(/\/+$/, '')

  const payload = {
    model: conf.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: '你只输出 JSON，不输出任何其他内容。' },
      { role: 'user', content: userText },
    ],
    temperature: 0.3,
    max_tokens: conf.max_tokens || 4096,
    response_format: { type: 'json_object' },
  }

  try {
    const resp = await doFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${conf.api_key}`,
      },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content
    const parsed = parseJsonContent(content)
    return parsed ? normalizeKnowledge(parsed) : null
  } catch (e) {
    return null
  }
}
