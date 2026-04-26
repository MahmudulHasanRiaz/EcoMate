module.exports = {
    apps: [
        {
            name: 'ecomate-web',
            script: 'npm',
            args: 'start',
            exec_mode: 'cluster',
            instances: process.env.WEB_CONCURRENCY || 1,
            env: {
                NODE_ENV: 'production',
                PORT: process.env.PORT || 9002
            },
            max_memory_restart: '700M',
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
        },
        {
            name: 'ecomate-worker',
            script: 'npm',
            args: 'run worker',
            exec_mode: 'fork',
            instances: 1,
            env: {
                NODE_ENV: 'production'
            },
            max_memory_restart: '500M',
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
        }
    ]
};
