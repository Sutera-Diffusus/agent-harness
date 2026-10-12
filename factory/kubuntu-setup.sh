#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  SV8 · Kubuntu 部署脚本（装完系统后跑，全程离线）
#
#  用法：sudo bash kubuntu-setup.sh
#  前置：Kubuntu 24.04 已装好（Calamares 向导装完即可）
# ═══════════════════════════════════════════════════════════════
set -e
export DEBIAN_FRONTEND=noninteractive
BUNDLE="$(cd "$(dirname "$0")" && pwd)/bundle"
HOME_U=$(eval echo ~${SUDO_USER:-$USER})
REAL_USER=${SUDO_USER:-$USER}

log() { echo "[kubuntu-setup] $1"; }

# ── 1. 电源：永不休眠 ──
log "电源策略（24/7 控制台）"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# ── 2. harness 组装（离线） ──
log "harness 部署"
mkdir -p $HOME_U/harness/node_modules/electron
cp -r $BUNDLE/app/* $HOME_U/harness/
unzip -q -o $BUNDLE/electron-v33.2.0-linux-x64.zip -d $HOME_U/harness/node_modules/electron/dist
echo electron > $HOME_U/harness/node_modules/electron/path.txt
chmod +x $HOME_U/harness/node_modules/electron/dist/electron 2>/dev/null || true

# ── 3. agent CLI（离线） ──
log "agent CLI"
mkdir -p $HOME_U/.local/bin /tmp/factory-ag
tar -xzf $BUNDLE/agents/codex-x86_64-unknown-linux-musl.tar.gz -C /tmp/factory-ag
cp /tmp/factory-ag/codex-x86_64-unknown-linux-musl $HOME_U/.local/bin/codex
cp $BUNDLE/agents/omp-linux-x64 $HOME_U/.local/bin/omp
mkdir -p /tmp/factory-ag/kimi-x
tar -xzf $BUNDLE/agents/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz -C /tmp/factory-ag/kimi-x
cp /tmp/factory-ag/kimi-x/kimi $HOME_U/.local/bin/kimi 2>/dev/null || cp /tmp/factory-ag/kimi-x/bin/kimi $HOME_U/.local/bin/kimi
chmod +x $HOME_U/.local/bin/codex $HOME_U/.local/bin/omp $HOME_U/.local/bin/kimi 2>/dev/null || true

for rc in $HOME_U/.bashrc $HOME_U/.zshrc; do
  [ -f "$rc" ] || touch "$rc"
  grep -q 'local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
done

# ── 4. harness 开机自启（KDE 自动登录 + 自启） ──
log "自动登录 + 自启"
# KDE 自动登录：/etc/sddm.conf.d/autologin.conf
mkdir -p /etc/sddm.conf.d
cat > /etc/sddm.conf.d/autologin.conf <<EOF
[Autologin]
User=$REAL_USER
Session=plasma
EOF

mkdir -p $HOME_U/.config/autostart
cat > $HOME_U/.config/autostart/harness.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Harness
Exec=$HOME_U/harness/node_modules/electron/dist/electron $HOME_U/harness --start-maximized
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

# ── 5. 归属修正 ──
chown -R $REAL_USER:$REAL_USER $HOME_U

log "完成。重启后进 KDE 桌面，harness 全屏自启。"
