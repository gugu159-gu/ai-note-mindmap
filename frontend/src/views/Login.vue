<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { login, register } from '../auth'
import { getApiBase, isNativeApp, setApiBase } from '../config'
import { resetMode } from '../mode'
import { toast } from '../toast'

const emit = defineEmits(['success'])

const mode = ref('login')          // login | register
const username = ref('')
const password = ref('')
const password2 = ref('')
const displayName = ref('')
const loading = ref(false)
const error = ref('')
const hasUsers = ref(true)

// —— 服务器地址（手机 App / 局域网访问必填）——
const serverInput = ref(getApiBase())
const showServer = ref(isNativeApp() || !!getApiBase())
const testing = ref(false)
const testResult = ref('')
const native = isNativeApp()

const title = computed(() => (mode.value === 'login' ? '登录' : '创建账号'))
const submitText = computed(() => {
  if (loading.value) return '处理中…'
  return mode.value === 'login' ? '登录' : '注册并登录'
})

function switchMode(next) {
  mode.value = next
  error.value = ''
  password.value = ''
  password2.value = ''
}

/** 返回「使用方式选择」页（连不上后端时可改用本机独立模式） */
function backToModeSelect() {
  resetMode()
  toast.info('已返回使用方式选择')
}

function saveServer() {
  const v = setApiBase(serverInput.value)
  serverInput.value = v
  testResult.value = ''
  toast.success(v ? `服务器地址已保存：${v}` : '已切回本机同源地址')
}

async function testConnection() {
  testing.value = true
  testResult.value = ''
  const saved = getApiBase()
  setApiBase(serverInput.value)
  try {
    const s = await api.authStatus()
    testResult.value = s.has_users ? '连接成功（该服务器已有账号）' : '连接成功（该服务器还没有账号，可直接注册）'
    toast.success('连接成功')
  } catch (e) {
    testResult.value = `连接失败：${e.message || e}`
    toast.error(testResult.value)
  } finally {
    setApiBase(saved === serverInput.value ? saved : serverInput.value)
    testing.value = false
  }
}

async function submit() {
  error.value = ''
  if (!username.value.trim()) {
    error.value = '请输入用户名'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      error.value = '密码至少 6 位'
      return
    }
    if (password.value !== password2.value) {
      error.value = '两次输入的密码不一致'
      return
    }
  }

  loading.value = true
  try {
    const user =
      mode.value === 'login'
        ? await login(username.value.trim(), password.value)
        : await register({
            username: username.value.trim(),
            password: password.value,
            display_name: displayName.value.trim(),
          })
    const claimed = user.claimed_items || 0
    toast.success(
      claimed > 0
        ? `${mode.value === 'login' ? '登录成功' : '注册成功'}，已接管 ${claimed} 条历史数据`
        : `${mode.value === 'login' ? '登录成功' : '注册成功'}，欢迎 ${user.display_name || user.username}`
    )
    emit('success')
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!getApiBase() && !native) {
    try {
      const s = await api.authStatus()
      hasUsers.value = !!s.has_users
      if (!hasUsers.value) mode.value = 'register'   // 首次使用直接引导注册
    } catch (e) {
      // 后端未就绪时保持默认登录模式
    }
  }
})
</script>

<template>
  <div class="auth-page">
    <div class="auth-side">
      <div class="auth-brand">
        <span class="auth-logo">📚</span>
        <h1>AI 笔记工具</h1>
        <p>上传课件或拍照，自动提取知识点、生成可交互思维导图，<br />并按遗忘曲线安排复习计划。</p>
        <ul class="auth-points">
          <li>PDF / PPTX / 拍照 OCR 三类输入</li>
          <li>LLM 可配置，未配置时本地规则兜底</li>
          <li>知识点自动排入 1·2·4·7·15·30 天复习计划</li>
        </ul>
      </div>
    </div>

    <div class="auth-panel">
      <div class="auth-card">
        <div class="auth-tabs">
          <button :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
          <button :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
        </div>

        <h2>{{ title }}</h2>
        <p v-if="!hasUsers && mode === 'register'" class="muted">首次使用，请创建你的账号</p>
        <p v-else class="muted">使用账号登录以查看你的课件与复习计划</p>

        <form @submit.prevent="submit">
          <label class="field">
            <span>用户名</span>
            <input v-model="username" autocomplete="username" placeholder="字母、数字、下划线" />
          </label>

          <label v-if="mode === 'register'" class="field">
            <span>昵称（可选）</span>
            <input v-model="displayName" placeholder="显示在侧边栏的名字" />
          </label>

          <label class="field">
            <span>密码</span>
            <input
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              placeholder="至少 6 位"
            />
          </label>

          <label v-if="mode === 'register'" class="field">
            <span>确认密码</span>
            <input v-model="password2" type="password" autocomplete="new-password" placeholder="再输入一次" />
          </label>

          <p v-if="error" class="error">{{ error }}</p>

          <button class="action primary auth-submit" type="submit" :disabled="loading">
            {{ submitText }}
          </button>
        </form>

        <div class="server-box">
          <button class="link-btn" type="button" @click="showServer = !showServer">
            {{ showServer ? '收起' : '⚙' }} 服务器设置{{ getApiBase() ? `（当前：${getApiBase()}）` : '（默认本机）' }}
          </button>

          <div v-if="showServer" class="server-body">
            <label class="field">
              <span>后端地址</span>
              <input v-model="serverInput" placeholder="http://192.168.1.5:8000" />
            </label>
            <p class="muted">
              手机 App 需填写运行后端的电脑地址（同一 Wi-Fi 下用局域网 IP，端口 8000）；
              留空表示同源访问（浏览器方式）。
            </p>
            <div class="form-row">
              <button class="action" type="button" @click="saveServer">保存</button>
              <button class="action" type="button" :disabled="testing" @click="testConnection">
                {{ testing ? '测试中…' : '测试连接' }}
              </button>
            </div>
            <p v-if="testResult" class="muted">{{ testResult }}</p>
          </div>
        </div>

        <p class="muted auth-foot">
          {{ mode === 'login' ? '还没有账号？' : '已有账号？' }}
          <a href="#" @click.prevent="switchMode(mode === 'login' ? 'register' : 'login')">
            {{ mode === 'login' ? '注册一个' : '去登录' }}
          </a>
        </p>

        <!-- 兜底入口：连不上后端时可回到使用方式选择，改用本机独立模式 -->
        <p class="muted auth-foot" style="margin-top: 8px">
          <a href="#" @click.prevent="backToModeSelect">← 切换使用方式（本机独立 / 连接电脑后端）</a>
        </p>
      </div>
    </div>
  </div>
</template>
