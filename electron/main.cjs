// ═══════════════════════════════════════════════════════════════
//  QRTEXT Electron 主进程
//  Port from src-tauri/src/lib.rs
// ═══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, Menu, clipboard, nativeImage, dialog } = require('electron')
const { execFile, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ── 主窗口 ──
let mainWindow = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 400,
    fullscreenable: true,
    title: 'QRTEXT',
    icon: path.join(__dirname, '../icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Escape / F11 退出全屏
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.executeJavaScript(`
      if (!window._fullscreenEscBound) {
        window._fullscreenEscBound = true
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' || e.key === 'F11') {
            window.electronAPI.exitFullscreen()
          }
        })
      }
    `)
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 关闭确认
  mainWindow.on('close', (e) => {
    if (!closingConfirmed) {
      e.preventDefault()
      mainWindow.webContents.send('show-exit-confirm')
    }
  })
}

let closingConfirmed = false
ipcMain.on('confirm-exit', () => {
  closingConfirmed = true
  app.quit()
})

// ── 菜单栏 ──
function buildMenu() {
  const template = [
    {
      label: 'QRTEXT',
      submenu: [
        {
          label: '关于 QRTEXT',
          click: () => mainWindow?.webContents.send('show-about'),
        },
        { type: 'separator' },
        {
          label: '隐藏 QRTEXT',
          accelerator: 'CmdOrCtrl+H',
          click: () => app.hide(),
        },
        {
          label: '退出 QRTEXT',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { closingConfirmed = true; app.quit() },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '拷贝', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '进入全屏', accelerator: 'CmdOrCtrl+Control+F', role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── 系统截图 ──
ipcMain.handle('take-screenshot', async () => {
  const tmpPath = path.join(os.tmpdir(), `qrtext_screenshot_${Date.now()}.png`)

  if (process.platform === 'darwin') {
    await exec('screencapture', ['-i', '-x', tmpPath])
  } else if (process.platform === 'linux') {
    await linuxScreenshot(tmpPath)
  } else if (process.platform === 'win32') {
    await windowsScreenshot(tmpPath)
  }

  if (!fs.existsSync(tmpPath)) {
    throw new Error('截图已取消或截图工具不可用')
  }

  const buf = fs.readFileSync(tmpPath)
  fs.unlinkSync(tmpPath)
  return `data:image/png;base64,${buf.toString('base64')}`

  // 同时写入剪贴板
  const img = nativeImage.createFromBuffer(buf)
  clipboard.writeImage(img)
})

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function linuxScreenshot(tmpPath) {
  const tools = [
    { cmd: 'ukui-screenshot', args: ['-a', '-s', '-o', tmpPath] },
    { cmd: 'kylin-screenshot', args: ['-a', tmpPath] },
    { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
    { cmd: 'spectacle', args: ['-b', '-n', '-o', tmpPath] },
    { cmd: 'xfce4-screenshooter', args: ['-r', '-s', tmpPath] },
    { cmd: 'deepin-screenshot', args: ['-r', '-s', tmpPath] },
    { cmd: 'flameshot', args: ['gui', '-r', '-p', tmpPath] },
    { cmd: 'import', args: [tmpPath] },
    { cmd: 'maim', args: ['-s', tmpPath] },
    { cmd: 'scrot', args: ['-s', tmpPath] },
  ]

  for (const tool of tools) {
    try {
      await exec(tool.cmd, tool.args)
      // 等待截图工具写入文件
      await new Promise(r => setTimeout(r, 500))
      if (fs.existsSync(tmpPath)) return
    } catch { /* 工具不存在或用户取消，继续尝试下一个 */ }
  }

  throw new Error(
    '未找到截图工具。请安装以下任一：\n' +
    'flameshot、gnome-screenshot、spectacle、maim、scrot、import (ImageMagick)'
  )
}

async function windowsScreenshot(tmpPath) {
  try {
    await exec('cmd', ['/c', 'start', '/wait', 'ms-screenclip:'])
    // 从剪贴板获取
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      fs.writeFileSync(tmpPath, img.toPNG())
      return
    }
  } catch { /* fallback */ }
  throw new Error('截图失败，请使用 Win+Shift+S 截图后粘贴')
}

// ── 浮动截图窗口 ──
ipcMain.handle('pin-screenshot', (_event, dataUrl) => {
  const pinWin = new BrowserWindow({
    width: 420,
    height: 320,
    minWidth: 120,
    minHeight: 80,
    resizable: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const encoded = encodeURIComponent(dataUrl)
  pinWin.loadFile(path.join(__dirname, '../dist/index.html'), {
    hash: `pin:${encoded}`,
  })

  // 双击关闭
  pinWin.webContents.on('did-finish-load', () => {
    pinWin.webContents.executeJavaScript(`
      document.addEventListener('dblclick', () => window.electronAPI.closeWindow())
    `)
  })
})

ipcMain.on('close-window', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.on('exit-fullscreen', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.setFullScreen(false)
})

// ── 剪贴板 ──
ipcMain.handle('write-clipboard-image', (_event, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})

// ── 应用启动 ──
app.whenReady().then(() => {
  buildMenu()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
