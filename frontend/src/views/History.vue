<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { toast } from '../toast'
import Mindmap from '../components/Mindmap.vue'

const PAGE_SIZE = 10

const tasks = ref([])
const progressMap = ref({})
const selected = ref(null)
const loading = ref(true)
const keyword = ref('')
const page = ref(1)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return tasks.value
  return tasks.value.filter((t) => (t.filename || '').toLowerCase().includes(kw))
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))

const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filtered.value.slice(start, start + PAGE_SIZE)
})

function progressOf(taskId) {
  return progressMap.value[taskId] || null
}

async function load() {
  loading.value = true
  try {
    const [list, progress] = await Promise.all([api.listTasks(), api.reviewProgress()])
    tasks.value = list
    const map = {}
    for (const row of progress) map[row.task_id] = row
    progressMap.value = map
    if (page.value > totalPages.value) page.value = totalPages.value
  } catch (e) {
    toast.error(`加载历史失败：${e.message || e}`)
  } finally {
    loading.value = false
  }
}

async function view(id) {
  try {
    selected.value = await api.getTask(id)
    // 移动端滚动到详情
    if (window.innerWidth <= 720) {
      requestAnimationFrame(() => {
        document.querySelector('.detail-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  } catch (e) {
    toast.error(`查看失败：${e.message || e}`)
  }
}

async function remove(id, filename) {
  if (!confirm(`删除「${filename}」？该课件的复习计划也会一并清除。`)) return
  try {
    const r = await api.deleteTask(id)
    if (selected.value?.id === id) selected.value = null
    toast.success(`已删除（同时清理 ${r.removed_review_items ?? 0} 个复习项）`)
    await load()
  } catch (e) {
    toast.error(`删除失败：${e.message || e}`)
  }
}

function downloadMarkdown(task) {
  if (!task?.outline) return
  const blob = new Blob([task.outline], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.download = (task.filename || 'note').replace(/\.[^.]+$/, '') + '.md'
  a.href = URL.createObjectURL(blob)
  a.click()
  URL.revokeObjectURL(a.href)
}

function onSearch() {
  page.value = 1
}

onMounted(load)
</script>

<template>
  <div>
    <div class="card">
      <div class="form-row" style="margin-bottom: 10px">
        <h2 style="margin: 0">历史任务（{{ filtered.length }}）</h2>
        <span style="flex: 1"></span>
        <input
          v-model="keyword"
          class="search"
          style="max-width: 240px"
          placeholder="按文件名搜索"
          @input="onSearch"
        />
        <button class="action" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>

      <div v-if="loading && !tasks.length" class="skeleton" style="height: 80px"></div>

      <div v-else-if="!tasks.length" class="empty">
        <span class="empty-icon">🕘</span>
        暂无历史记录，先去「转换」页上传一份课件
      </div>

      <div v-else-if="!filtered.length" class="empty">
        <span class="empty-icon">🔍</span>
        没有匹配「{{ keyword }}」的任务
      </div>

      <template v-else>
        <table class="table responsive">
          <thead>
            <tr>
              <th>文件</th>
              <th>类型</th>
              <th>状态</th>
              <th>复习进度</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in paged" :key="t.id">
              <td data-label="文件">{{ t.filename }}</td>
              <td data-label="类型">{{ t.file_type }}</td>
              <td data-label="状态">
                <span class="tag" :class="t.status === 'done' ? 'tag-ok' : 'tag-due'">
                  {{ t.status === 'done' ? '已完成' : '失败' }}
                </span>
              </td>
              <td data-label="复习进度">
                <template v-if="progressOf(t.id)">
                  <div class="progress slim" style="min-width: 90px">
                    <div
                      class="progress-bar"
                      :class="{ done: progressOf(t.id).percent === 100 }"
                      :style="{ width: progressOf(t.id).percent + '%' }"
                    ></div>
                  </div>
                  <span class="muted">{{ progressOf(t.id).mastered }}/{{ progressOf(t.id).total }}</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td data-label="时间">{{ t.created_at }}</td>
              <td data-label="操作">
                <button class="action" @click="view(t.id)">查看</button>
                <button class="action danger" @click="remove(t.id, t.filename)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="totalPages > 1" class="pager">
          <button class="action" :disabled="page <= 1" @click="page--">上一页</button>
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <button class="action" :disabled="page >= totalPages" @click="page++">下一页</button>
        </div>
      </template>
    </div>

    <div v-if="selected" class="card detail-anchor">
      <div class="form-row">
        <h2 style="margin: 0">{{ selected.filename }}</h2>
        <span class="muted">{{ selected.created_at }}</span>
        <span style="flex: 1"></span>
        <button class="action" @click="downloadMarkdown(selected)">导出 Markdown</button>
        <button class="action" @click="selected = null">关闭</button>
      </div>

      <p v-if="selected.status === 'error'" class="error">{{ selected.error }}</p>

      <Mindmap v-if="selected.status === 'done'" :outline="selected.outline" :filename="selected.filename" />

      <details v-if="selected.status === 'done'" style="margin-top: 10px">
        <summary class="muted" style="cursor: pointer">Markdown 大纲</summary>
        <pre class="pre-wrap" style="margin-top: 8px">{{ selected.outline }}</pre>
      </details>
    </div>
  </div>
</template>
