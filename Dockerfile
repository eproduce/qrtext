# ═══════════════════════════════════════════════════════════════
#  QRTEXT Linux 构建环境（Docker）
#
#  镜像用途：在 CI 或本地构建 deb / rpm / 麒麟自包含 AppImage
#  基础系统：Ubuntu 22.04（webkit2gtk-4.1 原生支持）
#
#  【为何用 22.04 而非 20.04？】
#   webkit2gtk-4.1 的 .so 本身是 Ubuntu 22.04 编译的，已链接 glibc 2.35。
#   如果用 20.04（glibc 2.31）构建，bundled glibc 只有 2.31，无法满足
#   webkit2gtk libs 的 GLIBC_2.35 需求。
#   用 22.04 → 编译 + 打包的 glibc 版本一致 → 自包含 AppImage 通过自带
#   ld-linux 加载自带 libc 2.35，完全不碰麒麟系统的 glibc 2.28。
#   麒麟内核 4.19 满足 glibc 2.35 的最低内核要求（3.2+）。
#
#  构建产物（挂载到 /workspace）：
#    src-tauri/target/release/bundle/deb/*.deb
#    src-tauri/target/release/bundle/rpm/*.rpm
#    src-tauri/target/release/bundle/appimage/*.AppImage
#
#  用法：
#    docker build -t qrtext-builder .
#    docker run --rm -v "$PWD":/workspace qrtext-builder
# ═══════════════════════════════════════════════════════════════
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    NODE_VERSION=22

WORKDIR /workspace

# ── 1. 系统依赖（一层搞定，减少层数） ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    # 基础工具
    curl wget ca-certificates gnupg \
    build-essential pkg-config \
    # Tauri v2 GUI 依赖
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libglib2.0-dev \
    # 加密 / 系统
    libssl-dev libdbus-1-dev \
    # AppImage 工具
    patchelf file squashfs-tools \
    # RPM 打包
    rpm \
    # 其他
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Node.js 22 ──
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && node -v && npm -v

# ── 3. Rust ──
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# ── 4. 预下载 + 提取 linuxdeploy / appimagetool（绕过 Docker 无 FUSE 问题） ──
RUN cd /tmp \
    && wget -q "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage" \
    && chmod +x linuxdeploy-x86_64.AppImage \
    && ./linuxdeploy-x86_64.AppImage --appimage-extract >/dev/null 2>&1 \
    && mv squashfs-root /opt/linuxdeploy \
    && ln -s /opt/linuxdeploy/AppRun /usr/local/bin/linuxdeploy \
    && rm linuxdeploy-x86_64.AppImage \
    && echo "✓ linuxdeploy 已提取" \
    && wget -q "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" \
    && chmod +x appimagetool-x86_64.AppImage \
    && ./appimagetool-x86_64.AppImage --appimage-extract >/dev/null 2>&1 \
    && mv squashfs-root /opt/appimagetool \
    && ln -s /opt/appimagetool/AppRun /usr/local/bin/appimagetool \
    && rm appimagetool-x86_64.AppImage \
    && echo "✓ appimagetool 已提取" \
    && wget -qO /usr/local/bin/linuxdeploy-plugin-gtk.sh \
      "https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh" \
    && chmod +x /usr/local/bin/linuxdeploy-plugin-gtk.sh

# ── 5. 入口脚本 ──
COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
