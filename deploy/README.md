# 自部署

## 使用已有反向代理

需要 Docker Compose。保留已有代理和其他服务，在本项目 `deploy/` 下复制 `.env.example` 为 `.env`，设置域名及联系邮箱。准备数据目录：

```bash
mkdir -p state/bobo
sudo chown 1000:1000 state/bobo
chmod 700 state/bobo
```

在 `compose.yaml` 的 `bobo` 服务中添加端口映射（请先确认端口空闲）：

```yaml
    ports:
      - "127.0.0.1:18788:8787"
```

仅启动 Bobo：`docker compose up -d --build bobo`。将现有代理的专用 HTTPS 子域名反代到 `127.0.0.1:18788`。不要启动模板中的 Caddy 服务，以免占用已有 80/443 端口。

## 空闲服务器

如果 80/443 没有其他服务占用，可使用模板内的 Caddy。将域名 DNS 指向服务器、配置 `.env` 并准备上述数据目录后，执行 `docker compose up -d --build`。Caddy 自动管理 HTTPS 证书。

配置下述 SMTP 后打开域名，通过邮箱验证码注册账号，再在其他设备登录同一账号。0.3.0 不需要局域网配对或手动输入共享密钥。`state/bobo` 包含账号数据和推送私钥，`state/caddy-data` 包含 TLS 状态；请备份并保密，不要提交到 Git。

## 自部署原生客户端

网页会连接自身域名，可直接使用。官方 Windows / Android 二进制固定连接官方服务，不能通过自部署网页改变其服务地址。

如需自己的原生客户端，请在源码中统一替换 `bobo.taorenlove.live` 为你的 HTTPS 域名，并重新构建。相关位置包括 `desktop/main.cjs`、`desktop/connection.cjs`、`public/app.js`、Android Java 源码中的连接及更新地址校验、`electron-builder.json` 与 `public/android-version.json`。可以用 `git grep bobo.taorenlove.live` 找到全部引用；保留 HTTPS 和同源地址校验。

发布自己的安装包时同步更新版本号、更新清单及哈希。Windows 更新清单位于 `/downloads/updates/latest.yml`，SHA-512 使用 Base64；Android 清单位于 `/android-version.json`。文件放到数据目录的 `downloads/` 下。先验证安装包，再发布更新清单。不要让自行构建的客户端继续拉取官方更新。

## SMTP 发信配置（0.4.0 必需）

在 `deploy/.env` 填写以下配置（不要提交 `.env`）：

```dotenv
BOBO_SMTP_HOST=smtp.example.com
BOBO_SMTP_PORT=465
BOBO_SMTP_USER=you@example.com
BOBO_SMTP_PASSWORD=邮箱服务提供的SMTP授权码
BOBO_MAIL_FROM=you@example.com
```

465 使用隐式 TLS，587 使用 STARTTLS，均验证服务器证书。发信地址必须是邮件服务允许的地址；自有域名按提供商要求设置 SPF、DKIM、DMARC。容器读取环境变量，修改后重新创建 Bobo 容器。

升级前备份数据目录。已有账号不强制登出，登录后可用当前密码和邮箱验证码绑定邮箱；原来的恢复码仍有效。新注册必须验证邮箱，不能先上线一个没有配置邮件的注册页面。正式切换前验证注册、绑定与找回邮件能实际收到，再发布安装包和更新清单。

0.4.0 服务端新增 `email.cjs` 和 Nodemailer 依赖，需一起部署。验证码记录写入原 JSON 数据库，但不保存验证码明文。SMTP 错误不会向客户端暴露供应商凭据。
