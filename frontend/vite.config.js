import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 说明：pdf.js 4 的产物含 top-level await，开发态（optimizeDeps/esbuild）与
// 生产构建都必须把目标提升到 esnext，否则会报
// "Top-level await is not available in the configured target environment"。
// 现代浏览器 / Capacitor Android WebView（89+）均支持。
const ESNEXT = 'esnext'

export default defineConfig({
  plugins: [vue()],
  esbuild: { target: ESNEXT },
  optimizeDeps: {
    esbuildOptions: { target: ESNEXT },
  },
  build: {
    target: ESNEXT,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
    watch: {
      // 忽略编辑器/工具写入的临时文件，以及打包产物目录，避免监听器崩溃
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.~*', '**/android/**'],
    },
  },
})
