#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  SV8 彻底清盘 —— 装 Kubuntu 前用（把 macOS/Ubuntu/EFI 残留全清掉）
#
#  用法（在 Kubuntu 试用桌面或现有 Ubuntu 里）：
#    sudo bash wipe-sv8.sh
#
#  安全设计：列盘 → 你手输盘名 → 拒绝清当前系统盘/U盘 → 大写 WIPE 二次确认
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

echo "════════════════════════════════════════════"
echo "  SV8 彻底清盘工具"
echo "════════════════════════════════════════════"
echo ""
echo "当前磁盘："
lsblk -dpno NAME,SIZE,MODEL | grep -v loop || true
echo ""

read -rp "输入要清空的磁盘名（比如 sda 或 nvme0n1）： " DISK
DEV="/dev/$DISK"
if [ ! -b "$DEV" ]; then
  echo "错误：$DEV 不是块设备"; exit 1
fi

# 安全检查：不许清当前系统所在盘
ROOT_SRC=$(findmnt -n -o SOURCE / 2>/dev/null || echo "")
if [[ -n "$ROOT_SRC" && "$ROOT_SRC" == *"$DISK"* ]]; then
  echo "拒绝执行：$DEV 是当前正在运行的系统所在盘"; exit 1
fi

echo ""
echo "将要彻底清空：$DEV"
lsblk -p "$DEV" || true
echo ""
echo "⚠️  这会删掉该盘上的一切：macOS、Ubuntu、EFI、所有分区、所有数据"
read -rp "确认执行？输入大写 WIPE 继续: " CONFIRM
if [ "$CONFIRM" != "WIPE" ]; then
  echo "已取消（什么都没动）"; exit 0
fi

echo ""
echo "==> 卸载该盘所有挂载…"
umount "${DEV}"* 2>/dev/null || true
swapoff -a 2>/dev/null || true

echo "==> 清除分区表与文件系统签名…"
wipefs -a --force "$DEV"
if command -v sgdisk >/dev/null 2>&1; then
  sgdisk --zap-all "$DEV" 2>/dev/null || true
fi

echo "==> 零写盘头 64MB（清 GPT 备份头等残留）…"
dd if=/dev/zero of="$DEV" bs=1M count=64 conv=fsync status=none 2>/dev/null || dd if=/dev/zero of="$DEV" bs=1M count=64 conv=fsync

sync
echo ""
echo "✅ $DEV 已完全清空（分区表、签名、盘头全没）。"
echo "   现在可以开装 Kubuntu（安装器会重新分区）。"
