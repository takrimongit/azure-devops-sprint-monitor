module.exports = {
  apps: [{
    name: "sprint-monitor",
    script: "./dist/web/server.js",
    cwd: "/Users/takrim/azure-devops-monitor",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
      WEB_PORT: "3000",
    },
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    time: true,
  }]
};
