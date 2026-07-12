const fs = require('fs')
const path = require('path')

const newVersion = process.argv[2]
if (!newVersion) {
  console.error('Usage: node scripts/bump-version.cjs <version>')
  console.error('Example: node scripts/bump-version.cjs 0.2.0')
  process.exit(1)
}

// 更新 package.json
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 更新 tauri.conf.json
const tauriConfPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json')
const tauri = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'))
tauri.version = newVersion
fs.writeFileSync(tauriConfPath, JSON.stringify(tauri, null, 2) + '\n')

console.log(`✅ Version bumped to ${newVersion}`)
console.log('   - package.json')
console.log('   - src-tauri/tauri.conf.json')
console.log('\nNext steps:')
console.log(`  1. Update CHANGELOG.md`)
console.log(`  2. git commit -m "chore: bump version to ${newVersion}"`)
console.log(`  3. git tag v${newVersion}`)
console.log(`  4. git push && git push --tags`)
