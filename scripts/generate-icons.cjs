const sharp = require('sharp')
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const toIco = require('to-ico')

const ICONS_DIR = path.join(__dirname, '..', 'src-tauri', 'icons')
const SVG = path.join(ICONS_DIR, 'icon.svg')

async function generate() {
  // ── PNG 文件 ──
  const pngSizes = [
    { file: '32x32.png', size: 32 },
    { file: '128x128.png', size: 128 },
    { file: '128x128@2x.png', size: 256 },
    { file: 'icon.png', size: 512 },
    { file: 'Square30x30Logo.png', size: 30 },
    { file: 'Square44x44Logo.png', size: 44 },
    { file: 'Square71x71Logo.png', size: 71 },
    { file: 'Square89x89Logo.png', size: 89 },
    { file: 'Square107x107Logo.png', size: 107 },
    { file: 'Square142x142Logo.png', size: 142 },
    { file: 'Square150x150Logo.png', size: 150 },
    { file: 'Square284x284Logo.png', size: 284 },
    { file: 'Square310x310Logo.png', size: 310 },
    { file: 'StoreLogo.png', size: 50 },
  ]

  for (const { file, size } of pngSizes) {
    await sharp(SVG)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, file))
    console.log(`  ✓ ${file} (${size}×${size})`)
  }

  // ── ICO (Windows) ──
  console.log('  Generating icon.ico ...')
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPngs = await Promise.all(
    icoSizes.map(s => sharp(SVG).resize(s, s).png().toBuffer())
  )
  const icoBuf = await toIco(icoPngs)
  fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuf)
  console.log('  ✓ icon.ico (multi-size)')

  // ── ICNS (macOS) ──
  console.log('  Generating icon.icns ...')
  const iconset = path.join(ICONS_DIR, 'icon.iconset')
  fs.mkdirSync(iconset, { recursive: true })

  const sizes = [16, 32, 64, 128, 256, 512]
  for (const s of sizes) {
    const out = path.join(iconset, `icon_${s}x${s}.png`)
    await sharp(SVG).resize(s, s).png().toFile(out)
    const out2x = path.join(iconset, `icon_${s}x${s}@2x.png`)
    await sharp(SVG).resize(s * 2, s * 2).png().toFile(out2x)
  }

  try {
    execSync(`iconutil -c icns ${iconset} -o ${path.join(ICONS_DIR, 'icon.icns')}`, { stdio: 'pipe' })
    console.log('  ✓ icon.icns')
  } catch {
    console.log('  ⚠ iconutil unavailable, using png fallback')
    fs.copyFileSync(path.join(ICONS_DIR, 'icon.png'), path.join(ICONS_DIR, 'icon.icns'))
  }

  fs.rmSync(iconset, { recursive: true, force: true })
  console.log('\n🎨 All icons generated!')
}

generate().catch(console.error)
