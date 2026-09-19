# Dockerfile — 原神功能快捷站（单容器同时托管前端与后端）
# 设计要点：
#   1. 运行时数据全部落在 /data（可用卷持久化），代码目录保持只读可用
#   2. 首次启动自动生成 JWT 密钥与随机管理员密码，无需预先准备 .env
#      → 密码请用 `docker logs <容器名>` 查看（只打印一次）
#   3. 非 root 运行 + 内置健康检查
FROM node:22-alpine

ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# 先装依赖，利用镜像层缓存
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

# 再拷贝源码（.dockerignore 已排除 .env / node_modules / 数据目录）
COPY server ./server
COPY frontend ./frontend
COPY package.json ./

# 数据卷目录 + 非 root 用户
RUN mkdir -p /data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app /data

USER app

VOLUME ["/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
