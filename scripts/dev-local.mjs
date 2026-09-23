import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import process from 'node:process';
import path from 'node:path';

const pnpmCli = process.env.npm_execpath;
const children = new Set();
const lanMode = process.argv.includes('--lan');
const appPort = Number(process.env.LOCAL_APP_PORT ?? 8081);
const apiPort = Number(process.env.LOCAL_API_PORT ?? 3001);

if (!Number.isInteger(appPort) || appPort <= 0 || !Number.isInteger(apiPort) || apiPort <= 0) {
  throw new Error('LOCAL_APP_PORT y LOCAL_API_PORT deben ser números de puerto válidos.');
}

function isPrivateIpv4(address) {
  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function findLanAddress() {
  const configured = process.env.LOCAL_APP_HOST?.trim();
  if (configured) return configured;

  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))
    .map((entry) => entry.address);

  return candidates.find((address) => address.startsWith('192.168.')) ?? candidates[0] ?? null;
}

const appHost = lanMode ? findLanAddress() : 'localhost';
if (!appHost) {
  throw new Error(
    'No se encontró una dirección IPv4 privada. Conecta la computadora al Wi-Fi o define LOCAL_APP_HOST.',
  );
}

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

run(['--dir', 'artifacts/api-server', 'run', 'start:local'], { PORT: String(apiPort) });
run(
  [
    '--dir',
    'artifacts/mantenimiento-celular',
    'exec',
    'expo',
    'start',
    '--web',
    lanMode ? '--lan' : '--localhost',
    '--port',
    String(appPort),
  ],
  {
    BROWSER: 'none',
    CI: '1',
    EXPO_PUBLIC_API_URL: `http://${appHost}:${apiPort}`,
    EXPO_PUBLIC_AUTH_MODE: 'local',
    __UNSAFE_EXPO_HOME_DIRECTORY: path.join(process.cwd(), '.expo-user'),
  },
);
console.log(`\nAplicación: http://${appHost}:${appPort}`);
console.log(`API local: http://${appHost}:${apiPort}`);
if (lanMode) console.log('Abre la dirección de la aplicación en un teléfono conectado al mismo Wi-Fi.');
console.log();
