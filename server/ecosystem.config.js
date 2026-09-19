// ecosystem.config.js — PM2 部署配置
// 用法： pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'genshin-hub',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      // 日志
      output: './logs/out.log',
      error: './logs/error.log',
      merge_logs: true,
      time: true,
      // 优雅退出：等待 5 秒让 SSE 连接关闭
      kill_timeout: 5000,
      wait_ready: false,
    },
  ],
};
