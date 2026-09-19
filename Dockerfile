# Dockerfile — 原神功能快捷站（单容器同时托管前端与后端）
FROM node:22-alpine

# 时区与字体（中文渲染依赖宿主，此处仅保证容器内时区正确）
ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=3001

WORKDIR /app

# 先装依赖，利用镜像层缓存
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

# 再拷贝源码（.dockerignore 已排除 .env / node_modules / 数据与上传目录）
COPY server ./server
COPY frontend ./frontend
COPY package.json ./

# 运行时数据目录（建议挂载卷持久化配置与备份）
RUN mkdir -p server/data/backups server/logs frontend/images/uploads frontend/fonts/uploads

# 以非 root 用户运行
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
