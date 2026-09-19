# Dockerfile — 原神功能快捷站（单容器同时托管前端与后端）
#
# 设计要点：
#   1. 运行时数据全部落在 /data（可用卷持久化），代码目录保持只读可用
#   2. 首次启动自动生成 JWT 密钥与随机管理员密码，无需预先准备 .env
#      → 密码请用 `docker logs <容器名>` 查看（只打印一次）
#   3. entrypoint 会先修正 /data 属主再降权运行（绑定挂载目录常常是 root 所有，
#      这是非 root 容器最常见的"数据目录不可写"来源）
#   4. 内置健康检查；支持 HTTPS（设置 SSL_CERT / SSL_KEY 即可，见 docs/deployment.md）
#
# 基础镜像可换源（国内 / NAS 拉不到 docker.io 时用得上）：
#   docker compose build --build-arg NODE_IMAGE=docker.1panel.live/library/node:22-alpine
#   docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine .
# 构建时可选：
#   docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com/ -t genshin-hub .
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

# tzdata：没有它 TZ=Asia/Shanghai 在 alpine 上是不生效的
# su-exec：entrypoint 用来从 root 降权到 app
RUN apk add --no-cache tzdata su-exec

ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# 可选：走国内镜像源构建（默认用 lock 里记录的地址）
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# 先装依赖，利用镜像层缓存
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

# 再拷贝源码（.dockerignore 已排除 .env / node_modules / 数据目录 / 测试与文档）
COPY server ./server
COPY frontend ./frontend
COPY package.json ./
COPY docker-entrypoint.sh ./

# 数据卷目录 + 非 root 用户 + 入口脚本（Windows 检出时没有可执行位，这里补上）
RUN mkdir -p /data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app /data \
 && chmod -R u+rwX,go+rX /app \
 && chmod +x /app/docker-entrypoint.sh

VOLUME ["/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const p=process.env.PORT||3001;const s=process.env.SSL_CERT?'https':'http';fetch(s+'://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 以 root 进入容器由 entrypoint 修正属主后降权；也可以 compose 里写 user: 直接非 root
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
