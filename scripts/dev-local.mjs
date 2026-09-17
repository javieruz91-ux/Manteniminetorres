import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';

const pnpmCli = process.env.npm_execpath;
const children = new Set();

function run(args, extraEnv = {}) {
  if (!pnpmCli) throw new Error('No se encontró pnpm. Ejecuta este comando con pnpm dev:local.');
  const child = spawn(process.execPath, [pnpmCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run(['--dir', 'artifacts/api-server', 'run', 'start:local'], { PORT: '3001' });
run(
  ['--dir', 'artifacts/mantenimiento-celular', 'exec', 'expo', 'start', '--web', '--localhost', '--port', '8081'],
  {
    EXPO_PUBLIC_API_URL: 'http://localhost:3001',
    EXPO_PUBLIC_AUTH_MODE: 'local',
    __UNSAFE_EXPO_HOME_DIRECTORY: path.join(process.cwd(), '.expo-user'),
  },
);
console.log('\nAplicación: http://localhost:8081');
console.log('API local: http://localhost:3001\n');
