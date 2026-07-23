#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AppImage 完整补丁脚本（v3 - 彻底解决麒麟兼容性问题）
#
#  解决的问题：
#   1. GLIBCXX_3.4.29/3.4.30 not found
#      → 从 Ubuntu 22.04 提取新版 libstdc++ 打包进 AppImage
#   2. /usr/lib/ld-linux-x86-64.so.2 不存在
#      → 修正 AppRun 中的动态链接器路径为标准 /lib64/
#   3. 动态链接器找不到打包的 libstdc++
#      → 在 AppRun 开头注入 LD_LIBRARY_PATH
#      → 用 patchelf 修正二进制的 RPATH
#
#  依赖（系统自带或 apt 可装）：
#    - bash, dd, grep, sed, strings（系统自带）
#    - mksquashfs（apt install squashfs-tools）
#    - patchelf（apt install patchelf）
#    - 不需要 appimagetool，不需要网络（构建时已下载好 libstdc++）
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

die() {
  echo -e "${RED}════════════════════════════════════════════${NC}"
  echo -e "${RED}  致命错误：$*${NC}"
  echo -e "${RED}════════════════════════════════════════════${NC}"
  exit 1
}

warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
info() { echo -e "${CYAN}  → $*${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }

# ── 检查必需工具 ──
check_tools() {
  local missing=()
  for tool in dd cat grep sed strings patchelf; do
    command -v "$tool" &>/dev/null || missing+=("$tool")
  done

  if ! command -v mksquashfs &>/dev/null; then
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo -e "${RED}  错误：未找到 mksquashfs 命令${NC}"
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo ""
    echo "  请安装 squashfs-tools："
    echo "    sudo apt install squashfs-tools"
    echo ""
    echo "  离线环境可从系统 ISO 挂载安装："
    echo "    sudo mount /path/to/kylin.iso /mnt"
    echo "    sudo dpkg -i /mnt/pool/main/s/squashfs-tools/squashfs-tools_*.deb"
    exit 1
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    die "缺少工具: ${missing[*]}\n请安装: sudo apt install ${missing[*]}"
  fi
}

# ── 参数处理 ──
APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  # 自动查找
  APPIMAGE=$(ls src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)
  # 也尝试不带路径的当前目录
  [ -z "$APPIMAGE" ] && APPIMAGE=$(ls *.AppImage 2>/dev/null | head -1)
fi

[ -z "$APPIMAGE" ] && die "找不到 AppImage 文件\n用法: $0 [AppImage路径]"
[ ! -f "$APPIMAGE" ] && die "文件不存在: $APPIMAGE"

APPIMAGE="$(realpath "$APPIMAGE")"
APPIMAGE_NAME="$(basename "$APPIMAGE")"
WORKDIR="$(mktemp -d)"
ORIG_DIR="$PWD"

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  AppImage 兼容性补丁 v3${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo "  AppImage: $APPIMAGE_NAME"
echo "  工作目录: $WORKDIR"
echo ""

check_tools

# ═══════════════════════════════════════════════════════════════
#  步骤1：提取 AppImage
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}[1/6] 提取 AppImage...${NC}"
cd "$WORKDIR"
chmod +x "$APPIMAGE"
"$APPIMAGE" --appimage-extract >/dev/null 2>&1
EXTRACT_DIR="$WORKDIR/squashfs-root"
[ -f "$EXTRACT_DIR/usr/bin/qrtext" ] || die "提取失败：找不到 usr/bin/qrtext"
ok "提取完成"

# ═══════════════════════════════════════════════════════════════
#  步骤2：查找新版 libstdc++.so.6
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[2/6] 查找新版 libstdc++.so.6（需要 GLIBCXX_3.4.29+）...${NC}"

LIBCPP_SRC=""

# 优先级 1：build-on-kylin.sh 下载好的（/tmp/qrtext-libstdcxx）
if [ -d "/tmp/qrtext-libstdcxx" ]; then
  CANDIDATE=$(find /tmp/qrtext-libstdcxx -name "libstdc++.so.6.0.*" -type f 2>/dev/null | head -1)
  if [ -n "$CANDIDATE" ] && strings "$CANDIDATE" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
    LIBCPP_SRC="$CANDIDATE"
    ok "使用预下载的: $LIBCPP_SRC"
  fi
fi

# 优先级 2：环境变量 LIBCPP_PATH
if [ -z "$LIBCPP_SRC" ] && [ -n "${LIBCPP_PATH:-}" ]; then
  if [ -f "$LIBCPP_PATH" ] && strings "$LIBCPP_PATH" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
    LIBCPP_SRC="$LIBCPP_PATH"
    ok "使用环境变量指定的: $LIBCPP_SRC"
  fi
fi

# 优先级 3：系统搜索
if [ -z "$LIBCPP_SRC" ]; then
  SEARCH_PATHS=(
    /usr/lib/x86_64-linux-gnu
    /usr/lib64
    /usr/lib
    /lib/x86_64-linux-gnu
    /lib64
    "${CONDA_PREFIX:-}/lib"
    /usr/lib/gcc/x86_64-linux-gnu/11
    /usr/lib/gcc/x86_64-linux-gnu/12
    /usr/lib/gcc/x86_64-linux-gnu/13
  )
  for search_dir in "${SEARCH_PATHS[@]}"; do
    [ -z "$search_dir" ] && continue
    for candidate in "$search_dir"/libstdc++.so.6*; do
      [ -f "$candidate" ] || continue
      if strings "$candidate" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
        LIBCPP_SRC="$candidate"
        break 2
      fi
    done
  done
  if [ -n "$LIBCPP_SRC" ]; then
    ok "从系统找到: $LIBCPP_SRC"
  fi
fi

if [ -z "$LIBCPP_SRC" ]; then
  echo ""
  echo -e "${RED}════════════════════════════════════════════${NC}"
  echo -e "${RED}  找不到含 GLIBCXX_3.4.29+ 的 libstdc++.so.6${NC}"
  echo -e "${RED}════════════════════════════════════════════${NC}"
  echo ""
  echo "  这意味着构建机本身的 libstdc++ 也不够新。"
  echo "  请先运行 build-on-kylin.sh（它会自动下载），"
  echo "  或者手动下载 Ubuntu 22.04 的 libstdc++6："
  echo ""
  echo "    mkdir -p /tmp/qrtext-libstdcxx"
  echo "    cd /tmp"
  echo "    wget http://archive.ubuntu.com/ubuntu/pool/main/g/gcc-12/libstdc++6_12.3.0-1ubuntu1~22.04_amd64.deb"
  echo "    dpkg-deb -x libstdc++6_*_amd64.deb /tmp/qrtext-libstdcxx"
  echo ""
  echo "  然后重新运行本脚本。"
  rm -rf "$WORKDIR"
  exit 1
fi

LIBCPP_MAX=$(strings "$LIBCPP_SRC" | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
echo "  最高 GLIBCXX 版本: $LIBCPP_MAX"

# ═══════════════════════════════════════════════════════════════
#  步骤3：复制新版 libstdc++ 和 libgcc_s 到 AppDir
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[3/6] 复制新版 C++ 运行时到 AppImage...${NC}"

LIB_DIR="$EXTRACT_DIR/usr/lib"

# 3a. 复制实际的 libstdc++ 文件（不是 symlink）
if [ -L "$LIBCPP_SRC" ]; then
  LIBCPP_REAL=$(readlink -f "$LIBCPP_SRC" 2>/dev/null || echo "")
  if [ -n "$LIBCPP_REAL" ] && [ -f "$LIBCPP_REAL" ]; then
    cp -v "$LIBCPP_REAL" "$LIB_DIR/$(basename "$LIBCPP_REAL")"
    # 创建 symlink: libstdc++.so.6 → 实际文件
    ln -sf "$(basename "$LIBCPP_REAL")" "$LIB_DIR/libstdc++.so.6"
    ok "已复制 $(basename "$LIBCPP_REAL") + symlink"
  else
    cp -v "$LIBCPP_SRC" "$LIB_DIR/libstdc++.so.6"
    ok "已复制 libstdc++.so.6"
  fi
else
  cp -v "$LIBCPP_SRC" "$LIB_DIR/libstdc++.so.6"
  ok "已复制 libstdc++.so.6"
fi

# 3b. 复制 libgcc_s.so.1（如果存在新版）
if [ -d "/tmp/qrtext-libstdcxx" ]; then
  LIBGCC=$(find /tmp/qrtext-libstdcxx -name "libgcc_s.so.1" -type f 2>/dev/null | head -1)
  if [ -n "$LIBGCC" ] && [ -f "$LIBGCC" ]; then
    cp -v "$LIBGCC" "$LIB_DIR/libgcc_s.so.1"
    ok "已复制 libgcc_s.so.1（来自 Ubuntu 22.04）"
  fi
fi

# 3c. 检查 AppDir 内是否已有旧版 libstdc++，如有则移除
for existing in "$LIB_DIR"/libstdc++*; do
  [ -f "$existing" ] || continue
  existing_name=$(basename "$existing")
  case "$existing_name" in
    libstdc++.so.6|libstdc++.so.6.0.*)
      if strings "$existing" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
        :
      else
        warn "移除旧版 $existing_name"
        rm -f "$existing"
      fi
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════
#  步骤4：修正 AppRun 脚本
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[4/6] 修正 AppRun 脚本...${NC}"

APPRUN="$EXTRACT_DIR/AppRun"
[ -f "$APPRUN" ] || die "找不到 AppRun 脚本"

cp "$APPRUN" "$APPRUN.bak"

# 4a. 修正硬编码的动态链接器路径
# Tauri AppImage 的 AppRun 可能包含类似：
#   exec /usr/lib/ld-linux-x86-64.so.2 --library-path ... "$APPDIR/usr/bin/qrtext"
# 麒麟系统上 /usr/lib/ld-linux-x86-64.so.2 不存在，需改为标准路径
STANDARD_INTERP="/lib64/ld-linux-x86-64.so.2"

INTERPRETER_FIXES=(
  "/usr/lib/ld-linux-x86-64.so.2"
  "/lib/ld-linux-x86-64.so.2"
)

INTERP_FIXED=false
for bad_path in "${INTERPRETER_FIXES[@]}"; do
  if grep -qF "$bad_path" "$APPRUN" 2>/dev/null; then
    sed -i "s|${bad_path}|${STANDARD_INTERP}|g" "$APPRUN"
    ok "修正动态链接器路径: $bad_path → $STANDARD_INTERP"
    INTERP_FIXED=true
  fi
done

if ! $INTERP_FIXED; then
  # 模糊匹配其他 ld-linux 路径
  FOUND_INTERP=$(grep -oP '/[^\s"]*ld-linux[^\s"]*' "$APPRUN" 2>/dev/null | head -1 || true)
  if [ -n "$FOUND_INTERP" ] && [ "$FOUND_INTERP" != "$STANDARD_INTERP" ]; then
    sed -i "s|${FOUND_INTERP}|${STANDARD_INTERP}|g" "$APPRUN"
    ok "修正动态链接器路径: $FOUND_INTERP → $STANDARD_INTERP"
    INTERP_FIXED=true
  fi
fi

if ! $INTERP_FIXED; then
  warn "未在 AppRun 中找到动态链接器引用（可能格式不同），跳过"
fi

# 4b. 注入 LD_LIBRARY_PATH（确保 AppImage 自带的 libstdc++ 优先加载）
if grep -q '^export LD_LIBRARY_PATH' "$APPRUN" 2>/dev/null; then
  sed -i 's|^export LD_LIBRARY_PATH="|export LD_LIBRARY_PATH="$APPDIR/usr/lib:|' "$APPRUN"
  sed -i "s|^export LD_LIBRARY_PATH='|export LD_LIBRARY_PATH='\$APPDIR/usr/lib:|" "$APPRUN"
  ok "已修改现有 LD_LIBRARY_PATH，插入 \$APPDIR/usr/lib"
else
  sed -i '1a\
# ═══ AppImage 补丁：优先加载自带新版 libstdc++ ═══\
export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:}$LD_LIBRARY_PATH"' "$APPRUN"
  ok "已在 AppRun 开头注入 LD_LIBRARY_PATH"
fi

# ═══════════════════════════════════════════════════════════════
#  步骤5：用 patchelf 修正二进制和关键 .so 文件
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[5/6] 用 patchelf 修正 RPATH/解释器...${NC}"

# 5a. 修正主二进制
MAIN_BIN="$EXTRACT_DIR/usr/bin/qrtext"
if [ -f "$MAIN_BIN" ]; then
  CURRENT_INTERP=$(patchelf --print-interpreter "$MAIN_BIN" 2>/dev/null || echo "")
  if [ -n "$CURRENT_INTERP" ] && [ "$CURRENT_INTERP" != "$STANDARD_INTERP" ]; then
    if [ -e "$STANDARD_INTERP" ] || [ -L "$STANDARD_INTERP" ]; then
      patchelf --set-interpreter "$STANDARD_INTERP" "$MAIN_BIN"
      ok "修正二进制解释器: $CURRENT_INTERP → $STANDARD_INTERP"
    else
      warn "标准解释器 $STANDARD_INTERP 不在构建机上，保留原解释器"
    fi
  fi

  patchelf --set-rpath '$ORIGIN/../lib' "$MAIN_BIN"
  ok "设置二进制 RPATH: \$ORIGIN/../lib"
else
  warn "找不到主二进制 $MAIN_BIN"
fi

# 5b. 修正 webkit2gtk 相关 .so 的 RPATH，确保能找到自带的 libstdc++
echo "  修正 bundled .so 文件的 RPATH..."
find "$EXTRACT_DIR/usr/lib" -name "*.so*" -type f 2>/dev/null | while IFS= read -r so; do
  # 只处理 ELF 文件
  if ! file "$so" 2>/dev/null | grep -q "ELF"; then
    continue
  fi

  EXISTING_RPATH=$(patchelf --print-rpath "$so" 2>/dev/null || echo "")
  # 检查是否需要追加 $ORIGIN
  if [ -z "$EXISTING_RPATH" ]; then
    patchelf --set-rpath '$ORIGIN' "$so" 2>/dev/null || true
  elif ! echo "$EXISTING_RPATH" | grep -q '$ORIGIN'; then
    patchelf --set-rpath "\$ORIGIN:${EXISTING_RPATH}" "$so" 2>/dev/null || true
  fi
done
ok "已修正所有 bundled .so 文件的 RPATH"

# ═══════════════════════════════════════════════════════════════
#  步骤6：重新打包 AppImage
#  格式: [runtime ELF] + [squashfs 文件系统]
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[6/6] 重新打包 AppImage...${NC}"

# 6a. 找到 runtime 与 squashfs 的分界（squashfs superblock magic "hsqs"）
# 注意：runtime ELF 中可能也包含 "hsqs" 字节，需要跳过前 128KB 的误匹配
SQUASHFS_OFFSET=$(grep -abo 'hsqs' "$APPIMAGE" 2>/dev/null | awk -F: '$1 > 131072 {print $1; exit}')

if [ -z "$SQUASHFS_OFFSET" ] || [ "$SQUASHFS_OFFSET" -lt 100000 ]; then
  die "无法定位 AppImage 中的 squashfs 镜像（offset=$SQUASHFS_OFFSET），文件可能已损坏"
fi

echo "  Runtime 头大小: $SQUASHFS_OFFSET 字节"

# 6b. 提取 runtime 头
RUNTIME_HEADER="$WORKDIR/runtime_header.bin"
dd if="$APPIMAGE" of="$RUNTIME_HEADER" bs=1 count="$SQUASHFS_OFFSET" status=none
ok "已提取 runtime 头"

# 6c. 用 mksquashfs 创建新的文件系统镜像
SQUASHFS_NEW="$WORKDIR/new_fs.squashfs"
echo "  正在创建 squashfs 镜像（xz 压缩）..."

mksquashfs "$EXTRACT_DIR" "$SQUASHFS_NEW" \
  -root-owned \
  -noappend \
  -comp xz \
  -b 16384 \
  2>&1 | tail -1

[ -f "$SQUASHFS_NEW" ] || die "mksquashfs 创建镜像失败"
echo "  新镜像大小: $(du -h "$SQUASHFS_NEW" | cut -f1)"

# 6d. 拼接 runtime + squashfs → 新 AppImage
NEW_APPIMAGE="$APPIMAGE"
cat "$RUNTIME_HEADER" "$SQUASHFS_NEW" > "$NEW_APPIMAGE"
chmod +x "$NEW_APPIMAGE"
ok "重新打包完成"
echo "  最终大小: $(du -h "$NEW_APPIMAGE" | cut -f1)"

# ═══════════════════════════════════════════════════════════════
#  验证（不执行 AppImage，避免 CI 环境 segfault）
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[验证] 检查补丁结果...${NC}"

PASS=true

# 检查1：libstdc++ 是否复制到了 AppDir
if [ -f "$EXTRACT_DIR/usr/lib/libstdc++.so.6" ]; then
  GLIBCXX_VER=$(strings "$EXTRACT_DIR/usr/lib/libstdc++.so.6" | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
  if echo "$GLIBCXX_VER" | grep -qE "3\.4\.(29|30|[3-9][0-9])"; then
    ok "libstdc++.so.6 已打包（最高: $GLIBCXX_VER）"
  else
    echo -e "  ${RED}✗ libstdc++.so.6 版本不够新（最高: $GLIBCXX_VER）${NC}"
    PASS=false
  fi
else
  echo -e "  ${RED}✗ libstdc++.so.6 缺失！${NC}"
  PASS=false
fi

# 检查2：AppRun 中 LD_LIBRARY_PATH
if grep -q 'LD_LIBRARY_PATH.*usr/lib' "$APPRUN" 2>/dev/null; then
  ok "AppRun 已设置 \$APPDIR/usr/lib 优先加载"
else
  echo -e "  ${RED}✗ AppRun 缺少 LD_LIBRARY_PATH 设置！${NC}"
  PASS=false
fi

# 检查3：解释器路径
if grep -qF "$STANDARD_INTERP" "$APPRUN" 2>/dev/null; then
  ok "AppRun 使用标准解释器路径 $STANDARD_INTERP"
fi

# 检查4：二进制 RPATH
if [ -f "$MAIN_BIN" ]; then
  BIN_RPATH=$(patchelf --print-rpath "$MAIN_BIN" 2>/dev/null || echo "")
  if echo "$BIN_RPATH" | grep -q 'ORIGIN'; then
    ok "二进制 RPATH: $BIN_RPATH"
  else
    warn "二进制 RPATH 未设置 \$ORIGIN: $BIN_RPATH"
  fi
fi

# 检查5：最终 AppImage 文件完整性
if [ -f "$NEW_APPIMAGE" ]; then
  FINAL_SIZE=$(stat -c%s "$NEW_APPIMAGE" 2>/dev/null || stat -f%z "$NEW_APPIMAGE" 2>/dev/null || echo 0)
  if [ "$FINAL_SIZE" -gt 10000000 ]; then
    ok "AppImage 文件完整（$(du -h "$NEW_APPIMAGE" | cut -f1)）"
  else
    echo -e "  ${RED}✗ AppImage 文件异常小（${FINAL_SIZE} bytes）${NC}"
    PASS=false
  fi
fi

# ── 清理 ──
cd "$ORIG_DIR"
rm -rf "$WORKDIR"

# ── 最终结果 ──
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
if $PASS; then
  echo -e "${GREEN}  ✓ 补丁成功！${NC}"
else
  echo -e "${YELLOW}  ⚠ 补丁完成，但部分检查未通过（见上方）${NC}"
fi
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  已修复的 AppImage: $NEW_APPIMAGE"
echo "  最终大小: $(du -h "$NEW_APPIMAGE" | cut -f1)"
echo ""
echo "  部署到麒麟系统后运行："
echo "    chmod +x $(basename "$NEW_APPIMAGE")"
echo "    ./$(basename "$NEW_APPIMAGE")"
echo ""
echo "  如果仍报错，请运行以下命令诊断："
echo "    ./$(basename "$NEW_APPIMAGE") --appimage-extract"
echo "    ldd squashfs-root/usr/bin/qrtext | grep 'not found'"
echo "    strings squashfs-root/usr/lib/libstdc++.so.6 | grep GLIBCXX | tail -5"
