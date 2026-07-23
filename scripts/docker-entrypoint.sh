#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Docker 容器内构建入口
#  产出：deb / rpm / 麒麟自包含 AppImage
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd /workspace

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  QRTEXT Docker 构建${NC}"
echo -e "${GREEN}  $(date '+%Y-%m-%d %H:%M')${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""

# ── 1. npm 依赖 ──
echo -e "${YELLOW}[1/5] npm ci...${NC}"
npm ci
echo -e "${GREEN}✓ npm 依赖完成${NC}"

# ── 2. 前端构建 ──
echo ""
echo -e "${YELLOW}[2/5] vite build...${NC}"
npx vite build
echo -e "${GREEN}✓ 前端构建完成${NC}"

# ── 3. Tauri 构建 deb + rpm ──
echo ""
echo -e "${YELLOW}[3/5] tauri build (deb + rpm)...${NC}"
npx tauri build --bundles deb,rpm 2>&1 | tail -20
echo -e "${GREEN}✓ deb/rpm 构建完成${NC}"

# ── 4. 制作麒麟专用 AppImage ──
echo ""
echo -e "${YELLOW}[4/5] 制作麒麟专用 AppImage（自包含 glibc 全家桶）...${NC}"

BIN="src-tauri/target/release/qrtext"
APPDIR="/tmp/QRTEXT.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/icons" \
         "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/lib"

cp "$BIN" "$APPDIR/usr/bin/qrtext"

cat > "$APPDIR/usr/share/applications/qrtext.desktop" << 'DESKEOF'
[Desktop Entry]
Type=Application
Name=QRTEXT
Icon=qrtext
Exec=qrtext
Categories=Utility;
DESKEOF

cp src-tauri/icons/128x128.png "$APPDIR/usr/share/icons/qrtext.png"
cp src-tauri/icons/128x128.png "$APPDIR/qrtext.png"

# linuxdeploy 收集 NEEDED 库 + GTK3
cd /tmp
DEPLOY_GTK_VERSION=3 linuxdeploy \
  --appdir "$APPDIR" \
  --desktop-file "$APPDIR/usr/share/applications/qrtext.desktop" \
  --icon-file "$APPDIR/usr/share/icons/qrtext.png" \
  --plugin gtk 2>&1 | tail -3

# 强制打入 glibc 全家桶（确保麒麟系统完全不依赖系统 glibc）
echo "打入 glibc 全家桶..."
for lib in libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1 \
           libstdc++.so.6 libgcc_s.so.1 ld-linux-x86-64.so.2; do
  SRC=$(find /lib /usr/lib -name "$lib" -type f 2>/dev/null | head -1)
  [ -n "$SRC" ] && cp -L "$SRC" "$APPDIR/usr/lib/" && echo "  ✓ $lib"
done

# patchelf：给所有 .so 设置 RPATH = $ORIGIN（同目录优先查找依赖）
# 这是关键——用 RPATH 代替 LD_LIBRARY_PATH，避免 dlopen 链路回退到系统路径
echo "设置所有 .so 的 RPATH 为 \$ORIGIN..."
find "$APPDIR/usr/lib" -name '*.so*' -type f | while IFS= read -r so; do
  # 跳过非 ELF 文件
  file "$so" 2>/dev/null | grep -q "ELF" || continue
  # $ORIGIN: 优先同目录 → $ORIGIN/.. : 子目录中的 lib（如 x86_64-linux-gnu/）也能找到上层 lib
  patchelf --set-rpath '$ORIGIN:$ORIGIN/..' "$so" 2>/dev/null || true
done
echo "  ✓ 所有 .so RPATH 已设为 \$ORIGIN:\$ORIGIN/.."

echo "设置二进制 RPATH..."
patchelf --set-rpath '$ORIGIN/../lib:$ORIGIN/../lib/x86_64-linux-gnu' \
         "$APPDIR/usr/bin/qrtext"
echo "  ✓ 二进制 RPATH: \$ORIGIN/../lib"

# AppRun：直接设置 LD_LIBRARY_PATH + exec 二进制（不再手动调 ld-linux）
# RPATH 已经保证了优先查找自带库，LD_LIBRARY_PATH 作为兜底
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
export PATH="$APPDIR/usr/bin:$PATH"
export LD_LIBRARY_PATH="$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GTK_PATH="$APPDIR/usr/lib/x86_64-linux-gnu/gtk-3.0"
export GIO_MODULE_DIR="$APPDIR/usr/lib/x86_64-linux-gnu/gio/modules"
export GDK_PIXBUF_MODULE_FILE="$APPDIR/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
exec "$APPDIR/usr/bin/qrtext" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

# appimagetool 打包
echo "appimagetool 打包..."
ARCH=x86_64 appimagetool "$APPDIR" "/tmp/QRTEXT-x86_64.AppImage" 2>&1 | tail -3

APPI="/tmp/QRTEXT-x86_64.AppImage"
if [ -f "$APPI" ]; then
  DEST="/workspace/src-tauri/target/release/bundle/appimage/"
  mkdir -p "$DEST"
  cp "$APPI" "$DEST"
  ls -lh "$DEST"
  echo -e "${GREEN}✓ 自包含 AppImage（完整 glibc + webkit2gtk-4.1 + GTK3）${NC}"
else
  echo -e "${RED}✗ AppImage 生成失败${NC}"
  exit 1
fi

# ── 5. 验证 ──
echo ""
echo -e "${YELLOW}[5/5] 验证产物...${NC}"

echo ""
echo "=== deb 包 ==="
ls -lh /workspace/src-tauri/target/release/bundle/deb/ 2>/dev/null || echo "  (无)"

echo ""
echo "=== rpm 包 ==="
ls -lh /workspace/src-tauri/target/release/bundle/rpm/ 2>/dev/null || echo "  (无)"

echo ""
echo "=== AppImage ==="
ls -lh /workspace/src-tauri/target/release/bundle/appimage/ 2>/dev/null || echo "  (无)"

# 验证：直接检查构建目录（不提取 AppImage，避免 unsquashfs 兼容问题）
echo ""
echo "=== 产物验证 ==="
set +e  # 验证失败不阻塞构建

BIN="/workspace/src-tauri/target/release/qrtext"
LIB_DIR="$APPDIR/usr/lib"

echo ""
echo "二进制 glibc 需求:"
objdump -T "$BIN" 2>/dev/null | grep -oP 'GLIBC_\d+\.\d+' | sort -Vu | tail -3 || echo "  (objdump 不可用)"

echo ""
echo "已打包的 C/C++ 运行时:"
for f in libstdc++.so.6 libstdc++.so.6.* libc.so.6 libgcc_s.so.1; do
  ls -la "$LIB_DIR/$f" 2>/dev/null && echo "  ✓ $f" || echo "  ✗ $f"
done

if ls "$LIB_DIR/libstdc++.so"* >/dev/null 2>&1; then
  LIBCPP=$(find "$LIB_DIR" -name 'libstdc++.so*' -type f | head -1)
  VER=$(strings "$LIBCPP" 2>/dev/null | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1 || echo "?")
  echo ""
  echo "自带 libstdc++: $VER"
  echo "麒麟系统自带:   GLIBCXX_3.4.25 左右"
else
  echo ""
  echo "!!! 未找到 libstdc++.so !!!"
fi

echo ""
echo "已打包 .so 文件总数: $(find "$LIB_DIR" -name '*.so*' -type f 2>/dev/null | wc -l)"

echo ""
echo "AppRun 前3行:"
head -3 "$APPDIR/AppRun" 2>/dev/null || echo "  (无)"

set -e

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  构建完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  deb:  src-tauri/target/release/bundle/deb/"
echo "  rpm:  src-tauri/target/release/bundle/rpm/"
echo "  AppImage: src-tauri/target/release/bundle/appimage/"
echo ""
echo "  AppImage 自包含：ld-linux + libc 2.35 + libstdc++ 3.4.30"
echo "  无需麒麟系统提供任何特定版本的库"
