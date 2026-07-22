#!/bin/bash
# ═══════════════════════════════════════════════════════
#  AppImage libstdc++ 补丁脚本（离线版）
#  解决 GLIBCXX_3.4.29 not found 问题
#
#  依赖（全部为系统自带或 apt 可离线安装）：
#    - bash, dd, cat, grep, sed, strings（系统自带）
#    - mksquashfs（apt install squashfs-tools）
#    - 不需要 appimagetool，不需要网络下载
# ═══════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() { echo -e "${RED}错误：$*${NC}" >&2; exit 1; }

# ── 检查必需工具 ──
check_tools() {
  for tool in dd cat grep sed strings; do
    command -v "$tool" &>/dev/null || die "缺少系统工具: $tool"
  done

  if ! command -v mksquashfs &>/dev/null; then
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo -e "${RED}  错误：未找到 mksquashfs 命令${NC}"
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo ""
    echo "  mksquashfs 包含在 squashfs-tools 包中。"
    echo "  请在构建机上安装（不需要网络，用系统 ISO 或离线源）："
    echo ""
    echo "    sudo apt install squashfs-tools"
    echo ""
    echo "  如果 apt 源不可用，可从系统安装 ISO 中提取："
    echo "    sudo mount /path/to/kylin.iso /mnt"
    echo "    sudo dpkg -i /mnt/pool/main/s/squashfs-tools/squashfs-tools_*.deb"
    exit 1
  fi
}

# ── 参数检查 ──
APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(ls src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)
fi

[ -z "$APPIMAGE" ] && die "找不到 AppImage 文件\n用法: $0 [AppImage路径]"
[ ! -f "$APPIMAGE" ] && die "文件不存在: $APPIMAGE"

APPIMAGE="$(realpath "$APPIMAGE")"
APPIMAGE_NAME="$(basename "$APPIMAGE")"
WORKDIR="$(mktemp -d)"
ORIG_DIR="$PWD"

echo -e "${GREEN}═══ AppImage libstdc++ 补丁（离线版） ═══${NC}"
echo "  AppImage: $APPIMAGE_NAME"
echo "  工作目录: $WORKDIR"
echo ""

check_tools

# ── 步骤1：提取 AppImage ──
echo -e "${YELLOW}[1/5] 提取 AppImage...${NC}"
cd "$WORKDIR"
chmod +x "$APPIMAGE"
"$APPIMAGE" --appimage-extract >/dev/null 2>&1
echo -e "${GREEN}  ✓ 提取完成${NC}"

EXTRACT_DIR="$WORKDIR/squashfs-root"
[ -f "$EXTRACT_DIR/usr/bin/qrtext" ] || die "内部结构异常，找不到 usr/bin/qrtext"

# ── 步骤2：查找包含 GLIBCXX_3.4.29 的 libstdc++.so.6 ──
echo ""
echo -e "${YELLOW}[2/5] 查找 libstdc++.so.6...${NC}"

LIBCPP_SRC=""
CANDIDATES=(
  /usr/lib/x86_64-linux-gnu/libstdc++.so.6
  /usr/lib64/libstdc++.so.6
  /usr/lib/libstdc++.so.6
  "$CONDA_PREFIX/lib/libstdc++.so.6"
  /usr/lib/gcc/x86_64-linux-gnu/11/libstdc++.so.6
  /usr/lib/gcc/x86_64-linux-gnu/12/libstdc++.so.6
  /usr/lib/gcc/x86_64-linux-gnu/13/libstdc++.so.6
)

for candidate in "${CANDIDATES[@]}"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    if strings "$candidate" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
      LIBCPP_SRC="$candidate"
      echo -e "${GREEN}  ✓ 找到: $LIBCPP_SRC${NC}"
      break
    else
      echo "    跳过 $candidate（不含 GLIBCXX_3.4.29）"
    fi
  fi
done

# 尝试 dpkg 查找
if [ -z "$LIBCPP_SRC" ] && command -v dpkg &>/dev/null; then
  DEB_LIB=$(dpkg -L libstdc++6 2>/dev/null | grep 'libstdc++.so.6$' | head -1 || true)
  if [ -n "$DEB_LIB" ] && strings "$DEB_LIB" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
    LIBCPP_SRC="$DEB_LIB"
    echo -e "${GREEN}  ✓ 从已安装包找到: $LIBCPP_SRC${NC}"
  fi
fi

# 检查环境变量
if [ -z "$LIBCPP_SRC" ]; then
  if [ -n "${LIBCPP_PATH:-}" ] && [ -f "$LIBCPP_PATH" ] && strings "$LIBCPP_PATH" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
    LIBCPP_SRC="$LIBCPP_PATH"
    echo -e "${GREEN}  ✓ 使用环境变量指定的: $LIBCPP_SRC${NC}"
  fi
fi

if [ -z "$LIBCPP_SRC" ]; then
  echo ""
  echo -e "${RED}════════════════════════════════════════════${NC}"
  echo -e "${RED}  错误：系统中找不到含 GLIBCXX_3.4.29 的 libstdc++.so.6${NC}"
  echo -e "${RED}════════════════════════════════════════════${NC}"
  echo ""
  echo "  这说明构建机本身的 libstdc++ 也不够新。"
  echo "  但是既然 webkit2gtk-4.1 能在这台机器上编译/链接，"
  echo "  说明某处存在较新的 libstdc++。请手动查找："
  echo ""
  echo "    find /usr -name 'libstdc++.so*' -type f 2>/dev/null"
  echo ""
  echo "  然后通过环境变量指定路径重新运行："
  echo "    LIBCPP_PATH=/path/to/libstdc++.so.6 bash $0 $APPIMAGE"
  rm -rf "$WORKDIR"
  exit 1
fi

# ── 步骤3：复制 libstdc++ 到 AppDir ──
echo ""
echo -e "${YELLOW}[3/5] 复制 libstdc++ 到 AppImage...${NC}"

cp -v "$LIBCPP_SRC" "$EXTRACT_DIR/usr/lib/libstdc++.so.6"

LIBCPP_REAL=$(readlink -f "$LIBCPP_SRC" 2>/dev/null || echo "$LIBCPP_SRC")
if [ "$LIBCPP_REAL" != "$LIBCPP_SRC" ] && [ -f "$LIBCPP_REAL" ]; then
  REAL_BASE=$(basename "$LIBCPP_REAL")
  if [ ! -f "$EXTRACT_DIR/usr/lib/$REAL_BASE" ]; then
    cp -v "$LIBCPP_REAL" "$EXTRACT_DIR/usr/lib/$REAL_BASE"
  fi
fi

echo -e "${GREEN}  ✓ libstdc++ 已复制${NC}"

# ── 步骤4：修改 AppRun ──
echo ""
echo -e "${YELLOW}[4/5] 修改 AppRun...${NC}"

APPRUN="$EXTRACT_DIR/AppRun"
[ -f "$APPRUN" ] || die "找不到 AppRun"

cp "$APPRUN" "$APPRUN.bak"

if grep -q '^export LD_LIBRARY_PATH' "$APPRUN" 2>/dev/null; then
  sed -i 's|^export LD_LIBRARY_PATH="|export LD_LIBRARY_PATH="$APPDIR/usr/lib:|' "$APPRUN"
  sed -i "s|^export LD_LIBRARY_PATH='|export LD_LIBRARY_PATH='\$APPDIR/usr/lib:|" "$APPRUN"
  echo "  ✓ 已修改现有 LD_LIBRARY_PATH"
else
  sed -i '1a\
# 优先加载 AppImage 自带的 libstdc++（解决 GLIBCXX 版本不兼容）\
export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:}$LD_LIBRARY_PATH"' "$APPRUN"
  echo "  ✓ 已在 AppRun 开头注入 LD_LIBRARY_PATH"
fi

echo -e "${GREEN}  ✓ AppRun 已修改${NC}"

# ── 步骤5：手动重新打包 AppImage（不需要 appimagetool） ──
echo ""
echo -e "${YELLOW}[5/5] 重新打包 AppImage...${NC}"

# AppImage Type 2 格式: [runtime ELF] + [squashfs 文件系统]
# 我们需要：
#   a) 从原 AppImage 中提取 runtime 头
#   b) 用 mksquashfs 将修改后的 AppDir 打包
#   c) 拼接 runtime + squashfs → 新 AppImage

# ── 5a. 找到 runtime 与 squashfs 的分界 ──
# 方法：用 grep 找到 "hsqs"（squashfs superblock magic）的字节偏移
SQUASHFS_OFFSET=$(grep -abo 'hsqs' "$APPIMAGE" 2>/dev/null | head -1 | cut -d: -f1)

if [ -z "$SQUASHFS_OFFSET" ] || [ "$SQUASHFS_OFFSET" -lt 10000 ]; then
  die "无法定位 AppImage 中的 squashfs 镜像\n请确认 AppImage 未损坏"
fi

echo "  Runtime 大小: $SQUASHFS_OFFSET 字节"

# ── 5b. 提取 runtime 头 ──
RUNTIME_HEADER="$WORKDIR/runtime_header.bin"
dd if="$APPIMAGE" of="$RUNTIME_HEADER" bs=1 count="$SQUASHFS_OFFSET" status=none
echo "  已提取 runtime 头"

# ── 5c. 用 mksquashfs 创建新的文件系统镜像 ──
SQUASHFS_NEW="$WORKDIR/new_fs.squashfs"
echo "  正在创建 squashfs 镜像..."

mksquashfs "$EXTRACT_DIR" "$SQUASHFS_NEW" \
  -root-owned \
  -noappend \
  -comp xz \
  -b 16384 \
  2>&1 | tail -1

[ -f "$SQUASHFS_NEW" ] || die "mksquashfs 创建镜像失败"
echo "  新镜像大小: $(du -h "$SQUASHFS_NEW" | cut -f1)"

# ── 5d. 拼接 runtime + squashfs → 新 AppImage ──
NEW_APPIMAGE="$APPIMAGE"
cat "$RUNTIME_HEADER" "$SQUASHFS_NEW" > "$NEW_APPIMAGE"
chmod +x "$NEW_APPIMAGE"

echo -e "${GREEN}  ✓ 重新打包完成${NC}"
echo "  最终大小: $(du -h "$NEW_APPIMAGE" | cut -f1)"

# ── 验证 ──
echo ""
echo -e "${YELLOW}[验证] 检查补丁结果...${NC}"

cd "$WORKDIR"
rm -rf squashfs-root
"$NEW_APPIMAGE" --appimage-extract >/dev/null 2>&1

if [ -f squashfs-root/usr/lib/libstdc++.so.6 ]; then
  GLIBCXX_MAX=$(strings squashfs-root/usr/lib/libstdc++.so.6 | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
  echo -e "${GREEN}  ✓ libstdc++.so.6 已打包（最高: $GLIBCXX_MAX）${NC}"
else
  echo -e "${RED}  ✗ libstdc++.so.6 缺失！${NC}"
fi

if grep -q 'LD_LIBRARY_PATH.*usr/lib' squashfs-root/AppRun; then
  echo -e "${GREEN}  ✓ AppRun 已设置 \$APPDIR/usr/lib 优先加载${NC}"
else
  echo -e "${RED}  ✗ AppRun 缺少 LD_LIBRARY_PATH 设置！${NC}"
fi

# ── 清理 ──
cd "$ORIG_DIR"
rm -rf "$WORKDIR"

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  补丁完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "  已修复的 AppImage: $NEW_APPIMAGE"
echo "  可直接运行: chmod +x $NEW_APPIMAGE && $NEW_APPIMAGE"
