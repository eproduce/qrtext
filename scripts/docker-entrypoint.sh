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

# patchelf：清除所有打包库的 RPATH → LD_LIBRARY_PATH 优先生效
echo "清除 RPATH/RUNPATH..."
find "$APPDIR/usr/lib" -name '*.so*' -type f | while IFS= read -r so; do
  patchelf --remove-rpath "$so" 2>/dev/null || true
done

echo "设置二进制 RPATH..."
patchelf --set-rpath '$ORIGIN/../lib:$ORIGIN/../lib/x86_64-linux-gnu' \
         "$APPDIR/usr/bin/qrtext"

# AppRun：用自带的 ld-linux 直接启动，完全绕开系统动态链接器
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
export PATH="$APPDIR/usr/bin:$PATH"
export LD_LIBRARY_PATH="$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu"
export GTK_PATH="$APPDIR/usr/lib/x86_64-linux-gnu/gtk-3.0"
export GIO_MODULE_DIR="$APPDIR/usr/lib/x86_64-linux-gnu/gio/modules"
export GDK_PIXBUF_MODULE_FILE="$APPDIR/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
exec "$APPDIR/usr/lib/ld-linux-x86-64.so.2" \
  --library-path "$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu" \
  "$APPDIR/usr/bin/qrtext" "$@"
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

# 验证 AppImage 内部 glibc
echo ""
echo "=== AppImage 内部 glibc 验证 ==="
"$DEST"/*.AppImage --appimage-extract >/dev/null 2>&1 || {
  OFFSET=$(grep -abo 'hsqs' "$DEST"/*.AppImage | awk -F: '$1 > 131072 {print $1; exit}')
  dd if="$DEST"/*.AppImage bs=1 skip="$OFFSET" of=/tmp/v.squashfs status=none 2>/dev/null
  unsquashfs -d squashfs-root /tmp/v.squashfs >/dev/null 2>&1
}

echo "自包含库列表:"
ls squashfs-root/usr/lib/libc.so* squashfs-root/usr/lib/libstdc++* squashfs-root/usr/lib/ld-linux* 2>/dev/null

echo ""
LIBCPP_VER=$(strings squashfs-root/usr/lib/libstdc++.so.6 2>/dev/null | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
echo "libstdc++ 最高版本: $LIBCPP_VER"

echo ""
GLIBC_VER=$(objdump -T squashfs-root/usr/bin/qrtext 2>/dev/null | grep -oP 'GLIBC_\d+\.\d+' | sort -Vu | tail -1)
echo "二进制最高 glibc 需求: $GLIBC_VER"

rm -rf squashfs-root /tmp/v.squashfs

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  构建完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
