# SV8 可重置系统 · 总手册

一套「出厂 U 盘」：插上开机 → Ubuntu 桌面自动装好 → harness + 全部 agent 自动部署 → 拔盘完事。任何时候系统玩坏了，插盘重来。

## 一、首次制作（本机 Windows 上一次）

```powershell
# 1. 下 Ubuntu Desktop 26.04 ISO（任一镜像站）
#    https://releases.ubuntu.com/26.04/ubuntu-26.04-desktop-amd64.iso

# 2. Rufus / balenaEtcher 把 ISO 写入 U 盘（选「ISO 镜像模式」，别选 DD 模式）

# 3. 注入出厂配置 + 离线包（U 盘盘符假设 E:）
cd D:\omp\agent-harness\factory
powershell -ExecutionPolicy Bypass -File prepare-usb.ps1 -UsbDrive E:
```

完成后 U 盘结构：
```
E:\
  nocloud\user-data      ← 无人值守安装配置（账号/分区/btrfs/自动部署）
  nocloud\meta-data
  bundle\app\            ← harness 源码
  bundle\agents\         ← codex/omp/kimi Linux 二进制
  bundle\electron-...zip ← Electron Linux 运行时
  boot\grub\grub.cfg     ← 已被打上 autoinstall 参数
```

## 二、装机 / 重置（SV8 上）

1. U 盘插 SV8 → 开机选 U 盘启动
2. 什么都不用点——自动分区（btrfs）、建账号、装系统、部署 harness + agents
3. 装完自动重启 → 拔 U 盘 → 进桌面，harness 全屏自启

默认账号 `sv8` / 密码 `sv8admin`，**装完第一件事改密码**：`passwd`

## 三、日常防呆（Timeshift 快照）

出厂装的是 btrfs 文件系统。装完后跑一次：

```bash
sudo apt install timeshift
sudo timeshift --create --comments "出厂基线"
```

之后任何时候玩坏了：开机进恢复模式 → Timeshift → 选基线快照 → 30 秒还原，不用重装。

## 四、网络说明

- 装机阶段：有线插校园网口自动 DHCP；如果校园网要认证，先连手机热点装完再换
- autoinstall 的 `packages` 需要网络（curl/git/python3 等）；bundle 里 harness+agents 全离线
- 远程：装完后装 ToDesk Linux 版（UU 不支持 Linux）

## 五、文件清单

| 文件 | 作用 |
|---|---|
| `user-data` / `meta-data` | Ubuntu autoinstall 无人值守配置 |
| `prepare-usb.ps1` | Windows 端一键注入 U 盘 |
| `late-setup.sh` | 系统装完首启自动部署（harness+agents+电源+自启） |
| `bundle/` | 离线内容物（harness + Electron + 3 个 agent） |

## 六、恢复其他机器

这套 U 盘是通用的：任何 x86_64 小主机插上都装出同一套环境（harness 自动探测该机装了哪些 CLI）。
