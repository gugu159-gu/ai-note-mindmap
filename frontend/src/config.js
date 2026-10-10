/** 客户端运行时配置：后端地址与会话 token
 *
 * - 浏览器访问（Vite/同源）：默认留空，走同源 /api（由 vite 代理到后端），用 Cookie 会话
 * - 手机 App / 局域网访问：后端地址形如 http://192.168.1.5:8000，凭 Bearer token 鉴权
 */

const BASE_KEY = 'ai_notes_api_base'
const TOKEN_KEY = 'ai_notes_token'

/** 后端根地址（末尾不带 /），空串表示同源 */
export function getApiBase() {
  try {
    return localStorage.getItem(BASE_KEY) || ''
  } catch (e) {
    return ''
  }
}

export function setApiBase(value) {
  const v = String(value || '').trim().replace(/\/+$/, '')
  try {
    if (v) localStorage.setItem(BASE_KEY, v)
    else localStorage.removeItem(BASE_KEY)
  } catch (e) {
    /* 隐私模式下忽略 */
  }
  return v
}

/** 会话 token（手机 App 用） */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch (e) {
    /* 忽略 */
  }
}

/** 是否运行在 Capacitor 原生壳里 */
export function isNativeApp() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform())
}

/** 拼接完整请求地址 */
export function apiUrl(path) {
  return `${getApiBase()}/api${path}`
}
