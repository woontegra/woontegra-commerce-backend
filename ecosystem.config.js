module.exports = {
  apps: [
    {
      name: 'api',
      script: './dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'worker',
      script: './dist/worker.js',
      instances: 4,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'all',
      },
    },
    {
      name: 'worker-email',
      script: './dist/worker.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'email',
      },
    },
    {
      name: 'worker-webhook',
      script: './dist/worker.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'webhook',
      },
    },
    {
      name: 'worker-image',
      script: './dist/worker.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'image',
      },
    },
  ],
};
