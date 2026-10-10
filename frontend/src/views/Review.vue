<script setup>
import { computed, inject, onMounted, ref } from 'vue'
import { api } from '../api'
import { toast } from '../toast'

const refreshDue = inject('refreshDue', () => {})

const summary = ref(null)
const due = ref([])
const upcoming = ref([])
const progress = ref([])
const loading = ref(true)
const busyId = ref('')

/** 搜索与折叠状态 */
const keyword = ref('')
const collapsed = ref({})
const showAllProgress = ref(false)

const filteredDue = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return due.value
  return due.value.filter((i) =>
    `${i.title} ${i.path} ${i.filename} ${(i.key_points || []).join(' ')}`.toLowerCase().includes(kw)
  )
})

/** 待复习项按课件分组 */
const dueGroups = computed(() => {
  const map = new Map()
  for (const item of filteredDue.value) {
    const key = item.filename || '（未知来源）'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return [...map.entries()].map(([filename, items]) => ({
    filename,
    items,
    count: items.length,
    overdue: items.filter((i) => i.overdue_days > 0).length,
  }))
})

const visibleProgress = computed(() => (showAllProgress.value ? progress.value : progress.value.slice(0, 5)))

async function load(showSkeleton = false) {
  if (showSkeleton) loading.value = true
  try {
    const [s, d, u, p] = await Promise.all([
      api.reviewSummary(),
      api.reviewDue(),
      api.reviewUpcoming(7),
      api.reviewProgress(),
    ])
    summary.value = s
    due.value = d
    upcoming.value = u
    progress.value = p
  } catch (e) {
    toast.error(`加载复习数据失败：${e.message || e}`)
  } finally {
    loading.value = false
  }
}

function toggle(filename) {
  collapsed.value = { ...collapsed.value, [filename]: !collapsed.value[filename] }
}

async function complete(item) {
  busyId.value = item.id
  try {
    const r = await api.reviewComplete(item.id)
    toast.success(r.message)
    await load()
    refreshDue()
  } catch (e) {
    toast.error(`操作失败：${e.message || e}`)
  } finally {
    busyId.value = ''
  }
}

async function master(item) {
  busyId.value = item.id
  try {
    const r = await api.reviewMaster(item.id)
    toast.success(r.message)
    await load()
    refreshDue()
  } catch (e) {
    toast.error(`操作失败：${e.message || e}`)
  } finally {
    busyId.value = ''
  }
}

async function completeAll(row) {
  if (!confirm(`确认完成「${row.filename}」剩余 ${row.active} 个知识点的复习计划？此操作不可撤销。`)) return
  try {
    const r = await api.reviewCompleteAll(row.task_id)
    toast.success(`${row.filename}：${r.message}`)
    await load()
    refreshDue()
  } catch (e) {
    toast.error(`操作失败：${e.message || e}`)
  }
}

async function reset(item) {
  try {
    await api.reviewReset(item.id)
    toast.info(`${item.title}：已重置为待复习`)
    await load()
    refreshDue()
  } catch (e) {
    toast.error(`操作失败：${e.message || e}`)
  }
}

function stagePercent(item) {
  return Math.round(((item.stage || 0) / (item.max_stage || 6)) * 100)
}

onMounted(() => load(true))
</script>

<template>
  <div>
    <!-- 总览 -->
    <div class="card">
      <h2>复习计划</h2>
      <p class="muted">
        复习间隔 {{ summary ? summary.intervals_label : '1、2、4、7、15、30' }} 天；完成当前阶段后自动排入下一次，
        走完全部 {{ summary ? summary.intervals.length : 6 }} 次即标记为已掌握。
      </p>

      <div class="progress-block">
        <div class="progress-head">
          <strong>整体完成进度</strong>
          <strong class="progress-pct">{{ summary ? summary.progress_percent : 0 }}%</strong>
          <span class="muted">
            已掌握 {{ summary ? summary.mastered : 0 }} / {{ summary ? summary.total : 0 }} 个知识点 ·
            阶段完成度 {{ summary ? summary.stage_percent : 0 }}%
          </span>
        </div>
        <div class="progress">
          <div
            class="progress-bar"
            :class="{ done: summary && summary.total > 0 && summary.mastered === summary.total }"
            :style="{ width: (summary ? summary.progress_percent : 0) + '%' }"
          ></div>
        </div>
      </div>

      <div class="stat-row" style="margin-top: 14px">
        <div class="stat" :class="{ hot: summary && summary.due > 0 }">
          <div class="stat-num">{{ summary ? summary.due : '—' }}</div>
          <div class="stat-label">今天待复习</div>
        </div>
        <div class="stat">
          <div class="stat-num">{{ summary ? summary.active : '—' }}</div>
          <div class="stat-label">学习中</div>
        </div>
        <div class="stat">
          <div class="stat-num">{{ summary ? summary.upcoming_7d : '—' }}</div>
          <div class="stat-label">未来 7 天</div>
        </div>
        <div class="stat">
          <div class="stat-num">{{ summary ? summary.mastered : '—' }}</div>
          <div class="stat-label">已掌握</div>
        </div>
      </div>

      <div class="form-row" style="margin: 12px 0 0">
        <button class="action" :disabled="loading" @click="load(true)">
          {{ loading ? '刷新中…' : '刷新数据' }}
        </button>
      </div>
    </div>

    <!-- 今日待复习 -->
    <div class="card">
      <div class="form-row" style="margin-bottom: 8px">
        <h2 style="margin: 0">今天该复习的知识点（{{ filteredDue.length }}）</h2>
        <span style="flex: 1"></span>
        <input v-model="keyword" class="search" style="max-width: 240px" placeholder="搜索知识点 / 课件名" />
      </div>

      <div v-if="loading && !due.length" class="skeleton" style="height: 60px"></div>

      <div v-else-if="!due.length" class="empty">
        <span class="empty-icon">✅</span>
        当前没有到期的复习项。上传课件后系统会自动排入复习计划，首次复习在 1 天后。
      </div>

      <div v-else-if="!filteredDue.length" class="empty">
        <span class="empty-icon">🔍</span>
        没有匹配「{{ keyword }}」的复习项
      </div>

      <div v-else>
        <div v-for="group in dueGroups" :key="group.filename" class="group">
          <div class="group-head" :class="{ collapsed: collapsed[group.filename] }" @click="toggle(group.filename)">
            <span class="caret">▼</span>
            <strong>{{ group.filename }}</strong>
            <span class="tag">{{ group.count }} 项</span>
            <span v-if="group.overdue" class="tag tag-due">逾期 {{ group.overdue }}</span>
          </div>

          <div v-show="!collapsed[group.filename]" class="group-body">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="review-item"
              :class="{ overdue: item.overdue_days > 0 }"
            >
              <div class="form-row" style="margin-bottom: 6px">
                <strong>{{ item.title }}</strong>
                <span class="tag" :class="item.overdue_days > 0 ? 'tag-warn' : 'tag-due'">
                  {{ item.overdue_days > 0 ? `已逾期 ${item.overdue_days} 天` : '今天到期' }}
                </span>
                <span class="tag">第 {{ item.stage + 1 }}/{{ item.max_stage }} 次</span>
                <span class="tag" :class="item.retention < 60 ? 'tag-warn' : 'tag-ok'">
                  保持约 {{ item.retention }}%
                </span>
                <span style="flex: 1"></span>
                <button class="action" :disabled="busyId === item.id" @click="reset(item)">重置</button>
                <button
                  class="action"
                  :disabled="busyId === item.id"
                  title="直接完成该知识点的复习计划"
                  @click="master(item)"
                >
                  完成
                </button>
                <button class="action primary" :disabled="busyId === item.id" @click="complete(item)">
                  已复习
                </button>
              </div>

              <div class="progress slim">
                <div class="progress-bar" :style="{ width: stagePercent(item) + '%' }"></div>
              </div>

              <div class="muted" style="margin: 4px 0 0">{{ item.path }}</div>

              <ul v-if="item.key_points.length" class="review-points">
                <li v-for="(p, i) in item.key_points" :key="i">{{ p }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 各课件完成进度 -->
    <div class="card">
      <div class="form-row" style="margin-bottom: 4px">
        <h2 style="margin: 0">各课件完成进度</h2>
        <span style="flex: 1"></span>
        <button v-if="progress.length > 5" class="action" @click="showAllProgress = !showAllProgress">
          {{ showAllProgress ? '收起' : `展开全部（${progress.length}）` }}
        </button>
      </div>

      <div v-if="!progress.length" class="empty">
        <span class="empty-icon">📚</span>
        暂无复习计划，上传课件后自动生成
      </div>

      <div v-for="row in visibleProgress" :key="row.task_id" class="progress-row">
        <div class="form-row" style="margin-bottom: 6px">
          <strong>{{ row.filename }}</strong>
          <span class="tag">已掌握 {{ row.mastered }}/{{ row.total }}</span>
          <span v-if="row.due > 0" class="tag tag-due">待复习 {{ row.due }}</span>
          <span class="muted hide-mobile">阶段完成度 {{ row.stage_percent }}%</span>
          <span style="flex: 1"></span>
          <button
            v-if="row.active > 0"
            class="action"
            title="把该课件剩余知识点直接标记为已掌握"
            @click="completeAll(row)"
          >
            完成该计划
          </button>
          <span v-else class="tag tag-ok">✓ 已完成</span>
        </div>
        <div class="progress">
          <div class="progress-bar" :class="{ done: row.percent === 100 }" :style="{ width: row.percent + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- 未来安排 -->
    <div class="card">
      <h2>接下来的复习安排（未来 7 天）</h2>
      <div v-if="!upcoming.length" class="empty">
        <span class="empty-icon">🗓️</span>
        未来 7 天没有安排的复习
      </div>
      <div v-for="group in upcoming" :key="group.date" class="upcoming-group">
        <div class="form-row" style="margin-bottom: 4px">
          <strong>{{ group.label }}</strong>
          <span class="muted">{{ group.date }} · {{ group.count }} 项</span>
        </div>
        <ul class="review-points">
          <li v-for="it in group.items" :key="it.id">
            {{ it.title }}
            <span class="muted">（第 {{ it.stage + 1 }}/{{ it.max_stage }} 次 · 保持约 {{ it.retention }}%）</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
