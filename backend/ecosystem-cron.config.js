module.exports = {
  apps: [
    {
      name: 'crown-mapping-updater',
      script: './scripts/cron-update-mapping.sh',
      cron_restart: '0 * * * *', // 每小时执行一次
      autorestart: false,
      watch: false,
      env: {
        ISPORTS_API_KEY: process.env.ISPORTS_API_KEY || 'GvpziueL9ouzIJNj',
      },
    },
  ],
};

