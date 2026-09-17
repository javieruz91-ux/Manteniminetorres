const agent = process.env.npm_config_user_agent || '';

if (!agent.startsWith('pnpm/')) {
  console.error('Este proyecto usa pnpm. Ejecuta los comandos con pnpm.');
  process.exit(1);
}
