<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { auth } from '../auth'
import { getApiBase, isNativeApp, setApiBase } from '../config'
import { isLocalMode, modeLabel, setMode } from '../mode'
import { toast } from '../toast'

/** 内置默认模板（用于「恢复默认」与状态判断，与后端 DEFAULT_CONFIG 一致） */
const DEFAULT_PROMPT =
  '你是一名学习笔记助手。请从下面的课件文本中提取结构化知识点，' +
  '严格按 JSON 树输出（不要输出任何解释或代码块标记）。\n' +
  '结构：{"title": 根标题, "key_points": [要点1, 要点2], "children": [{"title": 子标题, "key_points": [...], "children": [...]}]}\n' +
  '要求：层级不超过 3 层；每个 key_points 2-5 条、每条 20 字以内；无内容的节点省略 children。\n\n课件文本：\n{{text}}'

const form = ref({
  enabled: false,
  base_url: 'https://api.deepseek.com',
  api_key: '',
  model: 'deepseek-chat',
  max_tokens: 4096,
  prompt_template: '',
})
const savedMsg = ref('')
const error = ref('')
/** 提示词模板默认隐藏，收进「高级设置」 */
const showPrompt = ref(false)

/** 占位符字面量（避免模板里直接写双花括号被当作插值） */
const PLACEHOLDER_TOKEN = '{{text}}'

// —— 连接设置（手机 App / 局域网访问）——
const serverInput = ref(getApiBase())
const testing = ref(false)
const testResult = ref('')
const native = isNativeApp()

function saveServer() {
  const v = setApiBase(serverInput.value)
  serverInput.value = v
  testResult.value = ''
  toast.success(v ? `服务器地址已保存：${v}` : '已切回同源访问')
}

async function testConnection() {
  testing.value = true
  testResult.value = ''
  try {
    await api.authStatus()
    testResult.value = '连接成功'
    toast.success('连接成功')
  } catch (e) {
    testResult.value = `连接失败：${e.message || e}`
    toast.error(testResult.value)
  } finally {
    testing.value = false
  }
}

/* ---------------- 运行模式 ---------------- */
const localName = ref(auth.user?.display_name || '本机用户')
const backupMsg = ref('')
const fileInput = ref(null)

async function switchMode(next) {
  const toLocal = next === 'local'
  const tip = toLocal
    ? '切换到「本机独立」模式？数据将保存在本机，与电脑后端的数据相互独立。'
    : '切换到「连接电脑后端」模式？需要电脑后端在运行（手机需填局域网地址）。'
  if (!confirm(tip)) return
  setMode(next)
  toast.success(`已切换到「${modeLabel()}」`)
  setTimeout(() => location.reload(), 400)
}

async function saveLocalName() {
  try {
    await api.updateProfile({ display_name: localName.value.trim() || '本机用户' })
    auth.user = await api.me()
    toast.success('名称已保存')
  } catch (e) {
    toast.error(`保存失败：${e.message || e}`)
  }
}

async function exportBackup() {
  try {
    const data = await api.exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.download = `ai-notes-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.href = URL.createObjectURL(blob)
    a.click()
    URL.revokeObjectURL(a.href)
    backupMsg.value = `已导出：任务 ${data.tasks.length} 条、复习项 ${data.reviews.length} 条`
    toast.success('备份已导出')
  } catch (e) {
    backupMsg.value = `导出失败：${e.message || e}`
    toast.error(backupMsg.value)
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const payload = JSON.parse(await file.text())
    const r = await api.importAll(payload)
    backupMsg.value = `已导入：任务 ${r.tasks} 条、复习项 ${r.reviews} 条`
    toast.success('备份已导入')
  } catch (e) {
    backupMsg.value = `导入失败：${e.message || e}`
    toast.error(backupMsg.value)
  }
}

/** 状态提示：是否已自定义提示词（忽略空白差异） */
const promptState = computed(() => {
  const norm = (s) => (s || '').replace(/\s+/g, '')
  const text = (form.value.prompt_template || '').trim()
  if (!text || norm(text) === norm(DEFAULT_PROMPT)) return '使用内置默认模板'
  return `已自定义（${text.length} 字）`
})

function resetPrompt() {
  form.value.prompt_template = DEFAULT_PROMPT
}

async function load() {
  try {
    const s = await api.getSettings()
    form.value = {
      enabled: s.enabled,
      base_url: s.base_url,
      api_key: '',
      model: s.model,
      max_tokens: s.max_tokens,
      prompt_template: s.prompt_template,
    }
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function save() {
  savedMsg.value = ''
  try {
    await api.saveSettings({
      enabled: form.value.enabled,
      base_url: form.value.base_url,
      api_key: form.value.api_key,
      model: form.value.model,
      max_tokens: Number(form.value.max_tokens) || 4096,
      // 未展开时沿用已加载的模板，不会被清空
      prompt_template: form.value.prompt_template,
    })
    form.value.api_key = '' // 不回填 Key
    savedMsg.value = '已保存（Key 不回显，留空表示保持原值）'
    toast.success('配置已保存')
  } catch (e) {
    error.value = String(e.message || e)
    toast.error(`保存失败：${error.value}`)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card">
      <h2>运行模式</h2>
      <div class="form-row">
        <span class="muted">当前：</span>
        <strong>{{ modeLabel() }}</strong>
        <span class="tag">{{ native ? '手机 App' : '浏览器' }}</span>
        <span style="flex: 1"></span>
        <button v-if="isLocalMode()" class="action" @click="switchMode('server')">切换到「连接电脑后端」</button>
        <button v-else class="action" @click="switchMode('local')">切换到「本机独立」</button>
      </div>

      <template v-if="isLocalMode()">
        <p class="muted">
          本机独立模式：解析、提取、复习排程全部在设备内完成，数据保存在本机（IndexedDB），无需电脑。
        </p>
        <div class="form-row">
          <span class="muted">本机用户：</span>
          <input v-model="localName" style="max-width: 220px" placeholder="显示名称" />
          <button class="action" @click="saveLocalName">保存名称</button>
        </div>
        <div class="form-row">
          <button class="action" @click="exportBackup">导出数据备份（JSON）</button>
          <button class="action" @click="fileInput && fileInput.click()">导入备份</button>
          <input ref="fileInput" type="file" accept=".json" style="display: none" @change="importBackup" />
          <span v-if="backupMsg" class="muted">{{ backupMsg }}</span>
        </div>
        <p class="muted">备份包含任务、知识点、复习计划与 AI 配置；换机或重装前建议导出。</p>
      </template>

      <template v-else>
        <div class="form-row">
          <span class="muted">当前账号：</span>
          <strong>{{ auth.user ? (auth.user.display_name || auth.user.username) : '（未登录）' }}</strong>
          <span class="muted">@{{ auth.user ? auth.user.username : '-' }}</span>
        </div>
        <div class="form-row">
          <label style="width: 120px">服务器地址：</label>
          <input v-model="serverInput" style="flex: 1; min-width: 200px" placeholder="留空 = 同源访问（如 http://192.168.1.5:8000）" />
          <button class="action" @click="saveServer">保存</button>
          <button class="action" :disabled="testing" @click="testConnection">{{ testing ? '测试中…' : '测试连接' }}</button>
          <span v-if="testResult" class="muted">{{ testResult }}</span>
        </div>
        <p class="muted">
          手机 App 需填写运行后端的电脑局域网地址（同一 Wi-Fi，端口 8000）；浏览器访问留空即可。
        </p>
      </template>
    </div>

    <div class="card">
      <h2>AI 提取配置</h2>
      <p class="muted">不启用或未填 Key 时，系统自动使用本地规则兜底提取（答辩断网可演示）。</p>

      <div class="form-row">
        <label><input type="checkbox" v-model="form.enabled" /> 启用 LLM 提取</label>
      </div>

      <div class="form-row">
        <label style="width: 120px">接口地址：</label>
        <input v-model="form.base_url" style="flex: 1" placeholder="https://api.deepseek.com" />
      </div>
      <div class="form-row">
        <label style="width: 120px">API Key：</label>
        <input v-model="form.api_key" style="flex: 1" placeholder="留空表示保持原值" />
      </div>
      <div class="form-row">
        <label style="width: 120px">模型：</label>
        <input v-model="form.model" style="flex: 1" placeholder="deepseek-chat" />
      </div>
      <div class="form-row">
        <label style="width: 120px">Max Tokens：</label>
        <input v-model.number="form.max_tokens" type="number" style="width: 120px" />
      </div>

      <!-- 提示词模板：默认隐藏，收进高级设置 -->
      <div class="advanced-row">
        <button class="action" @click="showPrompt = !showPrompt">
          {{ showPrompt ? '收起' : '展开' }}高级设置
        </button>
        <span class="muted">提示词模板：{{ promptState }}</span>
      </div>

      <template v-if="showPrompt">
        <h3>提示词模板（留空使用内置默认）</h3>
        <textarea
          v-model="form.prompt_template"
          rows="6"
          style="width: 100%"
          placeholder="留空使用内置默认模板；{{ text }} 为课件文本占位符"
        ></textarea>
        <div class="form-row" style="margin-top: 8px">
          <button class="action" @click="resetPrompt">填入内置默认模板</button>
          <span class="muted"><code>{{ PLACEHOLDER_TOKEN }}</code> 为课件文本占位符</span>
        </div>
      </template>

      <div class="form-row" style="margin-top: 12px">
        <button class="action primary" @click="save">保存配置</button>
        <span v-if="savedMsg" class="saved">{{ savedMsg }}</span>
      </div>
    </div>
  </div>
</template>

