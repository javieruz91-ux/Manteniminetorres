const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const staticRoot = path.join(projectRoot, 'static-build', 'web');
const serverPath = path.join(projectRoot, 'server', 'serve.js');
const port = 19000 + Math.floor(Math.random() * 500);

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Web server did not start in time')), 10_000);
    const onData = data => {
      if (String(data).includes(`port ${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Web server exited with code ${code}`));
      }
    });
  });
}

async function main() {
  for (const required of ['index.html', 'template-official.xlsx', 'metadata.json']) {
    assert.ok(fs.existsSync(path.join(staticRoot, required)), `Missing web file: ${required}`);
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const root = await fetch(`http://127.0.0.1:${port}/`);
    const rootHtml = await root.text();
    assert.equal(root.status, 200);
    assert.match(rootHtml, /Mantenimiento Celular/);
    assert.doesNotMatch(rootHtml, /exps:\/\//);

    const route = await fetch(`http://127.0.0.1:${port}/visit/trial`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /id="root"/);

    const workbook = await fetch(`http://127.0.0.1:${port}/template-official.xlsx`);
    assert.equal(workbook.status, 200);
    assert.equal(
      workbook.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.ok((await workbook.arrayBuffer()).byteLength > 100_000);

    const manifest = await fetch(`http://127.0.0.1:${port}/manifest`, {
      headers: { 'expo-platform': 'android' },
    });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('expo-protocol-version'), '1');

    console.log('Web trial verification passed: browser SPA, official XLSX, and Expo manifest are available.');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});