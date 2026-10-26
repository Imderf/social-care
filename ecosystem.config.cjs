// pm2 start ecosystem.config.cjs: panel y webhooks (Next) + worker. Ambos leen .env.
module.exports = {
  apps: [
    {
      name: "social-care-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      env: { NODE_ENV: "production" },
    },
    {
      name: "social-care-worker",
      script: "worker/index.ts",
      interpreter: "node",
      node_args: "--env-file-if-exists=.env",
      env: { NODE_ENV: "production" },
    },
  ],
};
