import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  // 防止 Vite 在 Tauri 打开时清屏
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
