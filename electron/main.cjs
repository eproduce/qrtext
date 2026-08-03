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
    fullscreenable: false,
    title: 'QRTEXT',
    icon: path.join(__dirname, '../icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

  // 写入剪贴板
  try {
    const img = nativeImage.createFromBuffer(buf)
    clipboard.writeImage(img)
  } catch { /* 部分 Linux 桌面环境剪贴板不可用，静默忽略 */ }

  return `data:image/png;base64,${buf.toString('base64')}`
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
  // 检测 Wayland / X11 以优先匹配对应工具
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY

  const tools = isWayland
    ? [
        // Wayland：grim+slurp → flameshot → spectacle → gnome-screenshot
        { cmd: 'sh', args: ['-c', `slurp -d -f '%x,%y %w,%h' | grim -g - "${tmpPath}"`] },
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-r', '-o', tmpPath] },
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'maim', args: ['-s', '-u', tmpPath] },
        { cmd: 'import', args: [tmpPath] },
      ]
    : [
        // X11：flameshot → gnome-screenshot → spectacle → maim → ...
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-r', '-o', tmpPath] },
        { cmd: 'xfce4-screenshooter', args: ['-r', '-s', tmpPath] },
        { cmd: 'deepin-screenshot', args: ['-r', '-s', tmpPath] },
        { cmd: 'maim', args: ['-s', '-u', tmpPath] },
        { cmd: 'import', args: [tmpPath] },
        { cmd: 'scrot', args: ['-s', tmpPath] },
        { cmd: 'ukui-screenshot', args: ['-a', '-s', '-o', tmpPath] },
        { cmd: 'kylin-screenshot', args: ['-a', tmpPath] },
      ]

  for (const tool of tools) {
    try {
      await exec(tool.cmd, tool.args)
      // 轮询等待文件写入，最多 1 秒（代替原来固定 500ms）
      for (let i = 0; i < 20; i++) {
        if (fs.existsSync(tmpPath)) return
        await new Promise(r => setTimeout(r, 50))
      }
    } catch { /* 工具不存在或用户取消，继续尝试下一个 */ }
  }

  throw new Error(
    '未找到截图工具。请安装以下任一：\n' +
    'flameshot、gnome-screenshot、spectacle、grim+slurp、maim'
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

// ── 剪贴板 ──
ipcMain.handle('write-clipboard-image', (_event, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})

// ── Dock 图标 (macOS) ──
function setDockIcon() {
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '../icons/icon.png')
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(iconPath)
    }
  }
}

// ── 应用启动 ──
app.whenReady().then(() => {
  buildMenu()
  setDockIcon()
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
