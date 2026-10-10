/**
 * 真机 OCR 性能微基准（用 tools/cdp-eval.mjs 执行）。
 *
 * 造一张 3024×2016（约 12MP，模拟手机拍摄的课件照片）的中文测试图，对比三条路径：
 *   A 全分辨率 base64 直传原生（优化前行为）
 *   B 先 canvas 缩放 ≤1600 再传（当前实现）
 *   C createImageBitmap(resizeWidth) 解码期直接降采样（候选优化）
 *
 * 三条路径按轮次交错执行、各跑 3 轮，避免“先跑的热、后跑的凉”把结论带偏；
 * 输出每轮原始数值 + 最大值（最保守口径），并记录送原生的图片真实尺寸。
 */
(async () => {
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MlkitOcr
  if (!plugin) return { error: 'MlkitOcr 插件不可用（需在原生 App 内、本机模式下运行）' }

  const W = 3024
  const H = 2016
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f6f5ef'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#141414'
  ctx.font = 'bold 112px sans-serif'
  const lines = [
    '第三章 神经网络基础',
    '一、感知机模型',
    '二、反向传播算法',
    '三、梯度下降优化',
    '四、过拟合与正则化',
    '五、卷积神经网络',
    '六、循环神经网络',
    '七、注意力机制',
    '八、Transformer 架构',
    '九、预训练与微调',
    '十、模型评估指标',
  ]
  lines.forEach((t, i) => ctx.fillText(t, 150, 250 + i * 155))

  const jpeg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
  const kb = (s) => Math.round(s.length / 1024)

  // 三条路径各自「造待识别图」+ 送原生识别
  const paths = {
    A: {
      note: '全分辨率直传（优化前）',
      make: async () => ({ url: canvas.toDataURL('image/jpeg', 0.92), size: `${W}×${H}`, preMs: 0 }),
    },
    B: {
      note: 'canvas 缩放 1600（当前实现）',
      make: async () => {
        const t = performance.now()
        const bmp = await createImageBitmap(jpeg)
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas')
        c.width = Math.round(bmp.width * s)
        c.height = Math.round(bmp.height * s)
        const x = c.getContext('2d')
        x.imageSmoothingEnabled = true
        x.imageSmoothingQuality = 'high'
        x.drawImage(bmp, 0, 0, c.width, c.height)
        bmp.close && bmp.close()
        const preMs = Math.round(performance.now() - t)
        return { url: c.toDataURL('image/jpeg', 0.85), size: `${c.width}×${c.height}`, preMs }
      },
    },
    C: {
      note: '解码期降采样（候选优化）',
      make: async () => {
        const t = performance.now()
        const bmp = await createImageBitmap(jpeg, { resizeWidth: 1600, resizeQuality: 'high' })
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d').drawImage(bmp, 0, 0)
        bmp.close && bmp.close()
        const preMs = Math.round(performance.now() - t)
        return { url: c.toDataURL('image/jpeg', 0.85), size: `${c.width}×${c.height}`, preMs }
      },
    },
  }

  const rounds = 3
  const acc = { A: [], B: [], C: [] }
  for (let r = 0; r < rounds; r++) {
    for (const key of ['A', 'B', 'C']) {
      const made = await paths[key].make()
      const t0 = performance.now()
      const out = await plugin.recognize({ image: made.url })
      const jsMs = Math.round(performance.now() - t0)
      const text = String((out && out.text) || '')
      acc[key].push({
        轮次: r + 1,
        尺寸: made.size,
        base64KB: kb(made.url),
        预处理ms: made.preMs,
        原生解码ms: out.decodeMs,
        原生推理ms: out.totalMs - out.decodeMs,
        桥接与JSms: jsMs - out.totalMs,
        单轮总计ms: made.preMs + jsMs,
        文字数: text.length,
        首行: text.split('\n').filter(Boolean)[0] || '',
      })
    }
  }

  const summary = Object.entries(acc).map(([key, rows]) => {
    const totals = rows.map((r) => r.单轮总计ms)
    const infer = rows.map((r) => r.原生推理ms)
    return {
      路径: `${key} ${paths[key].note}`,
      尺寸: rows[0].尺寸,
      base64KB: rows[0].base64KB,
      总耗时_各轮: totals.join(' / '),
      总耗时_最差: Math.max(...totals),
      推理_各轮: infer.join(' / '),
      识别字数: rows.map((r) => r.文字数).join(' / '),
    }
  })

  return { 测法: `每条路径 ${rounds} 轮交错执行，12MP JPEG q0.92 测试图`, 汇总: summary, 明细: acc }
})()
