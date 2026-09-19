# 部署指南 · 部署到任何地方

> 本站是**零构建步骤**的 Node.js 应用：没有打包、没有外部数据库、没有 Redis。
> 只要机器上有 **Node.js ≥ 18**，把仓库拷过去就能跑；容器 / PaaS / NAS 也都支持。
>
> 一句话部署：`npm install && npm start`

---

## 目录

1. [零配置首次启动](#一零配置首次启动)
2. [数据目录与持久化（最重要）](#二数据目录与持久化最重要)
3. [环境变量速查](#三环境变量速查)
4. [平台部署示例](#四平台部署示例)
5. [反向代理与 HTTPS](#五反向代理与-https)
6. [升级、备份与迁移](#六升级备份与迁移)
7. [上线安全检查清单](#七上线安全检查清单)
8. [故障排查](#八故障排查)

---

## 一、零配置首次启动

```bash
git clone https://github.com/penyuhao/genshin-hub.git
cd genshin-hub
npm install          # 根目录即可：postinstall 会自动装 server/ 依赖
npm start            # 默认 http://0.0.0.0:3001
```

**什么都不用配。** 首次启动会自动完成：

| 自动完成的事 | 位置 | 说明 |
|---|---|---|
| 生成 JWT 签名密钥 | `DATA_DIR/secrets.json` | 48 字节随机，持久化后重启不掉线 |
| 生成管理员随机密码 | `DATA_DIR/auth.json`（bcrypt） | **明文只在控制台打印一次** |
| 生成站点配置 | `DATA_DIR/config.json` | 由随代码发布的 `config.default.json` 派生 |
| 创建上传/备份目录 | `DATA_DIR/uploads`、`DATA_DIR/backups` | 自动 `mkdir -p` |

首次启动的终端输出长这样：

```
  ┌────────────────────────────────────────────────────────────────┐
  │  首次启动：已自动完成初始化（无需手写 .env 即可使用）          │
  ├────────────────────────────────────────────────────────────────┤
  │  • JWT 签名密钥已随机生成并保存到：                            │
  │      server/data/secrets.json                                  │
  │  • 管理员账号（请立即登录后台修改密码）：                       │
  │      用户名：admin                                              │
  │      密码　：xxxx-xxxx-xxxx-xxxx                                │
  └────────────────────────────────────────────────────────────────┘
```

> 密码**只打印一次**。容器里用 `docker logs <容器名>` 查看；忘了就删掉 `DATA_DIR/auth.json` 重启，会重新生成一个新的。

想固定这些值（推荐生产环境）：复制模板并填写即可 —— 填了就以 `.env` 为准。

```bash
cp server/.env.example server/.env
# 编辑 server/.env：至少设置 ADMIN_PASSWORD 与 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # 生成 JWT_SECRET
node -e "console.log(require('bcryptjs').hashSync('你的密码',12))"          # 可选：生成 bcrypt 哈希
```

---

## 二、数据目录与持久化（最重要）

**所有会被写入的东西都在 `DATA_DIR` 里**，代码目录可以完全只读。

```
DATA_DIR/                    默认 server/data，可用环境变量覆盖
├── config.json              站点配置（后台改的东西）
├── auth.json                管理员凭据（bcrypt 哈希）
├── kuma.json                数据源密钥（Kuma URL / API Key）
├── secrets.json             自动生成的 JWT 密钥
├── backups/                 配置快照（每次保存前自动生成，保留 20 份）
├── uploads/
│   ├── images/              后台上传的背景图 / Logo
│   ├── fonts/               后台上传的架空文字字体
│   └── videos/              后台上传的画廊背景视频（支持 Range 请求）
└── logs/                    （可选）PM2 等日志目录
```

| 场景 | 做法 |
|---|---|
| 裸机 / VPS | 默认即可，数据在 `server/data` |
| Docker | 挂载卷 + `DATA_DIR=/data`（见下方 compose） |
| PaaS（Railway / Render / Fly…） | 设置 `DATA_DIR=/data` 并挂载持久卷；**没有卷时重启会丢配置** |
| 只读文件系统（K8s 只读根） | `DATA_DIR` 指向可写卷即可，代码目录不需可写 |
| 想放别处 | `DATA_DIR=/var/lib/genshin-hub`（绝对路径或相对仓库根都支持） |

> 启动日志会明确打印当前的**数据目录**与**上传目录**；如果目录不可写，会给出橙色告警和修复建议（而不是运行时才报错）。

---

## 三、环境变量速查

全部有默认值，**一个都不填也能跑**。完整模板见 [`server/.env.example`](../server/.env.example)。

### 服务

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 监听端口（PaaS 常注入此变量，直接生效） |
| `HOST` | `0.0.0.0` | `0.0.0.0` 所有网卡（容器/PaaS）；`127.0.0.1` 仅本机 |
| `NODE_ENV` | `development` | 生产请设 `production`：启用 HSTS、隐藏 5xx 细节、静态资源长缓存、**严格限流** |
| `TRUST_PROXY` | `1` | 反代层数；直连填 `false`，也可 `loopback` / `true` / 数字 |

### 目录

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATA_DIR` | `server/data` | 运行时数据根目录（容器挂卷就改这个） |
| `UPLOAD_DIR` | `DATA_DIR/uploads` | 上传文件目录（`images/`、`fonts/`、`videos/`） |
| `FRONTEND_DIR` | `frontend` | 静态资源目录 |
| `MAX_IMAGE_MB` | `5` | 背景图/Logo 上传上限 |
| `MAX_FONT_MB` | `12` | 字体上传上限 |
| `MAX_VIDEO_MB` | `64` | **背景视频上传上限**（配大文件时记得同步放宽反代限制） |

### 数据源（Uptime Kuma）

三项留空 = **Mock 演示模式**（内置 8 个原神主题监控服务）。也可以登录后台「数据源设置」里填，**面板优先**。

| 变量 | 说明 |
|---|---|
| `KUMA_URL` / `KUMA_STATUS_SLUG` | Kuma 地址与状态页 slug |
| `KUMA_API_KEY` | API Key（推荐，Basic Auth：username 留空） |
| `KUMA_USERNAME` / `KUMA_PASSWORD` | 仅 Socket 实时通道需要 |
| `KUMA_SOCKET_ENABLED` | `true` 且填了上面两项时启用 Socket |
| `POLL_INTERVAL` / `CACHE_TTL` | 轮询秒数 / 缓存秒数，默认 30 / 30 |

### 安全与凭据

| 变量 | 默认 | 说明 |
|---|---|---|
| `ALLOWED_ORIGIN` | 本机两个地址 | CORS 白名单（逗号分隔） |
| `API_RATE_LIMIT_MAX` | `100` | 每 IP 每 15 分钟 API 上限 |
| `LOGIN_RATE_LIMIT_MAX` | `10` | 每 IP 每 15 分钟登录失败上限 |
| `RATE_LIMIT_BYPASS_LOOPBACK` | `false` | 仅非生产生效，本机调试豁免 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 空 | 留空则首次启动自动生成随机密码 |
| `ADMIN_PASSWORD_HASH` | 空 | bcrypt 哈希，优先级高于明文 |
| `JWT_SECRET` | 空 | 留空则自动生成并存入 `DATA_DIR/secrets.json` |
| `JWT_EXPIRES_IN` | `24h` | 登录令牌有效期 |
| `CAPTCHA_BYPASS_TOKEN` | 空 | 自动化测试旁路令牌，**生产留空** |

---

## 四、平台部署示例

### 4.1 裸机 / VPS（Linux、macOS、Windows 通用）

```bash
git clone https://github.com/penyuhao/genshin-hub.git /opt/genshin-hub
cd /opt/genshin-hub
npm ci                 # 有 lockfile 时用 ci 更快更稳（会自动装 server 依赖）
NODE_ENV=production PORT=3001 npm start
```

长期运行建议交给下面的 systemd 或 PM2。

### 4.2 systemd（Linux 推荐）

```ini
# /etc/systemd/system/genshin-hub.service
[Unit]
Description=Genshin Hub
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/genshin-hub
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/genshin-hub
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
# 只允许写数据目录与临时目录
ReadWritePaths=/var/lib/genshin-hub
ProtectSystem=strict
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/genshin-hub && sudo chown www-data /var/lib/genshin-hub
sudo systemctl daemon-reload && sudo systemctl enable --now genshin-hub
sudo journalctl -u genshin-hub -f      # 首次启动密码在这里
```

### 4.3 PM2

仓库自带 `server/ecosystem.config.js`：

```bash
npm i -g pm2
cd server
DATA_DIR=/var/lib/genshin-hub pm2 start ecosystem.config.js
pm2 save && pm2 startup
pm2 logs genshin-hub          # 首次启动密码
```

### 4.4 Docker

```bash
docker build -t genshin-hub .
docker run -d --name genshin-hub \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e DATA_DIR=/data \
  -v genshin-hub-data:/data \
  --restart unless-stopped \
  genshin-hub

docker logs genshin-hub       # 首次启动会打印随机管理员密码
```

### 4.5 Docker Compose（最省事）

```bash
docker compose up -d --build
docker compose logs -f genshin-hub
# 打开 http://localhost:3001  （后台 /#admin）
```

`docker-compose.yml` 已把 `./data` 挂成 `/data`，一份卷包含配置 + 凭据 + 备份 + 上传。想复用 `server/.env`，取消 compose 里那行注释即可。

### 4.6 PaaS（Railway / Render / Fly.io / Koyeb / Zeabur…）

| 设置项 | 值 |
|---|---|
| Build Command | `npm install`（或 `npm ci`） |
| Start Command | `npm start` |
| 环境变量 | `NODE_ENV=production`、`DATA_DIR=/data` |
| 持久卷 | **挂到 `/data`**（不挂卷的话容器重建会丢配置与上传） |
| 端口 | 平台注入的 `PORT` 会自动生效（无需手改） |

> ⚠️ 多数免费 PaaS 的磁盘是临时的：不挂卷时每次重启都会重新生成管理员密码、丢掉配置。生产请务必备卷，或至少把 `ADMIN_PASSWORD` / `JWT_SECRET` 设为环境变量。

### 4.7 Kubernetes（要点）

```yaml
containers:
  - name: genshin-hub
    image: genshin-hub:latest
    ports: [{ containerPort: 3001 }]
    env:
      - { name: NODE_ENV, value: production }
      - { name: DATA_DIR, value: /data }
      - { name: TRUST_PROXY, value: "true" }   # Ingress 后面
    volumeMounts:
      - { name: data, mountPath: /data }
    readinessProbe:
      httpGet: { path: /health, port: 3001 }
      initialDelaySeconds: 5
volumes:
  - name: data
    persistentVolumeClaim: { claimName: genshin-hub-data }
```

> 副本数建议 **1**：配置与缓存是进程内的文件存储，多副本不会自动同步。

### 4.8 群晖 / 威联通 NAS

用「Container Manager / Docker」套件：

1. 镜像：本仓库 `Dockerfile` 构建，或在容器里挂载仓库目录
2. 卷：`/docker/genshin-hub/data → /data`
3. 环境：`NODE_ENV=production`、`DATA_DIR=/data`、`PORT=3001`
4. 端口：`3001:3001`
5. 日志里找首次启动的管理员密码

---

## 五、反向代理与 HTTPS

完整示例见仓库根目录 [`nginx.conf.example`](../nginx.conf.example)（含 HTTP→HTTPS 跳转、Let's Encrypt、gzip、上传体积、**SSE 免缓冲**）。

关键只有两点：

```nginx
location /api/status/events {     # SSE：必须关闭缓冲，否则实时推送失效
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}

location / {                      # 其余请求
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

配套设置：

- **`TRUST_PROXY=1`**（默认）让限流拿到真实客户端 IP；直连公网请设 `false` 防止伪造 `X-Forwarded-For` 绕过限流
- 上 HTTPS 后设 `NODE_ENV=production`，自动启用 HSTS
- 把正式域名加进 `ALLOWED_ORIGIN`（同域部署可保持默认）
- 客户端上传上限要 **≥ 服务端上限**：图片 5MB / 字体 12MB / 视频 64MB（都可用 `MAX_*_MB` 调整），
  Nginx 需写 `client_max_body_size 80m;`，否则会先被反代用 **413** 拦掉（前端会提示"文件过大"）
- **视频背景建议**：MP4（H.264 + AAC，或纯视频无音轨）、1080p、10~20 秒、5MB 以内；
  视频走同源 `/uploads/videos/*` 静态服务并支持 **Range 请求**（播放器可拖进度、不必整段下载），
  若前面还有 CDN，记得让 CDN 透传 `Range` 头并缓存 `206`

---

## 六、升级、备份与迁移

### 升级

```bash
cd genshin-hub
git pull
npm install          # 依赖有变化时
# 重启进程（pm2 restart genshin-hub / systemctl restart genshin-hub / docker compose up -d --build）
```

配置与上传都在 `DATA_DIR`，**升级不会丢**。站点配置有版本迁移机制（例如 v1→v2 自动把旧「资讯区」迁移为「快捷入口」），旧配置无需手工处理。

### 备份

```bash
# 一份卷 = 全部状态
tar -czf genshin-hub-backup-$(date +%F).tar.gz -C /var/lib genshin-hub

# 只备份站点配置（后台每次保存也会自动生成快照，可在「备份与还原」里一键回滚）
cp server/data/config.json ~/config-$(date +%F).json
```

### 迁移到新机器

1. 新机器拉仓库、`npm install`
2. 把旧机器的 `DATA_DIR`（默认 `server/data`）整个拷过去
3. `npm start` —— 配置、凭据、上传、数据源密钥全部原样生效

> 注意：跨机器迁移后旧登录令牌仍有效（`JWT_SECRET` 在 `secrets.json` 里跟着搬了）。若想强制所有人重新登录，去后台「账号与安全」改一次密码即可（会自增令牌版本）。

---

## 七、上线安全检查清单

- [ ] `NODE_ENV=production`（HSTS + 严格限流 + 隐藏错误细节）
- [ ] 用强密码登录一次后台，并**在「账号与安全」里改成自己的密码**
- [ ] 确认登录验证码是**开启**状态（账号与安全 → 登录图形验证码）
- [ ] HTTPS 已配置（Let's Encrypt / 平台自带证书）
- [ ] 反代在，且 `TRUST_PROXY` 与拓扑一致；直连公网设 `false`
- [ ] `CAPTCHA_BYPASS_TOKEN` 留空（除非在跑自动化测试）
- [ ] `ALLOWED_ORIGIN` 只包含自己的域名
- [ ] `DATA_DIR` 指向持久卷，且已加入备份计划
- [ ] 不需要公网访问时，`HOST=127.0.0.1` 或防火墙只放行 80/443
- [ ] `docker logs` / 启动日志里的首次密码已妥善保存（或已改密）

---

## 八、故障排查

| 现象 | 原因与处理 |
|---|---|
| 启动即退出，日志说数据目录不可写 | `DATA_DIR` 指向只读路径。改到可写目录或给容器挂卷 |
| 容器重建后管理员密码变了 / 配置全丢 | 没挂持久卷。挂载 `/data` 并设 `DATA_DIR=/data` |
| `EADDRINUSE` | 端口被占用：改 `PORT`，或找出占用进程 |
| 登录提示"登录尝试过于频繁" | 登录失败限流（默认 10 次/15 分钟）。等待或用 `LOGIN_RATE_LIMIT_MAX` 调整 |
| 刷新页面偶发 429 | API 限流命中（默认 100 次/15 分钟/IP）。调整 `API_RATE_LIMIT_MAX`；本机调试可开 `RATE_LIMIT_BYPASS_LOOPBACK=true` |
| 状态页数字不动了 | 检查 `/api/status/connection`；Kuma 挂了会回退缓存并标 `stale`，页面会显示"数据可能过期" |
| SSE 不推送（点开面板一直"连接中"） | 反代没关缓冲。照抄第五节配置 |
| 后台登录成功但刷新又变未登录 | 浏览器禁用了 localStorage，或跨域访问导致令牌未保存。用同域访问 |
| 上传图片报 500 / EROFS | 数据目录只读。检查 `DATA_DIR` 挂载与权限 |
| 上传视频报 413 | 反代先拦了：把 `client_max_body_size` 加到 ≥ `MAX_VIDEO_MB`（示例配置为 `80m`） |
| 上传视频提示"不是有效的视频容器" | 文件类型不符（改扩展名的假视频会被服务端识别并拒收）。转成 H.264 的 MP4 再传 |
| 背景视频不自动播放 | 浏览器策略：必须**静音**才能自动播放（后台开关默认开）；iOS 低电量模式也会拒绝，此时显示封面图 |
| 忘了管理员密码 | 删掉 `DATA_DIR/auth.json` 重启 → 回退到 `.env` 的 `ADMIN_PASSWORD`；两者都没有会重新生成并打印 |
| 中文乱码 / 时间不对 | 容器时区：设 `TZ=Asia/Shanghai` |
| 页面样式正常但没动画 | 系统开了"减少动态效果"，或后台「功能开关」里关掉了对应模块 |
