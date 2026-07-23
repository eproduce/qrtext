# ═══════════════════════════════════════════════════════════════
#  QRTEXT Linux 构建环境（Docker）
#
#  镜像用途：在 CI 或本地构建 deb / rpm / 麒麟自包含 AppImage
#  基础系统：Ubuntu 22.04（webkit2gtk-4.1 原生支持）
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

# ── 4. 预下载 linuxdeploy + appimagetool ──
RUN wget -qO /usr/local/bin/linuxdeploy \
      "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage" \
    && chmod +x /usr/local/bin/linuxdeploy \
    && wget -qO /usr/local/bin/linuxdeploy-plugin-gtk.sh \
      "https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh" \
    && chmod +x /usr/local/bin/linuxdeploy-plugin-gtk.sh \
    && wget -qO /usr/local/bin/appimagetool \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" \
    && chmod +x /usr/local/bin/appimagetool \
    && echo "✓ linuxdeploy + appimagetool 预下载完成"

# ── 5. 入口脚本 ──
COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
