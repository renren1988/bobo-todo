# 啵啵待办 · Bobo Todo 🌱

把小事交给小球，把时间留给生活。

一个可爱的跨设备待办应用：Windows 桌面悬浮球、Android 客户端与网页版，登录同一账号即可同步，无需处于同一个 Wi-Fi。

<p align="center"><img src="public/icon.svg" width="128" alt="啵啵待办图标"></p>

## 功能

- 按截止时间排序，无截止时间的事项放在后面。
- 每件事项可独立设置提醒时间，默认提前 30 分钟。
- 工作、学习、生活分类，以及完成状态管理。
- 注册、登录与恢复码找回密码；不同账号的待办相互隔离。
- Windows 悬浮小球、原生通知、自选安装目录与应用内更新。
- Android 系统闹钟提醒与 APK 更新下载。
- 支持自行部署 Node.js 服务与 HTTPS 域名。

## 使用

[打开网页版](https://bobo.taorenlove.live/) · [Windows 0.3.0](https://bobo.taorenlove.live/downloads/BoboTodo-0.3.0-Windows-Setup.exe) · [Android 0.3.0](https://bobo.taorenlove.live/downloads/BoboTodo-0.3.0-Android.apk)

注册后请保存恢复码。电脑与手机登录同一个账号即可共享待办。当前官方客户端连接上面的官方服务；自行部署时请阅读 [部署说明](deploy/README.md)。

## 本地运行

需要 Node.js 22.12 或更新版本、npm。

```bash
npm ci
npm start
```

浏览器打开 `http://localhost:8787`。数据保存在项目内 `.runtime/server/`，请备份该目录，不要提交到 Git。修改端口可设置 `PORT`；修改监听地址可设置 `HOST`。

```bash
npm test                  # API、排序、提醒、账号隔离和恢复测试
npm run desktop           # 需要有图形桌面的系统
npx playwright install chromium
npm run test:ui           # 浏览器跨设备账号同步测试
```

Electron 和 Android 客户端默认连接官方 HTTPS 服务；本地网页使用本地服务。测试使用临时测试账号，不依赖生产账号。

## 构建

Windows：在 Windows 开发机执行 `npm ci`，然后 `npm run build:win`。生成 NSIS 安装器和 ZIP，支持选择安装路径。构建输出位于 `releases/v0.3.0/windows/`。开源配置使用 electron-builder 标准安装器；官方 0.3.0 曾使用自定义 NSIS 脚本，保留在 `scripts/build-windows-installer.py` 供参考，它需要额外 NSIS 工具链。新的标准安装器未在 Windows 实机验证。

Android：目前使用 Python 3、JDK 17 和 Android SDK 命令行工具构建，无 Gradle。将 JDK 17 放到 `.runtime/tooling/amazon-corretto-17*/`，将包含 `aapt2`、`d8`、`zipalign`、`apksigner` 的 build-tools 目录及包含 `android.jar` 的 Android 35 platform 目录放到 `.runtime/android-sdk/` 的直属子目录，然后运行：

```bash
mkdir -p .runtime/tmp
python3 scripts/build-android.py
```

构建脚本会在 `.runtime/signing/` 创建自己的签名密钥，请妥善保管。自行签名的 APK 不能覆盖官方不同签名的 APK；发布时需要使用自己的包名、更新地址和签名。官方签名私钥不在仓库内。

## 结构

| 路径 | 用途 |
| --- | --- |
| `server.cjs` / `accounts.cjs` | HTTP API、账号、数据存储和推送 |
| `public/` | 网页界面与共享任务逻辑 |
| `desktop/` | Electron 悬浮球和 Windows 集成 |
| `android/` | Android WebView、通知与系统闹钟 |
| `deploy/` | Docker Compose 与 HTTPS 部署示例 |
| `tests/` | 自动化测试 |

## 已知限制

服务端使用原子写入的 JSON 文件，适合个人或小规模使用，不支持多个服务实例同时写一个数据目录。密码使用 scrypt 哈希；账号恢复依赖恢复码，目前没有邮箱验证或邮件找回。

Windows 需应用运行才能提醒，关机或休眠时不能即时提醒。Android 后台刷新受系统与省电设置影响，刚新增的紧急事项可在手机打开应用确认同步。Android 暂无跨应用悬浮球。Windows 安装包未做 Authenticode 签名。实机通知、安装和自动更新仍需在目标设备验证。

## 许可证

[MIT](LICENSE)。第三方依赖遵循各自的许可证。
