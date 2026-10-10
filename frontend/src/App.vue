<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { api, AUTH_EXPIRED_EVENT } from './api'
import { auth, bootstrapAuth, handleExpired, logout, userInitial } from './auth'
import { mlkitWarmup } from './core/parse.js'
import { hasChosenMode, isLocalMode, mode, modeLabel, setMode } from './mode'
import { toast, toastState } from './toast'
import Convert from './views/Convert.vue'
import History from './views/History.vue'
import Login from './views/Login.vue'
import Review from './views/Review.vue'
import Settings from './views/Settings.vue'
import Welcome from './views/Welcome.vue'

const tabs = [
  { key: 'convert', label: '转换', icon: '📄', desc: '上传课件 / 拍照，自动解析并生成思维导图' },
  { key: 'review', label: '复习', icon: '📅', desc: '按遗忘曲线排布的知识点复习计划与完成进度' },
  { key: 'history', label: '历史', icon: '🕘', desc: '历史任务、复看导图与逐份课件进度' },
  { key: 'settings', label: '设置', icon: '⚙️', desc: '运行模式、AI 接口与提示词配置' },
]
const VALID_KEYS = tabs.map((t) => t.key)
const components = { convert: Convert, review: Review, history: History, settings: Settings }

const current = ref('convert')
const currentTab = computed(() => tabs.find((t) => t.key === current.value) || tabs[0])

/** 顶部「复习」角标 */
const dueCount = ref(0)
let dueTimer = null

async function refreshDue() {
  if (!auth.user) {
    dueCount.value = 0
    return
  }
  try {
    const s = await api.reviewSummary()
    dueCount.value = s.due || 0
  } catch (e) {
    // 静默失败，不打扰主流程
  }
}

provide('refreshDue', refreshDue)
provide('modeLabel', modeLabel)

/** 地址栏 hash 路由：#review 等 */
function syncFromHash() {
  const key = (location.hash || '').replace(/^#\/?/, '')
  if (VALID_KEYS.includes(key)) current.value = key
}

/** 切页回到顶部：否则新页面会沿用上一个页面的滚动位置，打开时停在半中间 */
function scrollTop() {
  try { window.scrollTo({ top: 0, behavior: 'auto' }) } catch (e) { window.scrollTo(0, 0) }
}

function go(key) {
  current.value = key
  if (location.hash !== `#${key}`) location.hash = key
  scrollTop()
  refreshDue()
}

async function doLogout() {
  if (isLocalMode()) {
    // 本机模式没有账号，可退出到「模式选择」
    if (!confirm('退出本机模式并回到使用方式选择？本机数据不会被删除。')) return
    location.hash = ''
    mode.chosen = false
    try { localStorage.removeItem('ai_notes_mode') } catch (e) { /* ignore */ }
    return
  }
  if (!confirm('确认退出登录？')) return
  await logout()
  dueCount.value = 0
  if (location.hash) location.hash = ''
  toast.info('已退出登录')
}

function onExpired() {
  if (!isLocalMode() && auth.user) {
    handleExpired()
    toast.error('登录已过期，请重新登录')
  }
}

async function onReady() {
  await bootstrapAuth()
  if (auth.user) {
    syncFromHash()
    refreshDue()
    if (!dueTimer) dueTimer = setInterval(refreshDue, 60000)
  }
}

async function onModeChosen() {
  toast.success(`已切换到「${modeLabel()}」模式`)
  if (isLocalMode()) mlkitWarmup()
  await onReady()
}

onMounted(async () => {
  window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
  window.addEventListener('hashchange', syncFromHash)
  // 本机模式：提前初始化 ML Kit 识别器，避免首次拍照时现加载模型
  if (isLocalMode()) mlkitWarmup()
  if (hasChosenMode()) await onReady()
  else auth.ready = true
})

onBeforeUnmount(() => {
  dueTimer && clearInterval(dueTimer)
  window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  window.removeEventListener('hashchange', syncFromHash)
})
</script>

<template>
  <!-- 首次使用：选择运行方式 -->
  <Welcome v-if="auth.ready && !mode.chosen" @chosen="onModeChosen" />

  <!-- 启动探测中 -->
  <div v-else-if="!auth.ready" class="boot">
    <span class="spinner"></span>正在加载…
  </div>

  <!-- 后端模式且未登录 -->
  <Login v-else-if="!isLocalMode() && !auth.user" @success="onReady" />

  <!-- 应用外壳（本机模式无需登录） -->
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-logo">📚</span>
        <span class="brand-name">AI 笔记工具</span>
      </div>

      <nav class="side-nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          :data-icon="t.icon"
          :class="{ active: current === t.key }"
          @click="go(t.key)"
        >
          <span class="nav-icon">{{ t.icon }}</span>
          <span class="nav-label">{{ t.label }}</span>
          <span v-if="t.key === 'review' && dueCount > 0" class="badge">{{ dueCount }}</span>
        </button>
      </nav>

      <div class="side-user">
        <div class="avatar">{{ userInitial }}</div>
        <div class="user-meta">
          <strong>{{ auth.user ? (auth.user.display_name || auth.user.username) : '本机用户' }}</strong>
          <span class="muted">{{ modeLabel() }}</span>
        </div>
        <button class="action icon-btn" :title="isLocalMode() ? '切换使用方式' : '退出登录'" @click="doLogout">
          {{ isLocalMode() ? '切换' : '退出' }}
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="page-head">
        <div class="page-title">
          <h1>{{ currentTab.label }}</h1>
          <p class="muted hide-mobile">{{ currentTab.desc }}</p>
        </div>
        <div class="head-user only-mobile">
          <span class="tag">{{ modeLabel() }}</span>
          <div class="avatar small">{{ userInitial }}</div>
          <button class="action icon-btn" @click="doLogout">{{ isLocalMode() ? '切换' : '退出' }}</button>
        </div>
      </header>

      <main class="content">
        <component :is="components[current]" @navigate="go" />
      </main>
    </div>

    <!-- 全局轻提示 -->
    <div class="toast-host">
      <div
        v-for="t in toastState.items"
        :key="t.id"
        class="toast"
        :class="t.type"
        title="点击关闭"
        @click="toast.remove(t.id)"
      >
        {{ t.text }}
      </div>
    </div>
  </div>
</template>
