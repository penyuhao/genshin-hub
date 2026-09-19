#!/bin/sh
# docker-entrypoint.sh — 先修正数据目录属主，再以非 root 用户启动应用
#
# 为什么需要它：
#   docker compose 里的 ./data:/data 是**绑定挂载**，宿主机上的目录默认属于 root，
#   而容器里的应用以 app 用户运行 —— 结果就是启动日志里"数据目录不可写"，
#   保存配置、上传文件全部失败。以 root 进入容器、修正属主、再降权，
#   一次性把「绑定挂载」和「命名卷」两种情况都覆盖掉。
#
# 三级兜底（NAS / NFS / SMB 挂载上经常 chown 不了）：
#   1) chown -R app:app  → 正常情况
#   2) chmod -R a+rwX    → 不能改属主时，至少让所有用户可读写（NFS root_squash、SMB 常见）
#   3) 都失败 → 明确提示改用命名卷，并继续启动（让站点日志自己报"不可写"，比直接崩掉好排查）
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" 2>/dev/null || true

  if chown -R app:app "$DATA_DIR" 2>/dev/null; then
    :
  elif chmod -R a+rwX "$DATA_DIR" 2>/dev/null; then
    echo "[entrypoint] 提示：无法修改 $DATA_DIR 的属主（NFS root_squash / SMB 挂载常见）"
    echo "[entrypoint]        已改为放开读写权限（chmod -R a+rwX），应用应可正常写入。"
  else
    echo "[entrypoint] 警告：既无法 chown 也无法 chmod $DATA_DIR"
    echo "[entrypoint]        这通常是 NAS/NFS 共享目录的权限模型导致的。推荐改法："
    echo "[entrypoint]          · compose 里把绑定挂载换成命名卷： volumes: [ genshin-hub-data:/data ]"
    echo "[entrypoint]          · 或在宿主机执行： chown -R 1000:1000 ./data"
    echo "[entrypoint]        仍会继续启动；若随后出现「数据目录不可写」，按上面两条处理即可。"
  fi

  exec su-exec app "$@"
fi

# 已经以非 root 启动（例如 compose 里写了 user:）：直接运行
exec "$@"
