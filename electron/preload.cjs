// ═══════════════════════════════════════════════════════════════
//  QRTEXT Electron Preload - Context Bridge
//  暴露安全的 IPC 接口给渲染进程
// ═══════════════════════════════════════════════════════════════
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 截图 ──
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),

  // ── 浮动截图 ──
  pinScreenshot: (dataUrl) => ipcRenderer.invoke('pin-screenshot', dataUrl),

  // ── 关闭当前窗口 ──
  closeWindow: () => ipcRenderer.send('close-window'),

  // ── 剪贴板 ──
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke('write-clipboard-image', dataUrl),

  // ── 确认退出 ──
  confirmExit: () => ipcRenderer.send('confirm-exit'),

  // ── 事件监听 ──
  onShowAbout: (callback) => ipcRenderer.on('show-about', callback),
  onShowExitConfirm: (callback) => ipcRenderer.on('show-exit-confirm', callback),
})
