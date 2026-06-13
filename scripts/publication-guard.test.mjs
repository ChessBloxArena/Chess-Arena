import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathIssues, contentIssues } from './publication-guard.mjs';

const guard = resolve('scripts/publication-guard.mjs');
const identityGuard = resolve('scripts/identity-guard.sh');

test('private exports and forced-added environment files are blocked', () => {
  for (const path of ['.env.local', 'src/.env', 'docs/launch-readiness.md', 'artifacts/proof.png', 'wallet-keypair.json', 'backup.zip', 'accounts.xlsx']) assert.ok(pathIssues(path).length, path);
  for (const path of ['.env.example', 'src/lib/wagerConfig.ts', 'docs/public/deployment.md', 'public/audio/cloud-nine.m4a']) assert.deepEqual(pathIssues(path), []);
  assert.ok(pathIssues('source-link', '120000').length);
});

test('personal data is detected without including it in diagnostics', () => {
  const email = ['fixture', 'gmail.com'].join('@');
  const path = ['', 'Users', 'fixture', 'project'].join('/');
  assert.ok(contentIssues(email).includes('personal email address'));
  assert.ok(contentIssues(path).includes('personal filesystem path'));
  assert.ok(contentIssues(JSON.stringify(Array(64).fill(42))).includes('possible wallet keypair byte array'));
});

test('scans staged blobs and historical files even after working-tree cleanup', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'chessblox-guard-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Anonymous Dev', GIT_COMMITTER_NAME: 'Anonymous Dev', GIT_AUTHOR_EMAIL: 'fixture@users.noreply.github.com', GIT_COMMITTER_EMAIL: 'fixture@users.noreply.github.com' };
  const run = (command, args, overrides = {}) => spawnSync(command, args, { cwd, env: { ...env, ...overrides }, encoding: 'utf8' });
  const git = (...args) => { const result = run('git', args); assert.equal(result.status, 0, result.stderr); return result; };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Anonymous Dev');
    git('config', 'user.email', env.GIT_AUTHOR_EMAIL);
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('config', 'core.hooksPath', '.githooks');
    writeFileSync(join(cwd, 'sample.txt'), ['fixture', 'gmail.com'].join('@'));
    git('add', 'sample.txt');
    writeFileSync(join(cwd, 'sample.txt'), 'clean working tree\n');
    assert.equal(run('node', [guard, 'staged']).status, 1);
    git('commit', '-m', 'Synthetic privacy regression fixture');
    git('add', 'sample.txt');
    git('commit', '-m', 'Clean current snapshot');
    assert.equal(run('node', [guard, 'staged']).status, 0);
    assert.equal(run('node', [guard, 'commits', 'HEAD']).status, 1);
    assert.equal(run('bash', [identityGuard, 'config']).status, 0);
    assert.equal(run('bash', [identityGuard, 'config'], { GIT_AUTHOR_EMAIL: ['fixture', 'example.org'].join('@') }).status, 1);
    assert.equal(run('bash', [identityGuard, 'config'], { GIT_COMMITTER_NAME: 'Unapproved Name' }).status, 1);
    writeFileSync(join(cwd, '.env.local'), 'SYNTHETIC=true\n');
    git('add', '-f', '.env.local');
    assert.equal(run('node', [guard, 'staged']).status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
