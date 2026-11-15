module.exports = {
  apps: [{
    name: 'musicy',
    script: 'src/index.js',
    node_args: '--max-old-space-size=256 --max-semi-space-size=1', // small young generation: ~13 MB less idle memory, ~30 MB less after bursts
    max_memory_restart: '400M',
    watch: false,
    autorestart: true,
    env: { NODE_ENV: 'production' },
  }],
};
