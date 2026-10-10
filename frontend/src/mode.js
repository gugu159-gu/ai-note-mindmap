/** 运行模式：本机独立（local）或连接电脑后端（server）
 *
 * - 原生 App（Capacitor）默认「本机独立」：解析/提取/复习排程全部在手机内完成，数据存 IndexedDB
 * - 浏览器访问默认「连接后端」：走后端 REST + SQLite（也可手动切到本机模式）
 */
import { reactive } from 'vue'
import { isNativeApp } from './config'

const MODE_KEY = 'ai_notes_mode'

export const MODE_LOCAL = 'local'
export const MODE_SERVER = 'server'

function readStoredMode() {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === MODE_LOCAL || v === MODE_SERVER) return v
  } catch (e) { /* ignore */ }
  return null
}

export const mode = reactive({
  current: readStoredMode() || (isNativeApp() ? MODE_LOCAL : MODE_SERVER),
  chosen: !!readStoredMode(),
})

export function getMode() {
  return mode.current
}

export function isLocalMode() {
  return mode.current === MODE_LOCAL
}

export function isServerMode() {
  return mode.current === MODE_SERVER
}

export function hasChosenMode() {
  return mode.chosen
}

export function setMode(next) {
  if (next !== MODE_LOCAL && next !== MODE_SERVER) return
  mode.current = next
  mode.chosen = true
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch (e) { /* ignore */ }
}

/** 清除模式选择，回到「使用方式选择」页（登录页可用它兜底，避免连不上后端时卡死） */
export function resetMode() {
  mode.chosen = false
  try {
    localStorage.removeItem(MODE_KEY)
  } catch (e) { /* ignore */ }
}

export function modeLabel() {
  return isLocalMode() ? '本机独立' : '连接后端'
}
