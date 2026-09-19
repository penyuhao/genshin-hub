#!/bin/sh
# docker-entrypoint.sh — 先修正数据目录属主，再以非 root 用户启动应用
#
# 为什么需要它：
#   docker compose 里的 ./data:/data 是**绑定挂载**，宿主机上的目录默认属于 root，
#   而容器里的应用以 app 用户运行 —— 结果就是启动日志里"数据目录不可写"，
#   保存配置、上传文件全部失败。以 root 进入容器、修正属主、再降权，
#   一次性把「绑定挂载」和「命名卷」两种情况都覆盖掉。
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" 2>/dev/null || true
  if ! chown -R app:app "$DATA_DIR" 2>/dev/null; then
    echo "[entrypoint] 警告：无法修改 $DATA_DIR 的属主（可能是只读挂载或 NFS root_squash）"
    echo "[entrypoint]        如果随后出现「数据目录不可写」，请在宿主机执行：chown -R 1000:1000 ./data"
  fi
  exec su-exec app "$@"
fi

# 已经以非 root 启动（例如 compose 里写了 user:）：直接运行
exec "$@"
