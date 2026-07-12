const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const bumpType = process.argv[2] || 'patch'

// ── 读取当前版本 ──
const pkgPath = path.join(ROOT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
if (bumpType === 'major') newVersion = `${major + 1}.0.0`
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`
else newVersion = `${major}.${minor}.${patch + 1}`

// ── 更新 package.json ──
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// ── 更新 tauri.conf.json ──
const tauriPath = path.join(ROOT, 'src-tauri', 'tauri.conf.json')
const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf-8'))
tauri.version = newVersion
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n')

// ── 从 git log 生成 changelog 条目 ──
let lastTag
try {
  lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf-8' }).trim()
} catch {
  lastTag = ''
}

const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
let log
try {
  log = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, { encoding: 'utf-8' })
} catch {
  log = ''
}

const lines = log.trim().split('\n').filter(Boolean)
const features = lines.filter(l => l.startsWith('feat')).map(l => '- ' + l.replace(/^feat(\(.*?\))?:\s*/, ''))
const fixes = lines.filter(l => l.startsWith('fix')).map(l => '- ' + l.replace(/^fix(\(.*?\))?:\s*/, ''))
const others = lines.filter(l => !l.startsWith('feat') && !l.startsWith('fix')).map(l => '- ' + l)

// ── 写入 CHANGELOG ──
const changelogPath = path.join(ROOT, 'CHANGELOG.md')
const old = fs.readFileSync(changelogPath, 'utf-8')

const today = new Date().toISOString().slice(0, 10)
let entry = `## ${newVersion} (${today})\n\n`

if (features.length) entry += `### 新增\n${features.join('\n')}\n\n`
if (fixes.length) entry += `### 修复\n${fixes.join('\n')}\n\n`
if (others.length) entry += `### 其他\n${others.join('\n')}\n\n`

// 在第一个 ## 之前插入
const titleEnd = old.indexOf('\n## ')
const newChangelog = titleEnd > 0
  ? old.slice(0, titleEnd + 1) + entry + old.slice(titleEnd + 1)
  : old + '\n' + entry

fs.writeFileSync(changelogPath, newChangelog)

// ── 更新 README 版本号 ──
const readmePath = path.join(ROOT, 'README.md')
let readme = fs.readFileSync(readmePath, 'utf-8')
readme = readme.replace(/当前版本：\*\*[\d.]+\*\*/, `当前版本：**${newVersion}**`)
fs.writeFileSync(readmePath, readme)

// ── Git 操作 ──
const commitMsg = `chore: release v${newVersion}`
execSync('git add -A', { cwd: ROOT })
execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT })
execSync(`git tag v${newVersion}`, { cwd: ROOT })

console.log(`
✅ v${newVersion} 发布完成

  版本号已更新: package.json / tauri.conf.json
  CHANGELOG 已自动生成
  已 commit + tag

下一步:
  git push origin main --tags
`)
