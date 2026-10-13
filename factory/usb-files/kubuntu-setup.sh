#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  SV8 · Kubuntu 24.04 部署脚本 v2(装完系统后跑)
#
#  用法(U盘插上后):
#    sudo bash /media/sv8/Ventoy/sv8-bundle/kubuntu-setup.sh
#  或从网上下载的脚本跑( bundle 仍在 U 盘):
#    sudo SV8_BUNDLE=/media/sv8/Ventoy/sv8-bundle/bundle bash ~/setup.sh
#
#  可重复执行;有失败的步骤会标 [错],修完重跑即可。
# ═══════════════════════════════════════════════════════════════
set -u
export DEBIAN_FRONTEND=noninteractive
BUNDLE="${SV8_BUNDLE:-$(cd "$(dirname "$0")" && pwd)/bundle}"
REAL_USER=${SUDO_USER:-$USER}
HOME_U=$(eval echo ~"$REAL_USER")
FAIL=0

log() { echo "[setup] $1"; }
err() { echo "[setup][错] $1"; FAIL=1; }

[ "$(id -u)" = "0" ] || { echo "要用 sudo 跑"; exit 1; }
[ -d "$BUNDLE" ] || { echo "找不到 bundle 目录:$BUNDLE(检查 U 盘挂载 / SV8_BUNDLE)"; exit 1; }

# ── 0. 联网时补 Electron 运行库(Kubuntu 24.04 是 t64 包名) ──
if ping -c1 -W2 mirrors.aliyun.com >/dev/null 2>&1 || ping -c1 -W2 archive.ubuntu.com >/dev/null 2>&1; then
  log "联网:补 Electron 运行库"
  apt-get update -qq || true
  apt-get install -y -qq \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libgtk-3-0t64 libgbm1 libasound2t64 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
    2>/dev/null \
  || apt-get install -y -qq \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libgtk-3-0 libgbm1 libasound2 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
  || log "apt 补库没成功(可能源不通),后面自检会告诉你缺不缺"
else
  log "离线:跳过运行库补齐(桌面版一般已自带)"
fi

# ── 1. 电源:永不休眠 ──
log "电源策略(24/7 控制台)"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# ── 2. harness 组装 ──
log "harness 文件 → $HOME_U/harness"
mkdir -p "$HOME_U/harness/node_modules/electron"
cp -r "$BUNDLE"/app/* "$HOME_U/harness/" || err "复制 app 失败"
rm -rf "$HOME_U/harness/node_modules/electron/dist"
if command -v unzip >/dev/null 2>&1; then
  unzip -q -o "$BUNDLE"/electron-v33.2.0-linux-x64.zip -d "$HOME_U/harness/node_modules/electron/dist" || err "electron 解压失败"
else
  python3 -m zipfile -e "$BUNDLE"/electron-v33.2.0-linux-x64.zip "$HOME_U/harness/node_modules/electron/dist" || err "electron 解压失败"
fi
EL="$HOME_U/harness/node_modules/electron/dist/electron"
chmod +x "$EL" "$HOME_U/harness/node_modules/electron/dist/chrome_crashpad_handler" 2>/dev/null || true
# chrome-sandbox 必须是 root 4755,否则 Electron 起不来
if [ -f "$HOME_U/harness/node_modules/electron/dist/chrome-sandbox" ]; then
  chown root:root "$HOME_U/harness/node_modules/electron/dist/chrome-sandbox" && chmod 4755 "$HOME_U/harness/node_modules/electron/dist/chrome-sandbox" || err "chrome-sandbox 权限设置失败"
fi
echo electron > "$HOME_U/harness/node_modules/electron/path.txt"

# ── 3. agent CLI ──
log "agent CLI → $HOME_U/.local/bin"
mkdir -p "$HOME_U/.local/bin" /tmp/factory-ag
rm -rf /tmp/factory-ag/* 2>/dev/null || true
if tar -xzf "$BUNDLE/agents/codex-x86_64-unknown-linux-musl.tar.gz" -C /tmp/factory-ag 2>/dev/null; then
  cp /tmp/factory-ag/codex-x86_64-unknown-linux-musl "$HOME_U/.local/bin/codex" || err "codex 复制失败"
else
  err "codex 解压失败"
fi
cp "$BUNDLE/agents/omp-linux-x64" "$HOME_U/.local/bin/omp" || err "omp 复制失败"
mkdir -p /tmp/factory-ag/kimi-x
if tar -xzf "$BUNDLE/agents/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz" -C /tmp/factory-ag/kimi-x 2>/dev/null; then
  cp /tmp/factory-ag/kimi-x/kimi "$HOME_U/.local/bin/kimi" 2>/dev/null || cp /tmp/factory-ag/kimi-x/bin/kimi "$HOME_U/.local/bin/kimi" 2>/dev/null || err "kimi 复制失败"
else
  err "kimi 解压失败"
fi
chmod +x "$HOME_U/.local/bin/codex" "$HOME_U/.local/bin/omp" "$HOME_U/.local/bin/kimi" 2>/dev/null || true

# ── 3.5 远程操控 ToDesk(bundle 里带了 deb 才装) ──
TODESK_DEB=$(ls "$BUNDLE"/todesk*.deb 2>/dev/null | head -1)
if [ -n "$TODESK_DEB" ]; then
  log "ToDesk 离线安装:$TODESK_DEB"
  apt-get install -y -qq "$TODESK_DEB" 2>/dev/null \
  || { dpkg -i "$TODESK_DEB" || true; apt-get install -y -qq -f || true; }
  systemctl enable todeskd 2>/dev/null || true
else
  log "bundle 里没有 ToDesk 包,跳过(可选)。要远程操控:SV8 浏览器开 todesk.com/linux.html → Debian/Ubuntu/Mint (x64) 下载,然后: sudo apt install ~/Downloads/todesk*.deb"
fi

for rc in "$HOME_U/.bashrc" "$HOME_U/.zshrc"; do
  [ -f "$rc" ] || touch "$rc"
  grep -q 'local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
done

# 手动启动命令:终端输 harness 即开
cat > "$HOME_U/.local/bin/harness" <<EOF
#!/bin/bash
exec $HOME_U/harness/node_modules/electron/dist/electron $HOME_U/harness "\$@"
EOF
chmod +x "$HOME_U/.local/bin/harness"

# ── 4. 自动登录 + 自启 + 菜单入口 ──
log "自动登录(sddm) + 开机自启 + 开始菜单入口"
mkdir -p /etc/sddm.conf.d
cat > /etc/sddm.conf.d/autologin.conf <<EOF
[Autologin]
User=$REAL_USER
Session=plasma
EOF

mkdir -p "$HOME_U/.config/autostart"
cat > "$HOME_U/.config/autostart/harness.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Agent Harness
Exec=$HOME_U/harness/node_modules/electron/dist/electron $HOME_U/harness --start-maximized
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

cat > /usr/share/applications/agent-harness.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Agent Harness
Comment=CLI agent 宫格终端
Exec=$HOME_U/harness/node_modules/electron/dist/electron $HOME_U/harness --start-maximized
Terminal=false
Categories=Utility;
EOF

# ── 5. 归属 ──
chown -R "$REAL_USER:$REAL_USER" "$HOME_U"

# ── 6. 自检(装没装好,一目了然) ──
log "自检:"
if [ -x "$EL" ]; then
  MISSING=$(ldd "$EL" 2>/dev/null | grep "not found" || true)
  if [ -z "$MISSING" ]; then
    echo "  [✓] electron 运行库齐全"
  else
    err "electron 缺库(联网后跑下面那句 apt):
$MISSING
  → sudo apt install -y libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgtk-3-0t64 libgbm1 libasound2t64"
  fi
else
  err "electron 主程序不存在(解压步骤失败了)"
fi
for c in codex omp kimi harness; do
  [ -x "$HOME_U/.local/bin/$c" ] && echo "  [✓] $c" || err "$c 没装上"
done
[ -f "$HOME_U/.config/autostart/harness.desktop" ] && echo "  [✓] 开机自启项" || err "自启项没写上"
if dpkg -l todesk 2>/dev/null | grep -q '^ii'; then echo "  [✓] ToDesk(远程操控)"; else echo "  [-] ToDesk 未装(可选;SV8 浏览器开 todesk.com/linux.html 下 x64 deb 装上)"; fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  log "全部完成 ✓ 现在可以: sudo reboot(重启后 harness 全屏自启)"
  log "手动开: 开始菜单搜「Harness」,或终端输 harness"
else
  echo "[setup] 有失败步骤(见上面 [错] 行)。修好后重跑本脚本即可,可重复执行。"
fi
