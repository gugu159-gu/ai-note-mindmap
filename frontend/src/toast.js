import { reactive } from 'vue'

/** 全局轻提示状态（由 App.vue 渲染） */
export const toastState = reactive({ items: [] })

let seq = 0

function remove(id) {
  const index = toastState.items.findIndex((t) => t.id === id)
  if (index >= 0) toastState.items.splice(index, 1)
}

function push(text, type = 'info', timeout = 2600) {
  const id = ++seq
  toastState.items.push({ id, text: String(text), type })
  if (timeout > 0) setTimeout(() => remove(id), timeout)
  return id
}

export const toast = {
  info: (text, ms) => push(text, 'info', ms),
  success: (text, ms) => push(text, 'success', ms),
  error: (text, ms) => push(text, 'error', ms === undefined ? 4200 : ms),
  remove,
}
