import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  plugins: [vue()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  clearScreen: false,

  server: {
    // Tauri 要求严格端口
    port: 5173,
    strictPort: true,
    // 允许 Tauri 访问开发服务器
    host: 'localhost',
  },

  // 环境变量前缀，Tauri 使用 TAURI_ 前缀
  envPrefix: ['VITE_', 'TAURI_'],
})
