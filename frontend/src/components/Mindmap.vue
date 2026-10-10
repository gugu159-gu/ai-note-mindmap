<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'

const props = defineProps({
  outline: { type: String, default: '' },
  filename: { type: String, default: 'mindmap' },
})

const svgEl = ref(null)
let mm = null
const transformer = new Transformer()

/** 手机屏幕窄：限制节点文字最大宽度让长句折行，树变窄后 autoFit 的缩放比更大，文字才看得清 */
function nodeMaxWidth() {
  try {
    return window.innerWidth <= 720 ? 190 : 9999
  } catch (e) {
    return 9999
  }
}

function render() {
  if (!svgEl.value || !props.outline) return
  try {
    const { root } = transformer.transform(props.outline)
    if (mm) mm.destroy()
    mm = Markmap.create(svgEl.value, { autoFit: true, duration: 300, maxWidth: nodeMaxWidth() }, root)
  } catch (e) {
    console.error('markmap render error', e)
  }
}

/** 适应窗口 */
function fit() {
  try {
    mm && mm.fit()
  } catch (e) {
    console.error('markmap fit error', e)
  }
}

/** 缩放（factor > 1 放大，< 1 缩小） */
function rescale(factor) {
  try {
    mm && mm.rescale(factor)
  } catch (e) {
    console.error('markmap rescale error', e)
  }
}

/** 导出当前导图为 PNG（SVG → Canvas → PNG，2 倍分辨率白底） */
function exportPNG() {
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true)
  clone.setAttribute('width', String(rect.width))
  clone.setAttribute('height', String(rect.height))
  const xml = new XMLSerializer().serializeToString(clone)
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * 2))
    canvas.height = Math.max(1, Math.round(rect.height * 2))
    const ctx = canvas.getContext('2d')
    ctx.scale(2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.drawImage(img, 0, 0)
    const a = document.createElement('a')
    a.download = (props.filename || 'mindmap').replace(/\.[^.]+$/, '') + '-mindmap.png'
    a.href = canvas.toDataURL('image/png')
    a.click()
  }
  img.src = url
}

onMounted(render)
onBeforeUnmount(() => mm && mm.destroy())
watch(() => props.outline, render)

defineExpose({ exportPNG, fit })
</script>

<template>
  <div class="mindmap-wrap">
    <div class="mindmap-toolbar">
      <button class="mm-btn" title="适应窗口" @click="fit">适应</button>
      <button class="mm-btn" title="放大" @click="rescale(1.25)">＋</button>
      <button class="mm-btn" title="缩小" @click="rescale(0.8)">－</button>
    </div>
    <svg ref="svgEl"></svg>
  </div>
</template>
