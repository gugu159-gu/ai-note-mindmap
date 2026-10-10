/**
 * 真机调试小工具：通过 Chrome DevTools Protocol 在 App 的 WebView 里执行一段 JS 并取回结果。
 *
 * 用途：在真机上量化 OCR（ML Kit）各阶段耗时、验证性能优化效果，而不需要改 App 代码。
 *
 * 前置：
 *   1. adb shell cat /proc/net/unix | grep webview_devtools_remote   # 拿到 socket（数字=App pid）
 *   2. adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * 用法：
 *   node tools/cdp-eval.mjs <表达式文件.js>        # 文件内容应是一个 async IIFE 表达式
 *   node tools/cdp-eval.mjs --discover             # 只打印当前页面目标的 ws 地址
 */

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1:9222'
const TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS || 120000)

async function listTargets() {
  const res = await fetch(`http://${CDP_HOST}/json/list`)
  return await res.json()
}

async function main() {
  const [arg] = process.argv.slice(2)
  if (!arg) {
    console.error('用法：node tools/cdp-eval.mjs <表达式文件.js> | --discover')
    process.exit(2)
  }

  const targets = await listTargets()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('没有找到 page 目标，请确认 App 正在运行且 WebView 调试已开启')
  if (arg === '--discover') {
    console.log(JSON.stringify({ title: page.title, url: page.url, ws: page.webSocketDebuggerUrl }, null, 2))
    return
  }

  const { readFileSync } = await import('node:fs')
  const expression = readFileSync(arg, 'utf8')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  const timer = setTimeout(() => {
    console.error(`超时（${TIMEOUT_MS}ms）`)
    process.exit(1)
  }, TIMEOUT_MS)

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (text) console.log(`[page:${msg.params.type}] ${text}`)
    }
  })

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
  })

  await send('Runtime.enable')
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true,
  })

  clearTimeout(timer)
  ws.close()

  if (result.exceptionDetails) {
    console.error('页面内异常：', JSON.stringify(result.exceptionDetails, null, 2))
    process.exit(1)
  }
  const value = result.result && result.result.value
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
