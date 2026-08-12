// ═══════════════════════════════════════════════════════════════
//  QRTEXT Electron 主进程
//  Port from src-tauri/src/lib.rs
// ═══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, Menu, clipboard, nativeImage, dialog, screen, desktopCapturer } = require('electron')
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
  // Linux：优先使用自研选区（Snipaste 式顺滑渲染，多屏/多分辨率适配）
  if (process.platform === 'linux') {
    const result = await customLinuxScreenshot()
    if (result.cancelled) {
      throw new Error('截图已取消')
    }
    if (result.dataUrl) {
      writeImageToClipboard(result.dataUrl)
      return result.dataUrl
    }
    // 自研选区失败 → 回退外部截图工具
  }

  const tmpPath = path.join(os.tmpdir(), `qrtext_screenshot_${Date.now()}.png`)

  // 截图前完全隐藏窗口（hide 比 minimize 更彻底，无动画延迟）
  if (process.platform === 'linux' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
    await new Promise(r => setTimeout(r, 300))
  }

  try {
    if (process.platform === 'darwin') {
      await exec('screencapture', ['-i', '-x', tmpPath])
    } else if (process.platform === 'linux') {
      await linuxScreenshot(tmpPath)
    } else if (process.platform === 'win32') {
      await windowsScreenshot(tmpPath)
    }
  } finally {
    // 截图完成后恢复窗口
    if (process.platform === 'linux' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
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

function writeImageToClipboard(dataUrl) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  } catch { /* 部分 Linux 桌面环境剪贴板不可用，静默忽略 */ }
}

// ── 自研截图选区（Snipaste 式） ──
let screenshotWin = null
let screenshotResolver = null

function customLinuxScreenshot() {
  return new Promise((resolve) => {
    if (screenshotWin) {
      resolve({ ok: false, cancelled: false })
      return
    }
    screenshotResolver = resolve

    // 计算所有显示器的包围盒（支持多屏，坐标可为负）
    const displays = screen.getAllDisplays()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const d of displays) {
      minX = Math.min(minX, d.bounds.x)
      minY = Math.min(minY, d.bounds.y)
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
    }

    screenshotWin = new BrowserWindow({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    screenshotWin.setAlwaysOnTop(true, 'screen-saver')
    screenshotWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    screenshotWin.loadFile(path.join(__dirname, 'screenshot.html'))

    screenshotWin.on('closed', () => {
      if (screenshotResolver) {
        const r = screenshotResolver
        screenshotResolver = null
        r({ ok: false, cancelled: true })
      }
      screenshotWin = null
    })

    // 截图前隐藏主窗口，避免遮挡选区
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide()
    }
  })
}

// 选区确认：relBounds 为选区窗口内相对坐标
ipcMain.on('screenshot-select', async (_event, relBounds) => {
  const resolver = screenshotResolver
  const win = screenshotWin
  screenshotResolver = null
  screenshotWin = null

  if (!win || !resolver || !relBounds) {
    resolver && resolver({ ok: false, cancelled: false })
    return
  }

  const winBounds = win.getBounds()
  const selection = {
    x: winBounds.x + relBounds.x,
    y: winBounds.y + relBounds.y,
    w: relBounds.w,
    h: relBounds.h,
  }
  win.close()

  // 恢复主窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }

  try {
    const dataUrl = await captureRegion(selection)
    resolver({ ok: true, dataUrl })
  } catch (e) {
    resolver({ ok: false, cancelled: false })
  }
})

ipcMain.on('screenshot-cancel', () => {
  const resolver = screenshotResolver
  screenshotResolver = null
  if (screenshotWin) {
    screenshotWin.close()
    screenshotWin = null
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
  resolver && resolver({ ok: false, cancelled: true })
})

// 按全局 DIP 坐标裁剪屏幕区域（多屏 + 不同缩放比适配）
async function captureRegion(selection) {
  const displays = screen.getAllDisplays()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    // 大尺寸请求 → 返回各显示器原生分辨率缩略图
    thumbnailSize: { width: 8192, height: 8192 },
  })

  // 找出与选区相交的显示器
  const involved = []
  for (const d of displays) {
    const ix = Math.max(selection.x, d.bounds.x)
    const iy = Math.max(selection.y, d.bounds.y)
    const ix2 = Math.min(selection.x + selection.w, d.bounds.x + d.bounds.width)
    const iy2 = Math.min(selection.y + selection.h, d.bounds.y + d.bounds.height)
    if (ix < ix2 && iy < iy2) {
      involved.push(d)
    }
  }
  if (involved.length === 0) throw new Error('no display involved')

  // 单显示器：直接裁剪（含缩放比换算）
  if (involved.length === 1) {
    const d = involved[0]
    const source = sources.find((s) => s.display_id === String(d.id)) || sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error('no source')
    const img = nativeImage.createFromBuffer(source.thumbnail.toPNG())
    const thumbSize = img.getSize()
    const scaleX = thumbSize.width / d.bounds.width
    const scaleY = thumbSize.height / d.bounds.height
    const cropped = img.crop({
      x: Math.round((selection.x - d.bounds.x) * scaleX),
      y: Math.round((selection.y - d.bounds.y) * scaleY),
      width: Math.round(selection.w * scaleX),
      height: Math.round(selection.h * scaleY),
    })
    return 'data:image/png;base64,' + cropped.toPNG().toString('base64')
  }

  // 多显示器：用离屏窗口合成
  const displayData = []
  for (const d of involved) {
    const source = sources.find((s) => s.display_id === String(d.id))
    if (!source || source.thumbnail.isEmpty()) continue
    displayData.push({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      image: 'data:image/png;base64,' + source.thumbnail.toPNG().toString('base64'),
    })
  }
  if (displayData.length === 0) throw new Error('no source data')
  return compositeDisplays(displayData, selection)
}

// 离屏合成窗口
let compositeWin = null
async function compositeDisplays(displayData, selection) {
  if (!compositeWin || compositeWin.isDestroyed()) {
    compositeWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
    })
    await compositeWin.loadFile(path.join(__dirname, 'composite.html'))
  }
  return compositeWin.webContents.executeJavaScript(
    `composite(${JSON.stringify(displayData)}, ${JSON.stringify(selection)})`
  )
}

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
        // X11：gnome-screenshot（GTK 原生选择框，不易撕裂）→ flameshot → spectacle → ...
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
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
