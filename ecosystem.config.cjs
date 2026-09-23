module.exports = {
  apps: [
    {
      name: "satmi-orders",
      script: "npm",
      args: "start",
      cwd: "/home/deployer/apps/satmi-orders",
      env: {
        NODE_ENV: "production",
        PORT: 5001,
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "500M",
      out_file: "/home/deployer/logs/satmi-orders-out.log",
      error_file: "/home/deployer/logs/satmi-orders-error.log",
      time: true,
    },
    {
      name: "satmi-scheduler",
      script: "node",
      args: "scripts/scheduler.mjs",
      cwd: "/home/deployer/apps/satmi-orders",
      env: {
        NODE_ENV: "production",
        DASHBOARD_URL: "http://localhost:5001",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "200M",
      out_file: "/home/deployer/logs/satmi-scheduler-out.log",
      error_file: "/home/deployer/logs/satmi-scheduler-error.log",
      time: true,
    },
  ],
};
