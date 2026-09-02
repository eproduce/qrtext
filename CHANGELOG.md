# 版本变更

































## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-02)

- 自动构建 (Electron)

## 1.0.3 (2026-09-01)

- 自动构建 (Electron)

## 1.0.3 (2026-08-24)

- 自动构建 (Electron)

## 1.0.3 (2026-08-24)

- 自动构建 (Electron)

## 1.0.3 (2026-08-18)

- 自动构建 (Electron)

## 1.0.3 (2026-08-18)

- 自动构建 (Electron)

## 1.0.3 (2026-08-15)

- 自动构建 (Electron)

## 1.0.3 (2026-08-14)

- 自动构建 (Electron)

## 1.0.3 (2026-08-13)

- 自动构建 (Electron)

## 1.0.3 (2026-08-13)

- 自动构建 (Electron)

## 1.0.3 (2026-08-13)

- 自动构建 (Electron)

## 1.0.3 (2026-08-13)

- 自动构建 (Electron)

## 1.0.3 (2026-08-13)

- 自动构建 (Electron)

## 1.0.3 (2026-08-12)

- 自动构建 (Electron)

## 1.0.3 (2026-08-12)

- 自动构建 (Electron)

## 1.0.3 (2026-08-12)

- 自动构建 (Electron)

## 1.0.3 (2026-08-12)

- 自动构建 (Electron)

## 1.0.3 (2026-08-12)

- 自动构建 (Electron)

## 1.0.3 (2026-08-06)

- 自动构建 (Electron)

## 1.0.3 (2026-08-03)

- 自动构建 (Electron)

## 1.0.3 (2026-07-31)

- 自动构建 (Electron)

## 1.0.3 (2026-07-27)

- 自动构建 (Electron)

## 1.0.3 (2026-07-27)

- 自动构建 (Electron)

## 1.0.3 (2026-07-27)

- 自动构建 (Electron)

## 1.0.3 (2026-07-27)

- 自动构建 (Electron)

## 1.0.3 (2026-07-27)

### 🚀 重大迁移：Tauri 2 → Electron 34

彻底解决以下兼容性问题：
- **麒麟 V10 SP1 / 国产 Linux**：不再依赖系统 webkit2gtk、glibc、libstdc++ 版本
- **AppImage 打包**：无需 FUSE、squashfs 手动修补、linuxdeploy 等复杂工具链
- **Windows 7**：Electron 自带 Chromium，不受 WebView2 版本限制
- **构建环境**：只需 Node.js，不再需要 Rust / Docker / 系统 GUI 库

技术变更：
- 删除 `src-tauri/`（Rust 后端、Tauri 配置、Cargo 依赖）
- 新增 `electron/main.cjs`（主进程：菜单、截图、浮窗、剪贴板）
- 新增 `electron/preload.cjs`（安全的 IPC 桥接）
- 前端 IPC 迁移：`invoke()` → `window.electronAPI.xxx()`
- 打包方案：`electron-builder` 统一处理 deb/rpm/AppImage/dmg/nsis
- CI 简化：矩阵构建（ubuntu/macos/windows），无需 matrix 分平台特殊处理

### 修复

- AppRun 不捆绑 ld-linux，改用系统 ld-linux + 完整 GTK/WebKit 环境变量
- AppRun 增加 APPDIR 自动检测，兼容直接提取运行

## 1.0.2 (2026-07-25)

- fix: Windows 截图隐藏 PowerShell 窗口，消除卡顿

## 1.0.1 (2026-07-25)

- chore: 重构版本号系统为标准 semver + 自动决策 bump 类型
