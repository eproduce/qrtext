#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  麒麟 V10 SP1 本地兼容性诊断脚本
#
#  在麒麟系统上运行此脚本，无需联网，无需 root：
#   1. 检查系统 glibc / libstdc++ 版本
#   2. 检查 AppImage 内部依赖是否缺失
#   3. 给出明确的诊断结论
#
#  用法：
#   bash check-compat.sh ./QRTEXT-x86_64.AppImage
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(ls *.AppImage 2>/dev/null | head -1)
fi

if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "用法: bash $0 <QRTEXT-x86_64.AppImage>"
  exit 1
fi

echo ""
echo "════════════════════════════════════════════"
echo "  QRTEXT 麒麟兼容性诊断"
echo "════════════════════════════════════════════"
echo ""

# ── 1. 系统环境 ──
echo "【1】系统环境"
echo "  OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"' || echo '未知')"
echo "  架构: $(uname -m)"
echo "  内核: $(uname -r)"

GLIBC_VER=$(/lib64/ld-linux-x86-64.so.2 --version 2>/dev/null | head -1 || ldd --version 2>/dev/null | head -1 || echo "未知")
echo "  glibc: $GLIBC_VER"

SYSTEM_LIBCPP=$(ldconfig -p 2>/dev/null | grep libstdc++ | head -1 | awk '{print $NF}' || echo "")
if [ -n "$SYSTEM_LIBCPP" ] && [ -f "$SYSTEM_LIBCPP" ]; then
  LIBCPP_MAX=$(strings "$SYSTEM_LIBCPP" 2>/dev/null | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
  echo "  系统 libstdc++ 最高: $LIBCPP_MAX"
else
  echo "  系统 libstdc++: 未找到"
fi
echo ""

# ── 2. AppImage 基本信息 ──
echo "【2】AppImage"
echo "  文件: $APPIMAGE"
echo "  大小: $(du -h "$APPIMAGE" | cut -f1)"
chmod +x "$APPIMAGE"

TMPDIR=$(mktemp -d)
cd "$TMPDIR"
echo "  正在提取..."

if "$APPIMAGE" --appimage-extract >/dev/null 2>&1; then
  EXTRACT_DIR="$TMPDIR/squashfs-root"
  echo "  ${GREEN}✓ AppImage 可正常提取${NC}"
else
  echo "  ${RED}✗ AppImage 提取失败！文件可能损坏${NC}"
  rm -rf "$TMPDIR"
  exit 1
fi
echo ""

# ── 3. 检查内部 libstdc++ ──
echo "【3】内部 libstdc++"
INTERNAL_LIBCPP="$EXTRACT_DIR/usr/lib/libstdc++.so.6"
if [ -f "$INTERNAL_LIBCPP" ]; then
  INTERNAL_MAX=$(strings "$INTERNAL_LIBCPP" | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1)
  echo "  ${GREEN}✓ 已打包 libstdc++.so.6（最高: $INTERNAL_MAX）${NC}"
else
  echo "  ${RED}✗ 未打包 libstdc++.so.6！${NC}"
fi
echo ""

# ── 4. 检查 AppRun ──
echo "【4】AppRun"
APPRUN="$EXTRACT_DIR/AppRun"
if [ -f "$APPRUN" ]; then
  if grep -q 'LD_LIBRARY_PATH.*usr/lib' "$APPRUN" 2>/dev/null; then
    echo "  ${GREEN}✓ AppRun 已设置 LD_LIBRARY_PATH${NC}"
  else
    echo "  ${YELLOW}⚠ AppRun 未设置 LD_LIBRARY_PATH${NC}"
  fi

  INTERP=$(grep -oP '/[^\s"]*ld-linux[^\s"]*' "$APPRUN" 2>/dev/null | head -1 || echo "")
  if [ -n "$INTERP" ]; then
    echo "  AppRun 解释器: $INTERP"
    if [ -f "$INTERP" ]; then
      echo "  ${GREEN}✓ 解释器存在${NC}"
    else
      echo "  ${RED}✗ 解释器 $INTERP 不存在！${NC}"
      echo "    尝试查找系统解释器..."
      find /lib* /usr/lib* -name "ld-linux*" -type f 2>/dev/null | head -3
    fi
  fi
else
  echo "  ${RED}✗ AppRun 缺失！${NC}"
fi
echo ""

# ── 5. 检查二进制依赖 ──
echo "【5】二进制依赖"
BIN="$EXTRACT_DIR/usr/bin/qrtext"
if [ -f "$BIN" ]; then
  echo "  二进制: $BIN"

  # glibc 需求
  MAX_GLIBC=$(objdump -T "$BIN" 2>/dev/null | grep -oP 'GLIBC_\d+\.\d+' | sort -Vu | tail -1 || echo "未知")
  echo "  最高 glibc 需求: $MAX_GLIBC"

  # 缺失的库
  echo ""
  echo "  缺失的共享库:"
  MISSING=$(LD_LIBRARY_PATH="$EXTRACT_DIR/usr/lib" ldd "$BIN" 2>/dev/null | grep "not found" || echo "")
  if [ -z "$MISSING" ]; then
    echo "  ${GREEN}✓ 所有依赖库都能找到${NC}"
  else
    echo "  ${RED}$MISSING${NC}"
  fi

  # 关键库版本检查
  echo ""
  echo "  关键依赖版本检查:"
  LD_LIBRARY_PATH="$EXTRACT_DIR/usr/lib" ldd "$BIN" 2>/dev/null | while IFS= read -r line; do
    case "$line" in
      *libstdc++*|*libwebkit2gtk*|*libjavascriptcoregtk*|*libgtk*|*libglib*|*libc.so*)
        echo "    $line"
        ;;
    esac
  done
else
  echo "  ${RED}✗ 二进制缺失！${NC}"
fi
echo ""

# ── 6. 结论 ──
echo "════════════════════════════════════════════"
echo "  诊断结论"
echo "════════════════════════════════════════════"

HAS_ERROR=0

# 检查 libstdc++
if ! strings "$INTERNAL_LIBCPP" 2>/dev/null | grep -q "GLIBCXX_3.4.29"; then
  echo "  ${RED}✗ libstdc++ 版本不够新（需要 GLIBCXX_3.4.29+）${NC}"
  HAS_ERROR=1
fi

# 检查缺失的库
MISSING_COUNT=$(LD_LIBRARY_PATH="$EXTRACT_DIR/usr/lib" ldd "$BIN" 2>/dev/null | grep -c "not found" || echo 0)
if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "  ${RED}✗ 有 $MISSING_COUNT 个依赖库缺失${NC}"
  HAS_ERROR=1
fi

# 检查解释器
INTERP_PATH=$(grep -oP '/[^\s"]*ld-linux[^\s"]*' "$APPRUN" 2>/dev/null | head -1 || echo "")
if [ -n "$INTERP_PATH" ] && [ ! -f "$INTERP_PATH" ]; then
  echo "  ${RED}✗ 动态链接器 $INTERP_PATH 不存在${NC}"
  HAS_ERROR=1
fi

if [ "$HAS_ERROR" -eq 0 ]; then
  echo ""
  echo "  ${GREEN}✓ 未发现兼容性问题，AppImage 应该可以运行${NC}"
  echo ""
  echo "  尝试运行:"
  echo "    ./$(basename "$APPIMAGE")"
else
  echo ""
  echo "  ${RED}发现兼容性问题，需要修复后再运行${NC}"
fi

# ── 清理 ──
cd /
rm -rf "$TMPDIR"
