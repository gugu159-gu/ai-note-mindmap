import { apiUrl, getToken } from './config'
import { localApi } from './local/api'
import { isLocalMode } from './mode'

/** 会话过期/未登录时广播，由 App.vue 监听并切回登录页 */
export const AUTH_EXPIRED_EVENT = 'auth:expired'

async function request(path, options = {}) {
  const { skipAuthRedirect = false, ...rest } = options
  const token = getToken()
  const headers = { ...(rest.headers || {}) }
  if (!(rest.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  // 手机 App / 跨设备访问用 Bearer token；浏览器同源访问仍靠 Cookie
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(apiUrl(path), {
    credentials: 'same-origin',   // 同源时自动带 Cookie
    ...rest,
    headers,
  })

  if (res.status === 401 && !skipAuthRedirect) {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function requestBlob(path) {
  const token = getToken()
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(apiUrl(path), { credentials: 'same-origin', headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return await res.blob()
}

const serverApi = {
  // —— 账号 ——
  authStatus: () => request('/auth/status', { skipAuthRedirect: true }),
  me: () => request('/auth/me', { skipAuthRedirect: true }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data), skipAuthRedirect: true }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data), skipAuthRedirect: true }),
  logout: () => request('/auth/logout', { method: 'POST', skipAuthRedirect: true }),

  /** 取原文件并转成可直接放进 <img> 的 objectURL（带鉴权请求） */
  taskFileUrl: async (id) => URL.createObjectURL(await requestBlob(`/tasks/${id}/file`)),

  // —— 课件 ——
  upload: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/upload', { method: 'POST', body: form })
  },
  listTasks: () => request('/tasks'),
  getTask: (id) => request(`/tasks/${id}`),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  getSettings: () => request('/settings'),
  saveSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // —— 复习排程 ——
  reviewSummary: () => request('/reviews/summary'),
  reviewDue: () => request('/reviews/due'),
  reviewUpcoming: (days = 7) => request(`/reviews/upcoming?days=${days}`),
  reviewProgress: () => request('/reviews/progress'),
  reviewList: (taskId) => request(taskId ? `/reviews?task_id=${taskId}` : '/reviews'),
  reviewComplete: (id) => request(`/reviews/${id}/complete`, { method: 'POST' }),
  reviewMaster: (id) => request(`/reviews/${id}/master`, { method: 'POST' }),
  reviewCompleteAll: (taskId) =>
    request(taskId ? `/reviews/complete-all?task_id=${taskId}` : '/reviews/complete-all', { method: 'POST' }),
  reviewReset: (id) => request(`/reviews/${id}/reset`, { method: 'POST' }),
  reviewDelete: (id) => request(`/reviews/${id}`, { method: 'DELETE' }),
}

/** 按当前运行模式选择实现：本机独立（IndexedDB + 端内引擎）或连接后端（REST） */
function impl() {
  return isLocalMode() ? localApi : serverApi
}

/** 页面统一使用的 API 门面（按需分发，切模式无需改动任何视图代码） */
export const api = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return (...args) => {
        const target = impl()
        const fn = target[prop]
        if (typeof fn !== 'function') {
          return Promise.reject(new Error(`当前模式下不支持的操作：${prop}`))
        }
        return fn.apply(target, args)
      }
    },
  }
)

