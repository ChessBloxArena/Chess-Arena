import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('production web deployment serves routes, assets, and readiness safely', async () => {
  let child;
  let base = process.env.DEPLOY_URL;
  try {
    if (!base) {
      child = spawn(process.execPath, ['scripts/start-railway-service.mjs'], {
        env: { ...process.env, PORT: '0', CHESS_ARENA_SERVICE_ROLE: 'web', RAILWAY_SERVICE_NAME: 'web' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
        child.stderr.on('data', data => {
          const match = data.toString().match(/listening on (\d+)/);
          if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
        });
      });
    }
    const request = (path, options = {}) => fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(20000) });
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'web' });
    const root = await request('/');
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /text\/html/);
    const html = await root.text();
    assert.match(html, /id="root"/);
    const deep = await request('/game/smoke-test');
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), html);
    const js = html.match(/src="([^\"]+\.js)"/)[1];
    const asset = await request(js);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    await asset.arrayBuffer();
    const audio = await request('/audio/cloud-nine.m4a', { method: 'HEAD' });
    assert.equal(audio.status, 200);
    assert.match(audio.headers.get('content-type'), /audio\/mp4/);
    assert.ok(Number(audio.headers.get('content-length')) > 0);
    assert.equal((await request('/missing.js')).status, 404);
    assert.equal((await request('/.env')).status, 403);
    assert.equal((await request('/', { method: 'POST' })).status, 405);
    const malformed = await request('/%E0%A4%A');
    // Railway rejects invalid UTF-8 at its edge with 502 before the app receives it.
    // The local server must still return 400; both paths must remain healthy.
    // Identify the edge by its response, including when serving a custom domain.
    const edgeRejected = malformed.headers.get('server') === 'railway-hikari' &&
      malformed.status === 502;
    if (edgeRejected) assert.equal(await malformed.text(), 'upstream error');
    else assert.equal(malformed.status, 400);
    assert.equal((await request('/health')).status, 200);
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
});
