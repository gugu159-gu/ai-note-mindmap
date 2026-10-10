import { computed, reactive } from 'vue'
import { api } from './api'
import { getToken, setToken } from './config'
import { isLocalMode } from './mode'

/** 全局登录状态（本机独立模式下代表「本机档案」，无需登录） */
export const auth = reactive({
  user: null,
  ready: false,   // 是否已完成首次身份探测（避免首屏闪一下登录页）
})

export const isLoggedIn = computed(() => !!auth.user)

export const userInitial = computed(() => {
  const name = auth.user?.display_name || auth.user?.username || '?'
  return name.trim().charAt(0).toUpperCase()
})

/** 应用启动时探测身份：本机模式取本地档案；后端模式用 Cookie/token 恢复会话 */
export async function bootstrapAuth() {
  auth.ready = false
  try {
    auth.user = await api.me()
  } catch (e) {
    if (!isLocalMode() && !getToken()) auth.user = null
    if (isLocalMode()) auth.user = null
  } finally {
    auth.ready = true
  }
}

function applySession(user) {
  // 后端在登录/注册响应里带回会话 token：手机 App 用它做 Bearer 鉴权
  if (user?.token) setToken(user.token)
  auth.user = user
  auth.ready = true
  return user
}

export async function login(username, password) {
  return applySession(await api.login({ username, password }))
}

export async function register({ username, password, display_name }) {
  return applySession(await api.register({ username, password, display_name }))
}

export async function logout() {
  try {
    await api.logout()
  } finally {
    setToken('')
    auth.user = null
  }
}

/** 会话失效（后端返回 401）时清理本地状态 */
export function handleExpired() {
  setToken('')
  auth.user = null
}
