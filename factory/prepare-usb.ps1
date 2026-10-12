# SV8 出厂 U 盘制作（Windows 端运行）
# 用法：先用 Rufus/balenaEtcher 把 Ubuntu ISO 写入 U 盘（ISO 镜像模式），然后：
#   powershell -ExecutionPolicy Bypass -File prepare-usb.ps1 -UsbDrive E:
param([Parameter(Mandatory=$true)][string]$UsbDrive)

$ErrorActionPreference = "Stop"
$usb = $UsbDrive.TrimEnd('\') + '\'
$factory = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==> 目标 U 盘: $usb"

# 1. 检查 U 盘里有 Ubuntu 安装器
if (!(Test-Path "${usb}boot\grub\grub.cfg")) {
    Write-Error "U 盘里没找到 Ubuntu 安装器（boot\grub\grub.cfg 不存在）。先用 Rufus/balenaEtcher 把 ISO 写进去（ISO 镜像模式）。"
    exit 1
}

# 2. 复制 autoinstall 配置到 nocloud/
Write-Host "==> 写入无人值守配置 (nocloud/)"
New-Item -ItemType Directory -Force -Path "${usb}nocloud" | Out-Null
Copy-Item "$factory\user-data" "${usb}nocloud\user-data" -Force
Copy-Item "$factory\meta-data" "${usb}nocloud\meta-data" -Force

# 3. 复制 bundle（harness + agents + electron）
Write-Host "==> 复制出厂包 (bundle/)"
Copy-Item -Recurse -Force "$factory\bundle" "${usb}bundle"

# 4. 改 grub.cfg：默认启动项加 autoinstall 参数
Write-Host "==> 打 autoinstall 引导参数"
$grub = "${usb}boot\grub\grub.cfg"
$txt = Get-Content $grub -Raw
if ($txt -notmatch 'autoinstall') {
    # 在默认启动项的 linux 行末尾加参数（以 --- 结尾的行）
    $txt = $txt -replace '(linux\s+/casper/vmlinuz[^\n]*?)\s*---', '$1 autoinstall ds=nocloud;s=/cdrom/nocloud/ ---'
    Set-Content $grub $txt -NoNewline
    Write-Host "    grub.cfg 已加 autoinstall"
} else {
    Write-Host "    grub.cfg 已有 autoinstall"
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════"
Write-Host "  U 盘做好了：$usb"
Write-Host ""
Write-Host "  插到 SV8 → 开机选 U 盘启动 → 全自动装系统+部署"
Write-Host "  装完自动重启 → 拔 U 盘 → 完成"
Write-Host "  默认账号 sv8 / sv8admin（装完记得改密码）"
Write-Host "═══════════════════════════════════════════════════"
