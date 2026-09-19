# 原神功能快捷站 · Genshin Hub

> 提瓦特旅行者手册 —— 一个**零构建步骤**的全栈站点：原神主题画廊 + Uptime Kuma 服务监控 + 全可视化配置后台。
> 前端 HTML5 / 原生 ES Module / Canvas / Three.js ｜ 后端 Node.js + Express ｜ 单进程同源托管，开箱即跑。

![license](https://img.shields.io/badge/license-MIT-e8c877)
![node](https://img.shields.io/badge/node-%3E%3D18-7fd8d8)
![frontend](https://img.shields.io/badge/frontend-vanilla%20ESM-e8c877)
![tests](https://img.shields.io/badge/tests-52%20%2B%2067%20passing-4ade80)
![audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-4ade80)

**亮点**

- 📦 **部署到任何地方**：零构建、零外部依赖（无数据库 / 无 Redis），Node ≥18 即可跑；**首次启动自动生成 JWT 密钥与随机管理员密码**，不写 `.env` 也能用；数据全部集中在 `DATA_DIR`，容器/PaaS/NAS 挂一个卷就行 → [部署指南](docs/deployment.md)
- 🎴 **11 屏沉浸式画廊**：开场「原神」+ 七国（蒙德/璃月/稻妻/须弥/枫丹/纳塔/至冬）+ 挪德卡莱 + 坎瑞亚 + 哥伦比娅；**滚动吸附**——滚轮滚一下就切一整屏、手机滑一下切一屏（原生 `scroll-snap`，不劫持滚轮，刷新后位置正确）
- ✨ **五层动画系统**：Three.js Shader 星空（10000 点独立闪烁）、三环反向星环、月亮自转呼吸、鼠标光晕与粒子拖尾、点击涟漪、Ken Burns、视差滚动
- 🔤 **7 套 HoYo-Glyphs 架空文字**：提瓦特/稻妻/须弥/坎瑞亚（含层岩巨渊变体）/赤冠/Font Ainee，**11 屏轮换分配、相邻两屏必不相同**；
  中文自动回退衬线（HoYo 字体不含汉字），但每屏标题的字距/字重/描边/倾斜各不相同，滚动时视觉上"每屏换一种字"
- ✨ **标题节奏**：逐字上浮（无模糊，避免看起来像"字形在变"）→ **紧接着光幕扫过**（延迟 0.72s，与逐字动画收尾对齐）
- 📊 **Kuma 状态面板**：后端合并数据 + 30s 缓存 + `stale` 降级 + SSE 实时推送 + 心跳折线图
- 🛠 **全可视化后台**：站点/画廊/主题/导航/开关/音乐/下载/关于/快捷入口/字体/**数据源**/**账号安全**/备份还原，共 13 个区块，改完即时生效
- 🔐 **安全不妥协**：CSP、CORS 白名单、双层限流、**图形验证码**、zod 校验、JWT + bcrypt、改密吊销旧令牌、前端零密钥

> 无 Uptime Kuma？内置 **Mock 演示模式**，8 个原神主题监控服务带历史心跳，配好 Kuma 后自动切换真实数据。

---

## 目录

1. [快速开始](#一快速开始)
2. [功能清单](#二功能清单)
3. [目录结构](#三目录结构)
4. [环境变量](#四环境变量)
5. [对接真实 Uptime Kuma](#五对接真实-uptime-kuma)
6. [管理后台使用](#六管理后台使用)
7. [字体与图片素材](#七字体与图片素材)
8. [13 阶段实施对照表](#八13-阶段实施对照表)
9. [安全加固总结](#九安全加固总结)
10. [测试与验收](#十测试与验收)
11. [部署指南](#十一部署指南)
12. [与方案的差异说明](#十二与方案的差异说明)
13. [常见问题](#十三常见问题)
14. [更新记录](#十四更新记录)
15. [许可](#十五许可)

---

## 一、快速开始

```bash
# 0) 克隆仓库
git clone https://github.com/penyuhao/genshin-hub.git
cd genshin-hub

# 1) 安装依赖（根目录即可：postinstall 会自动安装 server/ 依赖；前端零依赖，Three.js 已内置）
npm install

# 2) 启动 —— 无需任何配置，默认 Mock 演示模式
npm start
#    首次启动会自动生成 JWT 密钥与随机管理员密码，并打印在控制台（只打印一次）

# 3) 打开
#    站点首页   http://localhost:3001
#    管理后台   http://localhost:3001/#admin
#    健康检查   http://localhost:3001/health
```

默认监听 `0.0.0.0:3001`（容器/PaaS 友好）。本机只想自己访问就 `HOST=127.0.0.1 npm start`。

**想固定管理员密码与密钥**（生产推荐，可选）：

```bash
cp server/.env.example server/.env
# 编辑 server/.env：至少填 ADMIN_PASSWORD 与 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
```

| 项目 | 说明 |
|---|---|
| 管理员账号 | `ADMIN_USERNAME`（默认 `admin`）；密码：`.env` 里填的，或首次启动控制台打印的那个 |
| 登录保护 | 图形验证码 + 登录限流（每 IP 15 分钟 10 次失败） |
| 数据目录 | 默认 `server/data`，可用 `DATA_DIR` 指到任意可写目录/挂载卷 |
| 部署到各种平台 | 见 **[docs/deployment.md](docs/deployment.md)**（裸机 / systemd / PM2 / Docker / Compose / PaaS / K8s / NAS + Nginx + 故障排查） |

> 前端静态文件与 API 由**同一个 Node 服务**托管，天然同源，无需配置跨域、也不会有密钥泄露到前端的问题。
>
> 数据源（Uptime Kuma）、管理员账号密码、图形验证码开关**全部可以在管理后台里改**，改完即时生效、无需重启进程。

> 前端静态文件与 API 由**同一个 Node 服务**托管，天然同源，无需配置跨域、也不会有密钥泄露到前端的问题。
>
> 数据源（Uptime Kuma）、管理员账号密码、图形验证码开关**全部可以在管理后台里改**，改完即时生效、无需重启进程。

---

## 二、功能清单

### 视觉与动画（阶段 4、5）

| 特效 | 实现 | 位置 |
|---|---|---|
| Shader 星空（10000 点，逐点独立闪烁） | Three.js `ShaderMaterial` + `phase` 属性 | `frontend/js/starfield.js` |
| 星环系统（3 环、不同速度反向旋转） | 顶点着色器按 `ringIndex` 计算旋转角 | `frontend/js/starfield.js` |
| 月亮自转 + 光晕呼吸 | SVG 月坑纹理横向循环 + `moonGlow` 关键帧 | `frontend/css/main.css`、`animations.css` |
| 11 屏纵向滚动画廊 | **11 屏**：开场「原神」+ 七国（蒙德/璃月/稻妻/须弥/枫丹/纳塔/至冬）+ 挪德卡莱 + 坎瑞亚 + 哥伦比娅角色特写；**滚动吸附，一次手势一屏** | `frontend/js/gallery.js`、`css/main.css` |
| 文字可读性保障 | 可调背景遮罩（`--scrim`）+ 文字底衬光晕 + 双层阴影 + 背景降饱和/降亮度 | `css/main.css`、后台「主题编辑」 |
| 视口级导航（圆点/下滚提示） | 圆点在 body 层级（不受视图 transform 影响），滚动时自动高亮当前屏；提示只在首屏出现 | `index.html`、`css/main.css` |
| 标题逐字浮现（错开 60ms） | 每个汉字一个 `<span class="char">` + 递增延迟 | `gallery.js#animateTitle` |
| 金属光扫过 | `.title-shine` 屏幕混合高光带循环扫过 | `animations.css#metalShine` |
| Ken Burns | 激活屏背景 26s 缓慢缩放平移 | `animations.css#kenBurns` |
| 视差滚动 | 背景层位移为内容的一半（`--parallax-y`） | `effects.js#setupParallax` |
| 鼠标光晕 + 粒子拖尾 | CSS 变量跟随 + 前景 Canvas 粒子生命周期 | `effects.js` |
| 点击涟漪 | 点击处扩散金色圆环 | `effects.js#setupRipples` |
| 按钮描边流动 | `conic-gradient` 旋转边框 | `main.css .download-card::before` |
| 视图切换过渡 | 旧视图淡出上移、新视图淡入 | `animations.css#viewIn/viewOut` |

### 数据与后台（阶段 1、2、3.5、3.6、10）

- **首页画廊下方内容**（四个模块，全部无需配置即可用）：
  1. **服务状态速览** —— 实时在线/异常数 + 进入完整面板
  2. **提瓦特索引** —— 11 屏变成可点击导航卡片，点一下跳回那一屏
  3. **快捷入口** —— 外链卡片（后台「快捷入口」可改，清空即整块隐藏）
  4. **站点运行信息** —— 数据源模式、监控概况、数据更新时间、服务运行时长、实时连接数
  **本站不提供任何资讯内容**（兑换码、卡池、活动公告等已全部移除），符合未备案域名的内容合规要求。
- **Kuma 中转**：后端合并 `status-page` 与 `heartbeat` 两份数据（心跳接口不含监控名称），前端只认 `/api/status/*`
- **Mock 演示模式**：未配置 Kuma 时使用内置模拟数据（8 个原神主题服务、带历史心跳与状态漂移），配置后自动切换真实数据
- **缓存与降级**：30 秒内存缓存；Kuma 不可用时返回最后一次成功数据并标记 `stale: true`；前端显示"数据可能过期"徽标
- **SSE 实时推送**：后端轮询比对变化指纹，仅在有变化时推送；SSE 断开自动切换为 60 秒兜底轮询（不狂刷）
- **可选 Socket 通道**：`KUMA_SOCKET_ENABLED=true` 且提供账号密码时，走 Kuma Socket.IO 推送（阶段 10）
- **配置后台**：11 个区块可视化编辑（站点/画廊/主题/导航/功能开关/音乐/下载/关于/快捷入口/字体/备份），每次保存前自动备份（保留 20 份，可一键还原）
- **图片与字体上传**：图片 ≤5MB（png/jpg/webp/gif）、字体 ≤12MB（ttf/otf/woff/woff2），服务端生成文件名，杜绝路径穿越

### 安全（阶段 1、9、11）

Helmet CSP / HSTS（生产）/ X-Frame-Options: DENY、CORS 显式白名单、API 限流（默认 100 次/15 分钟，可用 `API_RATE_LIMIT_MAX` 调整）、登录限流（默认 10 次/15 分钟）、**图形验证码（防暴力破解，纯 Node 生成 PNG 位图，一次性 + 5 分钟过期）**、zod 边界校验、请求体 10KB（配置接口 256KB）、JWT + bcrypt、**改密即刻吊销所有旧令牌（tokenVersion）**、恒定时间比较防时序侧信道、配置写入原子化 + 自动备份、前端零密钥。

> 本机开发时可在 `.env` 里设 `RATE_LIMIT_BYPASS_LOOPBACK=true` 跳过来自 127.0.0.1 的限流，方便反复调试与跑测试；**生产环境（`NODE_ENV=production`）始终严格限流**，该开关默认关闭。

### 手机端（阶段 8）

汉堡全屏菜单（逐条下滑入场）、画廊月亮移至标题上方居中、粒子数量减半、卡片单列、触摸目标 ≥44×44px、iOS 输入框 16px 防缩放、无横向滚动条。

---

## 三、目录结构

```
web_nas/
├── server/                       # Node.js 后端
│   ├── index.js                  # 入口：启动自举 → 安全中间件 → 静态托管 → API → SPA 回退
│   ├── paths.js                  # 路径与数据目录统一管理（DATA_DIR / UPLOAD_DIR / FRONTEND_DIR）
│   ├── cache.js                  # node-cache 封装
│   ├── .env                      # 环境变量（含密钥，已被 .gitignore 排除）
│   ├── .env.example              # 环境变量模板（含全部可选项与默认值）
│   ├── routes/
│   │   ├── status.js             # Kuma 状态 + SSE + 状态页跳转
│   │   ├── config.js             # 配置读写 + 备份还原
│   │   ├── auth.js               # 图形验证码 / 登录 / 账号安全
│   │   ├── settings.js           # 数据源（Kuma）运行时设置
│   │   └── media.js              # 字体清单 + 图片/字体上传
│   ├── services/
│   │   ├── bootstrap.js          # 首次启动自举（自动生成密钥与随机密码）
│   │   ├── captcha.js            # 图形验证码（纯 Node 生成 PNG 位图）
│   │   ├── authService.js        # 管理员凭据（bcrypt）
│   │   ├── kumaRest.js           # Kuma REST 调用与数据合并
│   │   ├── kumaSocket.js         # 可选 Socket.IO 通道
│   │   ├── kumaConfig.js         # 数据源运行时设置
│   │   ├── mockKuma.js           # Mock 数据源
│   │   ├── statusService.js      # 缓存 / 降级 / 轮询 / 广播中枢
│   │   ├── sseBus.js             # SSE 客户端注册表
│   │   ├── configService.js      # 配置读写（原子写入 + 备份）
│   │   └── fontService.js        # 字体自动发现
│   ├── middleware/
│   │   ├── security.js           # Helmet / CORS / 限流
│   │   ├── auth.js               # JWT 校验
│   │   └── validate.js           # zod 全部区块 schema
│   ├── ecosystem.config.js       # PM2 部署配置
│   └── data/                     # 默认数据目录（DATA_DIR）
│       ├── config.default.json   # 出厂默认配置（随代码发布）
│       └── …                     # 运行时生成：config.json / auth.json / kuma.json /
│                                 #   secrets.json / backups/ / uploads/（均已 gitignore）
├── frontend/                     # 静态前端（无构建步骤）
│   ├── index.html
│   ├── css/{fonts,main,animations,responsive}.css
│   ├── js/
│   │   ├── main.js               # 启动编排
│   │   ├── config.js             # 配置加载（接口 → 缓存 → 默认值）
│   │   ├── router.js             # hash 路由与视图过渡
│   │   ├── gallery.js            # 画廊
│   │   ├── starfield.js          # 星空 + 星环
│   │   ├── effects.js            # 粒子 / 光晕 / 涟漪 / 视差 / 滚动揭示
│   │   ├── tools.js              # Kuma 面板
│   │   ├── admin.js              # 管理后台
│   │   ├── fonts.js              # 字体自动发现与 @font-face 注入
│   │   ├── util.js               # 工具函数（安全 DOM 构建等）
│   │   └── vendor/three.module.js
│   ├── fonts/                    # 7 套 HoYo-Glyphs 架空文字（woff2，96KB）
│   └── images/
│       ├── hero1~10.svg          # 程序化生成的国家/地区背景（27KB 全部）
│       ├── gallery/              # 真实美术素材（哥伦比娅 5120×2160 → 1920×1080 webp）
│       ├── logo.svg / favicon.svg / moon-craters.svg
│       └── uploads/              # 后台上传的图片
└── tests/
    ├── smoke.mjs                 # 跨平台冒烟测试（Windows/Linux/macOS 通用，29 项）
    ├── api-smoke.ps1             # 后端接口冒烟测试（PowerShell，52 项）
    ├── frontend-dom.mjs          # 前端 DOM 集成测试（67 项）
    └── sse-live.mjs              # SSE 实时推送验证

docs/
├── deployment.md                 # 部署到任何地方：裸机 / systemd / PM2 / Docker / PaaS / K8s / NAS
└── 原始开发方案.md                # 本项目的源需求文档（13 阶段开发方案）

# 部署相关（仓库根目录）
├── Dockerfile                    # 单容器镜像（非 root + 数据卷 + HEALTHCHECK）
├── docker-compose.yml            # 一键起站（./data 卷持久化，零前置文件）
├── nginx.conf.example            # 反向代理 + HTTPS + SSE 免缓冲
├── LICENSE                       # MIT（含第三方素材声明）
└── .dockerignore / .gitignore / .gitattributes
```

---

## 四、环境变量

> **全部有默认值，一个都不填也能跑**：首次启动会自动生成 JWT 密钥（存 `DATA_DIR/secrets.json`）与随机管理员密码（bcrypt 存 `DATA_DIR/auth.json`，明文只打印一次）。
> 大部分配置也**不需要改这里**：Uptime Kuma 数据源、管理员账号密码、验证码开关都能在管理后台里改。

编辑 `server/.env`（完整模板见 `server/.env.example`）：

### 服务与目录

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 监听端口（PaaS 注入的 `PORT` 自动生效） |
| `HOST` | `0.0.0.0` | `0.0.0.0` 所有网卡（容器/PaaS）；`127.0.0.1` 仅本机 |
| `NODE_ENV` | `development` | 生产设 `production`：HSTS + 隐藏 5xx 细节 + 长缓存 + 严格限流 |
| `TRUST_PROXY` | `1` | 反代层数；直连填 `false`，也可 `loopback` / `true` / 数字 |
| `DATA_DIR` | `server/data` | **运行时数据根目录**（配置/凭据/备份/上传/密钥），容器挂卷改这里 |
| `UPLOAD_DIR` | `DATA_DIR/uploads` | 上传文件目录 |
| `FRONTEND_DIR` | `frontend` | 静态资源目录 |

### 数据源与安全

| 变量 | 默认 | 说明 |
|---|---|---|
| `KUMA_URL` / `KUMA_STATUS_SLUG` | 空 | 留空即 Mock 演示模式；面板里填过则以面板为准 |
| `KUMA_API_KEY` | 空 | API Key（Basic Auth：username 留空、password 填 Key） |
| `KUMA_USERNAME` / `KUMA_PASSWORD` | 空 | 仅 Socket 实时通道需要 |
| `KUMA_SOCKET_ENABLED` | `false` | `true` 且填了账号密码时启用 Socket |
| `POLL_INTERVAL` / `CACHE_TTL` | `30` / `30` | 轮询与缓存秒数 |
| `ALLOWED_ORIGIN` | 本机两个地址 | CORS 白名单（逗号分隔） |
| `API_RATE_LIMIT_MAX` | `100` | API 限流（每 IP / 15 分钟） |
| `LOGIN_RATE_LIMIT_MAX` | `10` | 登录失败限流（每 IP / 15 分钟） |
| `RATE_LIMIT_BYPASS_LOOPBACK` | `false` | 仅非生产生效，本机调试豁免 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / 空 | 留空则首次启动自动生成随机密码 |
| `ADMIN_PASSWORD_HASH` | 空 | bcrypt 哈希，优先级高于明文 |
| `JWT_SECRET` | 空 | 留空则自动生成并存入 `DATA_DIR/secrets.json` |
| `JWT_EXPIRES_IN` | `24h` | 令牌有效期 |
| `CAPTCHA_BYPASS_TOKEN` | 空 | 自动化测试旁路令牌，**生产留空** |

> 运行时数据都在 `DATA_DIR`（默认 `server/data`）下，已被 `.gitignore` 排除：
> `config.json`（站点配置）、`kuma.json`（数据源密钥）、`auth.json`（管理员 bcrypt 哈希）、`secrets.json`（自动生成的 JWT 密钥）、`backups/`（配置快照）、`uploads/`（上传的图片与字体）。

### 生成 bcrypt 密码哈希（生产推荐）

```bash
node -e "console.log(require('bcryptjs').hashSync('你的新密码', 12))"
# 把输出填进 ADMIN_PASSWORD_HASH，并清空 ADMIN_PASSWORD
```

---

## 五、对接真实 Uptime Kuma

1. 在 Kuma 中创建**状态页**，记下 slug（如 `my-status`），确认处于「公开」状态。
2. 在 Kuma 中生成 **API Key**（设置 → API 密钥），设置最小作用域与过期时间。
3. 填入 `server/.env`：

```env
KUMA_URL=https://kuma.example.com
KUMA_STATUS_SLUG=my-status
KUMA_API_KEY=uk1_xxxxxxxxxxxxxxxx
```

4. 重启服务，访问 `http://localhost:3001/api/status/connection` 确认：

```json
{ "ok": true, "mode": "live", "configured": true, "latency": 42, "monitors": 8 }
```

对接说明：

- 后端只使用 `GET /api/status-page/{slug}` 与 `GET /api/status-page/heartbeat/{slug}` 两个公开端点；
- 心跳接口**不返回监控名称**，后端以 `monitorID` 为键与状态页数据合并后输出统一结构；
- **前端永远拿不到 Kuma 地址**：卡片点击跳转的是后端 `/api/status/open`，由服务端 302 跳转到真实状态页（Mock 模式下返回一张说明页）；
- Kuma 挂掉时接口返回上次成功数据 + `stale: true`，页面显示告警徽标而不是白屏。

### 5.1 完整接口一览

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/health` | 公开 | 健康检查（含数据源模式、SSE 连接数） |
| GET | `/api/status/monitors` | 公开 | 合并后的监控列表 + 摘要 + 心跳历史 |
| GET | `/api/status/summary` | 公开 | 整体状态摘要 |
| GET | `/api/status/heartbeat/:id` | 公开 | 指定监控的心跳历史 |
| GET | `/api/status/connection` | 公开 | 数据源连接状态（含 Socket/SSE 信息） |
| GET | `/api/status/events` | 公开 | **SSE 实时推送**（初始快照 + 变化广播） |
| GET | `/api/status/open` | 公开 | 302 跳转到 Kuma 状态页（Mock 模式返回说明页） |
| GET | `/api/config` | 公开 | 完整站点配置 |
| GET | `/api/config/:section` | 公开 | 单区块配置 |
| GET | `/api/config/sections` | 公开 | 可用区块清单 |
| GET | `/api/fonts` | 公开 | 已发现字体清单 |
| POST | `/api/auth/login` | 公开 | 登录（**需图形验证码**） |
| GET | `/api/auth/captcha` | 公开 | 取图形验证码（PNG data URI，答案只在服务端） |
| GET | `/api/auth/public-settings` | 公开 | 登录页所需公开信息（是否需要验证码） |
| GET | `/api/auth/check` | 管理员 | 校验令牌 |
| POST | `/api/auth/logout` | 公开 | 登出（前端清令牌） |
| GET/PUT | `/api/auth/settings` | 管理员 | 读取/开关图形验证码 |
| PUT | `/api/auth/credentials` | 管理员 | 修改管理员账号密码（改密后旧令牌全失效） |
| GET/PUT | `/api/settings/kuma` | 管理员 | 读取/保存数据源设置（保存即热重载） |
| POST | `/api/settings/kuma/test` | 管理员 | 测试 Kuma 连接（不落盘） |
| PUT | `/api/config` · `/api/config/:section` | 管理员 | 更新配置（zod 校验 + 自动备份） |
| GET | `/api/config/backups` · POST `/api/config/restore` | 管理员 | 快照列表 / 一键还原 |
| POST | `/api/uploads/image` · `/api/uploads/font` | 管理员 | 上传图片 / 字体 |

---

## 六、管理后台使用

访问 `http://localhost:3001/#admin`（该视图不在导航中显示，属于隐藏入口）。

| 区块 | 能改什么 |
|---|---|
| 站点设置 | 标题、副标题、Logo、favicon、页脚 |
| 画廊管理 | 增删/排序画廊屏，改标题、副标题、描述、背景图（可直接上传）、字体、标题颜色、按钮文案与跳转 |
| 主题编辑 | 9 个配色 + 圆角 + 卡片阴影 + **背景遮罩强度（觉得背景花就拉高）**，**实时预览** |
| 导航管理 | 导航项文案、顺序、显隐 |
| 功能开关 | 星空 / 星环 / 月亮 / 粒子 / 鼠标层 / 视差 / Kuma 面板 / 背景音乐 |
| 背景音乐 | 音源地址与音量（留空则隐藏播放按钮） |
| 下载管理 | 下载卡片（图标、标题、描述、链接、标签） |
| 关于编辑 | 关于页区块（换行自动分段） |
| 快捷入口 | 首页画廊下方的外链卡片（清空则整块隐藏；**站内不提供资讯内容**） |
| 字体管理 | 登记/上传架空文字字体 |
| 数据源设置 | **在面板里填写 Uptime Kuma 地址 / slug / API Key / 轮询间隔 / 缓存时长**，支持「测试连接」与「保存并热重载」，密钥只存 `server/data/kuma.json` |
| 账号与安全 | 修改管理员用户名/密码（bcrypt 存 `server/data/auth.json`）、开关图形验证码；改密后所有登录会话立即失效 |
| 备份与还原 | 查看快照、一键还原、上传字体文件 |

每个区块除可视化表单外都提供 **「JSON 源码」** 开关，可直接编辑原始 JSON（保存前会做同样的 zod 校验）。

保存后：配置写入 `server/data/config.json`（原子写入），并在 `server/data/backups/` 生成快照；前端会收到 `config-saved` 事件自动同步，无需手动刷新。

---

## 七、字体与图片素材

### 7.1 架空文字字体（已内置 7 套）

[HoYo-Glyphs](https://github.com/SpeedyOrc-C/HoYo-Glyphs) 官方 Release 已提取为 woff2 放入 `frontend/fonts/`（共 96KB）：

| CSS 字族名 | 分类 | 用在哪些屏 |
|---|---|---|
| `Teyvat Black` | 提瓦特文字（蒙德） | 开场 / 蒙德 / 枫丹 / 纳塔 / 至冬 / 挪德卡莱 |
| `Inazuma Brush` | 稻妻文字 | 稻妻 |
| `Sumeru Scribe` | 须弥文字 | 须弥 |
| `Khaenriah Sun` | 坎瑞亚文字 | 坎瑞亚 |
| `Khaenriah Sun Chasm` | 坎瑞亚 · 层岩巨渊变体 | 备选 |
| `Deshret Inscription` | 赤冠文字 | 哥伦比娅屏副标题 |
| `Font Ainee` | 装饰标题字 | 备选 |

- 静态 `@font-face` 写在 `frontend/css/fonts.css`（首屏即刻加载，不等 JS）；运行时再按 `GET /api/fonts` 补注入，**新字体放进 `frontend/fonts/` 或用后台上传即刻生效**；
- 这些字体只含拉丁字母与符号，**中文自动回退系统衬线**（方案 5.7.6 预期行为）：`TEYVAT / MONDSTADT / FONTAINE` 显示为架空文字，`原神 / 蒙德 / 璃月` 保持中文可读；
- 璃月无对应架空文字（官方未制作），该屏使用 `system` 字体。

### 7.2 画廊背景图

| 来源 | 内容 | 规格 |
|---|---|---|
| 程序化生成 SVG | 10 张国家/地区氛围图（蒙德夜堡、璃月云海、稻妻雷雨、须弥雨林、枫丹水城、纳塔火山、至冬冰宫、挪德卡莱极光、坎瑞亚地底遗迹…） | 1920×1080，共 27KB |
| 用户提供真实美术 | `frontend/images/gallery/colombina-1~6.webp`（哥伦比娅 · 愚人众第三席） | 5120×2160 原图 → 1920×1080 webp，35–89KB/张 |

- 6 张哥伦比娅素材全部转换完毕，其中 `colombina-1.webp` 已用于画廊「哥伦比娅」屏；
  其余 5 张可直接在「管理后台 → 画廊管理 → 背景图片」里填 `/images/gallery/colombina-2.webp` 等路径替换；
- 想换成自己的图：后台上传即可（自动落到 `frontend/images/uploads/`），或把图片放进 `frontend/images/` 后填路径。

---

## 八、13 阶段实施对照表

| 阶段 | 方案内容 | 实现位置 | 验收结果 |
|---|---|---|---|
| 1 | Node 后端 + Helmet/CORS/限流/验证 | `server/index.js`、`middleware/security.js` | ✅ 6 项接口测试通过（含 CSP、DENY、429 限流） |
| 2 | Kuma REST 集成 + 缓存降级 | `services/kumaRest.js`、`statusService.js` | ✅ 合并结构、缓存、stale 降级、Mock 回退全部通过 |
| 3 | 前端 SPA + 视图切换 | `index.html`、`js/router.js` | ✅ 4 视图切换、hash 同步、前进后退、过渡动画 |
| 3.5 | 配置管理后端 + JWT | `routes/config.js`、`routes/auth.js`、`middleware/validate.js` | ✅ 未授权 401、伪造令牌 401、非法值 400、自动备份 |
| 3.6 | 管理后台页面 | `js/admin.js` | ✅ 登录、11 区块表单、数组编辑器、上传、备份还原 |
| 4 | 画廊基础动画 + 月亮 + Ken Burns + 字体 | `js/gallery.js`、`css/animations.css`、`css/fonts.css` | ✅ **11 屏**、逐字浮现、圆点/键盘导航、月亮自转与呼吸、7 套架空文字全部生效 |
| 5 | Three.js 星空 + 星环 + 光晕拖尾 | `js/starfield.js`、`js/effects.js` | ✅ 逐点闪烁、3 环反向旋转、WebGL 不可用自动降级 |
| 6 | 功能视图 Kuma 面板 | `js/tools.js` | ✅ 摘要、8 张监控卡、折线图、骨架屏、重试、stale 徽标 |
| 7 | 下载 + 关于 + 首页下方模块 | `js/main.js` | ✅ 卡片网格、滚动上浮淡入、服务状态速览 + 快捷入口（**资讯内容已按要求移除**） |
| 8 | 手机端适配 | `css/responsive.css` | ✅ 汉堡菜单、月亮居中、单列布局、44px 触摸目标 |
| 9 | 性能优化 + 安全审计 | 全站 | ✅ 见下文安全总结；`npm audit` 结果附后 |
| 10 | SSE 实时推送（+ 可选 Socket） | `services/statusService.js`、`sseBus.js`、`routes/status.js` | ✅ 初始快照 + 变化广播验证通过 |
| 11 | 完整安全加固总结 | 本文第九节 | ✅ 全链路逐项核对 |

---

## 九、安全加固总结

### 后端

| 层面 | 措施 | 实现 |
|---|---|---|
| HTTP 头 | Helmet：CSP（`default-src 'self'`）、HSTS（生产）、X-Frame-Options: DENY、nosniff、Referrer-Policy | `middleware/security.js` |
| CORS | 显式白名单函数校验，白名单外返回 403，绝不使用 `*` | `middleware/security.js` |
| 限流 | API 默认 100 次/15 分钟；登录失败默认 10 次/15 分钟（成功不计数）；可用环境变量调整；SSE 长连接不计数 | `middleware/security.js` |
| **图形验证码** | 纯 Node 生成 PNG 位图（内置 5x7 点阵 + 噪点干扰线，zlib 手写编码，零依赖）；**答案只存服务端内存**，一次性使用、5 分钟过期、容量上限；可在后台开关 | `services/captcha.js` |
| 输入验证 | zod 覆盖全部 10 个配置区块 + 登录 + 数据源设置；拒绝而非净化；颜色强制 `#RRGGBB`、地址仅允许站内路径或 https（拦截 `javascript:` 与 `..` 穿越）、字体名格式白名单（防 CSS 注入） | `middleware/validate.js` |
| 请求体 | 全局 10KB，配置接口 256KB，超出返回 413 | `server/index.js` |
| 认证 | JWT（HS256，24h）+ 恒定时间比较；bcrypt 哈希存储；**令牌带 tokenVersion，改密后所有旧会话立即失效** | `routes/auth.js`、`middleware/auth.js` |
| 凭据存储 | 管理员账号密码存 `DATA_DIR/auth.json`（bcrypt，已 gitignore），`.env` 仅作初始兜底；两者都没有时自动生成随机密码并打印一次 | `services/authService.js`、`services/bootstrap.js` |
| 密钥管理 | JWT 密钥写在 `.env`，或首次启动自动生成到 `DATA_DIR/secrets.json`（0600 语义）；**换机器迁移时会跟着数据目录走** | `services/bootstrap.js` |
| 数据源密钥 | Kuma 地址 / slug / API Key 存 `DATA_DIR/kuma.json`，**永不进入公开的 `/api/config`**，后台只回传脱敏后的 Key | `services/kumaConfig.js` |
| 路径与目录 | `DATA_DIR` / `UPLOAD_DIR` / `FRONTEND_DIR` 统一由 `paths.js` 管理；启动时自检可写性并给出修复建议，避免运行时才炸 | `server/paths.js` |
| 密钥泄露面 | 仓库不含任何凭据：`.gitignore` 排除 `DATA_DIR/*`、`.env`、`.local/`；测试脚本凭据也从 `.env` 读取 | `.gitignore`、`tests/*` |
| 配置写入 | 临时文件 + rename 原子写入；写前自动备份，保留 20 份 | `services/configService.js` |
| 上传 | 扩展名白名单、服务端生成文件名、大小限制、图片排除 SVG（防脚本注入） | `routes/media.js` |
| 跳转 | `/api/status/open` 服务端 302，校验 http(s)，防开放重定向 | `routes/status.js` |
| 错误处理 | 生产环境隐藏 5xx 细节，仅返回"服务器内部错误" | `server/index.js` |
| 信息泄露 | `x-powered-by` 已关闭 | `server/index.js` |

### 前端

| 层面 | 措施 |
|---|---|
| XSS | 全部动态内容通过 `el()` / `textContent` 构建，**没有任何一处拼接 innerHTML**；URL 与 CSS 值再做一次字符白名单过滤（`fonts.js`、`gallery.js`） |
| CSP | `script-src 'self'`（无内联脚本、无 eval）；`connect-src 'self'`；`object-src 'none'`；`frame-ancestors 'none'` |
| 令牌 | 仅存 localStorage，所有写操作带 `Authorization: Bearer`；401 自动登出 |
| 密钥隔离 | 前端只请求本站后端；Kuma 地址与凭据从不进入前端 bundle |
| 配置消费 | 公开只读；写操作需 JWT；本地缓存 5 分钟后失效，保存后主动失效 |

---

## 十、测试与验收

```bash
npm test                  # 跨平台冒烟测试（Windows / Linux / macOS 通用，需先 npm start）
npm run test:full         # 冒烟 + SSE + 前端 DOM 全跑
npm run test:api          # 后端接口冒烟（PowerShell，Windows）
npm run test:dom          # 前端 DOM 集成（Node + jsdom，跨平台）
npm run test:sse          # SSE 实时推送验证（约 40 秒）
```

当前结果：

| 测试 | 结果 |
|---|---|
| 跨平台冒烟（`tests/smoke.mjs`） | **29 / 29 通过**（服务存活 / 安全头 / 静态资源 MIME / 公开接口 / 验证码与权限边界 / SSE） |
| 后端接口冒烟（PowerShell） | **52 / 52 通过**（含验证码全链路、数据源设置、账号安全、凭据脱敏） |
| 前端 DOM 集成 | **67 / 67 通过**（含 11 屏画廊、七国齐全、字体接入、资讯已移除、下滑一步跳转、验证码登录、后台新区块） |
| SSE 实时推送 | 初始快照 + 变化广播 **通过** |
| **全新环境自举** | **通过**（无 `.env`、无数据目录 → 自动生成密钥与随机密码并正常服务） |
| 上传落盘 | 通过（写入 `DATA_DIR/uploads`，经 `/uploads` 公开访问，代码目录保持只读可用） |
| 登录限流 | 连续错误密码后第 11 次起返回 **429** |
| 验证码防爆破 | 无码 400 / 错码 400 / **同码重放被拒** / 大小写不敏感 ✅ |
| 依赖漏洞 | `npm audit --omit=dev` → **0 vulnerabilities** |
| 前端 XSS 面 | 全站 `innerHTML` / `document.write` / `eval` 命中 **0 处**（仅注释提及） |

覆盖的验收点包括：CSP/帧保护/嗅探保护头、CORS 白名单拦截、JSON 404、Mock 与 live 数据源标识、缓存命中、心跳历史、非法 ID 400、管理员 401/403 边界、zod 拒绝非法颜色与路径穿越与 `javascript:`、备份生成、批量更新、上传鉴权、SSE Content-Type 与首帧数据、路由渲染、画廊逐字拆分、主题变量注入、监控卡状态与折线图、后台登录（含验证码）与各区块表单渲染、数据源连接测试、运行时零异常。

---

## 十一、部署指南

> 📘 **完整部署文档：[docs/deployment.md](docs/deployment.md)** —— 覆盖零配置首启、数据目录与持久化、全部环境变量、裸机 / systemd / PM2 / Docker / Compose / PaaS / K8s / NAS、Nginx + HTTPS、升级迁移、上线安全检查清单与故障排查表。
> 下面是速查版。

### 0. 通用心法

| 要点 | 说明 |
|---|---|
| 不写 `.env` 也能跑 | 首次启动自动生成 JWT 密钥与随机管理员密码（控制台打印一次） |
| 一个目录装下所有状态 | `DATA_DIR`（默认 `server/data`）：配置 / 凭据 / 数据源密钥 / 备份 / 上传 / 自动密钥 |
| 代码目录可只读 | 上传与数据都写到 `DATA_DIR`，容器 / PaaS 直接跑打包镜像即可 |
| 端口自适应 | PaaS 注入的 `PORT` 自动生效；`HOST` 默认 `0.0.0.0` |

### 1. 直接运行 / systemd / PM2

```bash
npm install && npm start                      # 最简：任何装了 Node ≥18 的机器

# PM2（配置见 server/ecosystem.config.js：单进程、300MB 内存上限、5 秒优雅退出）
npm i -g pm2 && cd server && pm2 start ecosystem.config.js && pm2 save

# systemd：见 docs/deployment.md 第四节（含 ProtectSystem 只读加固示例）
```

### 2. Docker / Docker Compose

```bash
docker compose up -d --build
docker compose logs -f genshin-hub     # 首次启动的随机管理员密码在这里
curl http://localhost:3001/health
```

`docker-compose.yml` 把 `./data` 挂成容器内的 `/data`（`DATA_DIR=/data`）：**一份卷就包含配置、凭据、备份与上传**，不依赖 `server/.env` 存在；镜像内以非 root 运行并内置 HEALTHCHECK。

### 3. Nginx 反向代理 + HTTPS

完整示例见 [`nginx.conf.example`](nginx.conf.example)（HTTP→HTTPS 跳转、Let's Encrypt、gzip、上传体积、**SSE 免缓冲**）。关键片段：

```nginx
location /api/status/events {
    proxy_pass http://genshin_hub;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;      # 不关缓冲会导致实时推送失效
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

上 HTTPS 后设 `NODE_ENV=production`（启用 HSTS），把正式域名加入 `ALLOWED_ORIGIN`；反代层数为 1 时保持 `TRUST_PROXY=1`，直连公网改 `false`。

### 4. 备份与迁移

```bash
# 一份数据目录 = 全部状态（配置 + 凭据 + 备份 + 上传）
tar -czf genshin-hub-$(date +%F).tar.gz -C server data/

# 迁移到新机器：拷仓库 + npm install + 拷贝 DATA_DIR + npm start 即可
```

---

## 十二、与方案的差异说明

实现过程中对方案做了少量工程化取舍，均不影响功能与安全目标：

1. **未使用 `feature-flag-core`**：该包（方案 4.8.7）是 React 组件式 API，不适用于原生 ES Module 前端。功能开关改为由 `config.features` 驱动（后端 zod 校验 + 前端 `applyFeatures()` 应用），开关状态同样可在后台实时调整，且少了一个不可控依赖。
2. **`data/config.json` 由 `config.default.json` 生成**：首次启动自动写出，避免仓库中出现两份易漂移的配置。
3. **Kuma 状态页跳转走后端 302**：严格遵守"前端永远不直接接触 Kuma 的 URL"这一核心原则（方案 3.x），因此详情页链接为 `/api/status/open`。
4. **心跳折线图为纯 SVG**：方案提到的 Recharts 属于 React 生态，这里用 40 行原生 SVG 实现（含异常点标注），零依赖。
5. **星空在 WebGL 不可用时降级为 Canvas2D 星点**：保证老旧设备/无 GPU 环境（含自动化测试环境）依然有背景效果，而不是黑屏。
6. **图片上传排除 SVG**：SVG 可内嵌脚本，同源托管存在 XSS 风险，白名单只保留 png/jpg/webp/gif。
7. **按需移除资讯内容（备案要求）**：首页原「资讯区」的兑换码与卡池活动已全部删除，后台「资讯管理」区块改为「快捷入口」；
   `configService` 内置 v1→v2 自动迁移：把旧的 `news.links` 迁到新的 `links` 区块并删除 `news`，老配置无感升级。
8. **画廊扩展到 11 屏**：方案原文是 4 屏，现覆盖原神全部 7 国 + 挪德卡莱 + 坎瑞亚 + 开场 + 哥伦比娅角色特写；
   配置了旧版 4 屏出厂画廊时会自动升级，**用户自定义过的画廊不会被覆盖**。
9. **首页画廊改为「滚动吸附，一次手势一屏」**：画廊自身是滚动容器 + `scroll-snap-type: y mandatory`，
   滚轮滚一下 / 手指滑一下就吸附到下一整屏（`scroll-snap-stop: always` 保证不跳屏），
   **全程不劫持滚轮事件**，滚动位置由浏览器管理，刷新后依然正确；滑到最后一屏继续滑即自然进入下方内容区。
   早期"锁屏切换 + 内部索引"的实现已在 v2.1 废弃（移动端别扭、刷新后位置错乱）。

---

## 十三、常见问题

**Q：为什么监控数据是"演示数据"？**
A：还没配置 Kuma。填入 `KUMA_URL` / `KUMA_STATUS_SLUG` / `KUMA_API_KEY` 后重启即自动切到真实数据，徽标会显示"实时数据"。

**Q：标题里的汉字没有变成原神架空文字？**
A：这是预期行为。HoYo-Glyphs 只含拉丁字母，汉字会自动回退到系统衬线字体（方案 5.7.6）；副标题的 `TEYVAT`/`MONDSTADT`/`FONTAINE` 等拉丁文案才会显示架空文字。7 套字体已内置在 `frontend/fonts/`。

**Q：为什么没有兑换码/卡池资讯了？**
A：域名未备案，站内不提供资讯内容。首页画廊下方只保留「服务状态速览」与「快捷入口」两个模块；如需调整入口卡片，进后台「快捷入口」区块。

**Q：画廊滑到底之后怎么直接到下面那个模块？**
A：最后一屏继续向下滚一次（或点 ↓ 服务状态、按 ↓ 方向键）即一步平滑跳转；在下方内容区向上滚动一次会回到画廊。也可以在后台「画廊管理」里增减屏数。

**Q：想换掉某个国家的背景图？**
A：后台「画廊管理 → 对应屏 → 背景图片」上传新图或填路径即可；`frontend/images/gallery/` 里还预留了 5 张哥伦比娅素材（colombina-2~6.webp）可直接替换。

**Q：修改配置后前台没变化？**
A：前台会收到事件自动同步；若手动改了 `config.json`，刷新页面即可（前端缓存 5 分钟，或在后台保存一次以触发失效）。

**Q：登录被限流了怎么办？**
A：登录接口每 IP 15 分钟最多 10 次失败尝试，等待窗口结束即可；开发调试可临时调整 `middleware/security.js` 中的 `loginLimiter`。

**Q：如何关闭某个动画？**
A：后台「功能开关」逐个关闭即可，也可以让用户系统开启"减少动态效果"（`prefers-reduced-motion`），全站动画会自动禁用。

**Q：端口被占用？**
A：改 `server/.env` 里的 `PORT`，同时更新 `ALLOWED_ORIGIN`（如果做了跨域访问）。

**Q：登录页的验证码看不清 / 想关掉？**
A：点击验证码图片或「换一张」即可刷新（4 位字符，去掉了 0/O/1/I 等易混字符，5 分钟有效、用一次就作废）。
真的想关：登录后进「账号与安全 → 登录图形验证码」关闭（**不建议**，关掉后只剩限流这一层防护）。

**Q：忘记管理员密码了怎么办？**
A：删掉 `server/data/auth.json` 后重启，会回退到 `server/.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`；或者改 `.env` 里的 `ADMIN_PASSWORD` 并删除 `auth.json` 重置。

**Q：怎么把 Kuma 接上？**
A：登录后台 →「数据源设置」→ 填 Kuma 地址、状态页 slug、API Key → 点「测试连接」确认 → 点「保存并热重载」。
不需要改 `.env`，也不用重启进程；密钥只存在 `server/data/kuma.json`，不会出现在公开配置里。

**Q：点监控卡片为什么弹"Mock 演示模式"？**
A：说明后端还没读到 Kuma 地址。**请在后台「数据源设置」里配置**（面板配置优先于 `.env`），配好后卡片点击会由后端 302 跳转到真实状态页。
（早期版本这个跳转只读 `.env`，面板配置不生效，已在 v2.2 修复。）

**Q：首页最底下的「服务状态速览」全是 0？**
A：已在 v2.2 修复。原因是功能面板推送的是 `{ monitors, summary }` 嵌套结构，而首页按扁平结构 `{ total, up… }` 读取；
现在两种结构都能正确解析，数字与实际监控数一致。

**Q：首页画廊是怎么滚的？**
A：**滚一下就切一整屏**。画廊自身是滚动容器并开启了 CSS 滚动吸附（`scroll-snap-type: y mandatory` + `scroll-snap-stop: always`），
桌面滚轮一格 = 下一屏，手机手指一滑 = 下一屏，不会出现"滚很多下才到下一屏"，也不会跳屏。
滑到最后一屏继续滑，滚动会自然交给页面 → 服务状态速览与快捷入口；全程不劫持滚轮事件，刷新后滚动位置也正确。
桌面端右侧圆点可点击跳转（平板及以下自动隐藏），首屏的「↓ 向下浏览」提示滚过首屏即消失。

**Q：背景太花、字看不清怎么办？**
A：登录后台 →「主题编辑 → **画廊背景遮罩强度**」，调到 **0.95 ~ 1** 文字会非常清楚（背景相应变暗），支持实时预览。
此外默认已经做了三层保障：背景降饱和/降亮度、文字后面有一层柔和暗色底衬光晕、标题与描述都带双层阴影。
手机端遮罩会自动切换成"上下压暗 + 居中光晕"（因为手机是居中排版）。

**Q：旧密码还能用吗 / 我改了密码为什么测试提示跳过？**
A：在后台「账号与安全」改过密码后，凭据存在 `DATA_DIR/auth.json`（bcrypt），`.env` 里那个就不再生效了。
测试脚本检测到这种情况会 `[SKIP]` 并说明原因，不会误报失败；想跑全量就把新密码写回 `.env` 的 `ADMIN_PASSWORD`。

**Q：怎么把它部署到别的机器 / 服务器？**
A：把仓库拷过去 → `npm install` → `npm start` 即可，**连 `.env` 都不用建**（首次启动自动生成密钥和随机管理员密码）。
数据全在 `DATA_DIR`（默认 `server/data`），迁移时把这个目录一起带走就行。详见 [docs/deployment.md](docs/deployment.md)。

**Q：容器/PaaS 重启后配置全丢了、密码也变了？**
A：说明没挂持久卷。设 `DATA_DIR=/data` 并把卷挂到 `/data`（Compose 已默认配好），一份卷包含配置、凭据、备份与上传。

**Q：代码目录是只读的（比如 K8s 只读根文件系统），能跑吗？**
A：可以。运行时只写 `DATA_DIR`，上传也落在 `DATA_DIR/uploads` 并通过 `/uploads` 提供；启动时会自检可写性，不可写会打印修复建议。

---

## 十四、更新记录

### v2.4（当前）
- **标题"字形自己在变"的问题**
  逐字浮现动画里带了 `filter: blur(6px) → 0`：模糊状态下笔画显粗，肉眼像"换了一种字体"，而且它比光幕更早发生。
  现已**去掉模糊**，并把光幕延迟从 1.3s 提前到 **0.72s**（与逐字动画收尾对齐）→ 节奏变成「字干净地浮起 → 光幕立刻扫过」。
- **让"每滚一屏都能看出字体不同"成立**
  - 11 屏重新分配字体：**相邻两屏必不相同**（8 套字体轮换）
  - 修复 `Khaenriah Sun Chasm`（层岩巨渊变体）被通用类吃掉、实际渲染成 `Khaenriah Sun` 的问题（新增独立字体栈与类）
  - 中文标题无法换字形（HoYo 字体不含汉字），改为**每屏不同排版质感**：稻妻倾斜发光、坎瑞亚描边、须弥宽字距、赤冠极宽字距、Ainee 加粗、系统衬线常规
- **回归测试**：新增字体多样性（≥6 种）、相邻不重复、动画无模糊、光幕延迟 ≤0.9s 四条断言

### v2.3（当前）
- **修复：快捷入口中文全部变成 `?`**
  根因：测试脚本用 PowerShell 5.1 的 `Invoke-WebRequest` 发送中文 JSON 时未按 UTF-8 编码，把 `data/config.json`
  的 `links` 区块写成了问号。已从备份修复数据，并把测试助手的请求体显式转成 UTF-8 字节；
  另加两条回归断言：**整页文本与 `/api/config` 均不得出现 `???`**。
- **首页底部内容扩充**
  - 新增「**提瓦特索引**」：11 屏变成可点击卡片，点一下跳回那一屏（长页面导航）
  - 新增「**站点运行信息**」：数据源模式、监控概况、更新时间、服务运行时长、实时连接数
- **「进入网站」按钮不再是死链**：改为滚到画廊下方的站点主体（`ctaView: home`），后台仍可切换成跳到下载/功能/关于
- **修复：从下方内容区向上滚回不去**：判定条件原来看内容区在视口中的位置（内容比屏幕矮时永远不触发），
  现改为按页面滚动位置判断，一次手势回退约一屏，直到回到画廊再逐屏上翻。

### v2.2
- **修复：面板配置 Kuma 后，状态页跳转仍显示"Mock 演示模式"**
  `/api/status/open` 原先只读 `.env`，没有读面板配置；现改为读取「面板优先、`.env` 兜底」的运行时设置，
  未配置时的说明页也补上了「管理后台 → 数据源设置」的具体指路。
- **修复：首页「服务状态速览」数字全是 0**
  功能面板/SSE 推送的是 `{ monitors, summary }` 嵌套结构，首页按扁平结构读取导致取不到值；
  现两种结构都能解析，并补上"等待 + 维护"的合并计数。
- **回归测试**：新增「已配置数据源时 `/open` 必须 302」与「首页状态数字必须与接口一致」两条断言。

### v2.1
- **首页交互：滚动吸附，一次手势一屏**
  - 画廊自身作为滚动容器 + `scroll-snap-type: y mandatory` + `scroll-snap-stop: always`
    → 滚轮一格 / 手指一滑 = 下一整屏，不跳屏、不劫持滚轮、刷新后位置正确
  - 滑到最后一屏继续滑即自然进入下方「服务状态速览 / 快捷入口」
  - 圆点导航与下滚提示移到 body 层级 —— 修复视图 `transform` 动画导致 `position: fixed` 以视图为基准的定位错乱
  - 逐字浮现、Ken Burns、月亮改为"进入视口触发 / 当前屏才播放"，手机端更省电
- **文字可读性提升（背景太花的问题）**
  - 新增可调「画廊背景遮罩强度」`--scrim`（后台主题编辑，0.2~1，实时预览）
  - 文字后面加柔和暗色底衬光晕；标题/副标题/描述都加双层阴影
  - 背景图统一降饱和、降亮度、降对比（`filter: saturate(.82) brightness(.78) contrast(.94)`）
  - 环境极光层不透明度 0.5 → 0.34；手机端遮罩改为上下压暗 + 居中光晕
- **手机端专项**：首屏为月亮留位、其余屏内容垂直居中、标题字号收敛不溢出、状态指标 2×2、平板及以下隐藏圆点
- **可移植性：部署到任何地方**
  - 新增 `server/paths.js`：`DATA_DIR` / `UPLOAD_DIR` / `FRONTEND_DIR` 全部可配置，代码目录可只读
  - 新增 `server/services/bootstrap.js`：**零配置首次启动** —— 自动生成 JWT 密钥（`DATA_DIR/secrets.json`）与随机管理员密码（bcrypt 落盘 + 控制台打印一次）
  - 后台上传改写入 `DATA_DIR/uploads`，经 `/uploads` 提供（旧目录仍兼容），容器挂一个卷就够
  - 支持 `HOST` / `PORT` / `TRUST_PROXY` 环境变量；启动日志打印数据目录、上传目录与可写性告警
  - Docker 镜像改为 `DATA_DIR=/data` + 声明 `VOLUME`；compose 不再依赖 `server/.env` 存在，零前置文件即可 `up`
  - 根目录 `npm install` 自动安装 server 依赖（PaaS 构建流程开箱可用）
  - 新增跨平台测试 `tests/smoke.mjs`（Windows/Linux/macOS 通用）
  - 新增 **[docs/deployment.md](docs/deployment.md)**：裸机 / systemd / PM2 / Docker / Compose / PaaS / K8s / NAS / Nginx + 上线检查清单 + 故障排查表
- **测试自适应**：管理员在面板里改过密码 / 换过数据源时，测试不再误报失败，而是跳过并说明原因

### v2
- **新增登录图形验证码**：纯 Node 生成 PNG 位图（零依赖），一次性 + 5 分钟过期 + 容量上限，可后台开关
- **新增「数据源设置」区块**：Kuma 地址 / slug / API Key / 轮询间隔 / 缓存时长全部面板可改，支持测试连接与热重载
- **新增「账号与安全」区块**：面板内修改管理员账号密码（bcrypt 落盘），改密后旧令牌全部失效
- **限流可配置**：`API_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX`，本机开发可豁免回环地址（生产始终严格）
- **按备案要求移除资讯内容**：兑换码与卡池活动删除，原「资讯区」改为「快捷入口」外链卡片；配置自动迁移 v1→v2
- **画廊扩展到 11 屏**：开场「原神」+ 七国（蒙德/璃月/稻妻/须弥/枫丹/纳塔/至冬）+ 挪德卡莱 + 坎瑞亚 + 哥伦比娅角色特写
- **画廊下滑改为一步跳转**：末屏下滑直接平滑跳到「服务状态速览」，不再逐像素拖动
- **接入 7 套 HoYo-Glyphs 官方架空文字字体**（woff2，96KB）与 6 张真实美术素材（5120×2160 → 1920×1080 webp）
- 新增 6 张程序化生成的国家/地区背景图（蒙德 / 枫丹 / 纳塔 / 至冬 / 挪德卡莱 / 坎瑞亚）
- 安全加固：仓库不含任何凭据，测试脚本凭据改为从 `.env` 读取

### v1
- 完成方案 13 个阶段：安全后端、Kuma 中转、配置后台、画廊动画系统、手机端适配、SSE 实时推送、安全加固

---

## 十五、许可

- **代码**：MIT（见 [LICENSE](LICENSE)）
- **游戏素材**：《原神》名称、角色、美术素材版权归米哈游 / HoYoverse 所有，本站为非官方粉丝向技术演示，不提供任何游戏资源的破解或修改
- **字体**：[HoYo-Glyphs](https://github.com/SpeedyOrc-C/HoYo-Glyphs) 由 SpeedyOrc-C 制作，非商业用途免费
- **站内占位背景图**：程序化生成的 SVG，可自由替换

---

> 本站为**非官方**粉丝向技术演示，与米哈游 / HoYoverse 无任何关联。
