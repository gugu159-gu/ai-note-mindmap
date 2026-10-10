<script setup>
import { isNativeApp } from '../config'
import { MODE_LOCAL, MODE_SERVER, setMode } from '../mode'

const emit = defineEmits(['chosen'])

function choose(next) {
  setMode(next)
  emit('chosen', next)
}
</script>

<template>
  <div class="welcome-page">
    <div class="welcome-head">
      <span class="auth-logo">📚</span>
      <h1>AI 笔记工具</h1>
      <p class="muted">选择使用方式（之后可在「设置」里随时切换）</p>
    </div>

    <div class="welcome-cards">
      <button class="welcome-card" @click="choose(MODE_LOCAL)">
        <span class="wc-icon">📱</span>
        <h2>本机独立使用<span v-if="isNativeApp()" class="tag tag-ok">推荐</span></h2>
        <p>
          解析、知识点提取、复习排程全部在手机内完成，数据存在本机，<b>不需要电脑</b>。
        </p>
        <ul>
          <li>PDF / PPTX / 文本：完全离线可用</li>
          <li>拍照识别：首次使用需联网下载中文识别模型</li>
          <li>AI 提取：可填自己的 API Key；不填则用本地规则</li>
          <li>数据保存在本机（可在设置页导出备份）</li>
        </ul>
        <span class="wc-action">进入 →</span>
      </button>

      <button class="welcome-card" @click="choose(MODE_SERVER)">
        <span class="wc-icon">💻</span>
        <h2>连接电脑后端</h2>
        <p>
          数据存在电脑上的 SQLite，支持多设备共用同一份数据与账号体系。
        </p>
        <ul>
          <li>需要电脑运行后端并与手机同一 Wi‑Fi</li>
          <li>可使用电脑上配置好的 AI Key 与提示词</li>
          <li>账号隔离、数据集中管理</li>
          <li>适合电脑+手机同时使用的场景</li>
        </ul>
        <span class="wc-action">进入 →</span>
      </button>
    </div>

    <p class="muted welcome-foot">
      本机模式的数据保存在浏览器/App 的本地存储中（IndexedDB），删除应用数据会一并清除，建议定期导出备份。
    </p>
  </div>
</template>
