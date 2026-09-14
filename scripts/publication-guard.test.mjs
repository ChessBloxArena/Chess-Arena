import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathIssues, contentIssues } from './publication-guard.mjs';

const guard = resolve('scripts/publication-guard.mjs');
const identityGuard = resolve('scripts/identity-guard.sh');
const identityFile = readFileSync(resolve('.gitidentity'), 'utf8');

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
  const env = { ...process.env, GIT_AUTHOR_NAME: 'ChessBlox Team', GIT_COMMITTER_NAME: 'ChessBlox Team', GIT_AUTHOR_EMAIL: 'team@chessblox.invalid', GIT_COMMITTER_EMAIL: 'team@chessblox.invalid' };
  const run = (command, args, overrides = {}) => spawnSync(command, args, { cwd, env: { ...env, ...overrides }, encoding: 'utf8' });
  const git = (...args) => { const result = run('git', args); assert.equal(result.status, 0, result.stderr); return result; };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'ChessBlox Team');
    git('config', 'user.email', env.GIT_AUTHOR_EMAIL);
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('config', 'core.hooksPath', '.githooks');
    writeFileSync(join(cwd, '.gitidentity'), identityFile);
    git('add', '.gitidentity');
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
    const botMessage = join(cwd, 'bot-message.txt');
    for (const [trailer, expected] of [
      ['Signed-off-by: dependabot[bot] <support@github.com>', 0],
      ['Signed-off-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', 0],
      ['Signed-off-by: dependabot[bot] <fixture@example.org>', 1],
      ['Co-authored-by: ChessBlox Team <support@github.com>', 1],
      ['Co-authored-by: fixture[bot] <123+fixture[bot]@users.noreply.github.com>', 1],
    ]) {
      writeFileSync(botMessage, `${trailer}\n`);
      assert.equal(run('bash', [identityGuard, 'message', botMessage]).status, expected, trailer);
    }
    for (const email of ['123456+fixture@users.noreply.github.com', 'fixture@users.noreply.github.com']) {
      assert.equal(run('bash', [identityGuard, 'config'], { GIT_AUTHOR_EMAIL: email }).status, 1);
      assert.equal(run('bash', [identityGuard, 'config'], { GIT_COMMITTER_EMAIL: email }).status, 1);
      const message = join(cwd, 'message.txt');
      writeFileSync(message, `Co-authored-by: ChessBlox Team <${email}>\n`);
      assert.equal(run('bash', [identityGuard, 'message', message]).status, 1);
      const historical = `tree ${git('rev-parse', 'HEAD^{tree}').stdout.trim()}\nauthor ChessBlox Team <${email}> 1700000000 +0000\ncommitter ChessBlox Team <team@chessblox.invalid> 1700000000 +0000\n\nSynthetic linked-identity fixture\n`;
      const object = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd, env, input: historical, encoding: 'utf8' });
      assert.equal(object.status, 0, object.stderr);
      assert.equal(run('bash', [identityGuard, 'commits', object.stdout.trim()]).status, 1);
    }

    // A cleaned working file must not conceal a linked identity staged earlier.
    writeFileSync(join(cwd, '.gitidentity'), identityFile.replace('team@chessblox.invalid', 'fixture@users.noreply.github.com'));
    git('add', '.gitidentity');
    writeFileSync(join(cwd, '.gitidentity'), identityFile);
    assert.equal(run('bash', [identityGuard, 'config']).status, 1);
    git('add', '.gitidentity');
    assert.equal(run('bash', [identityGuard, 'config']).status, 0);
    const tree = git('rev-parse', 'HEAD^{tree}').stdout.trim();
    const rawCommit = `tree ${tree}\nauthor ChessBlox Team <team@chessblox.invalid> 1700000000 +0000\ncommitter GitHub <noreply@github.com> 1700000000 +0000\ngpgsig synthetic-test-signature\n\nSynthetic platform signature fixture\n`;
    const signed = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd, env, input: rawCommit, encoding: 'utf8' });
    assert.equal(signed.status, 0, signed.stderr);
    const bin = join(cwd, 'mock-bin');
    mkdirSync(bin);
    const mockEnv = { PATH: `${bin}:${env.PATH}`, GITHUB_REPOSITORY: 'fixture/repo' };
    for (const [response, expected] of [['false', 1], ['true', 0]]) {
      writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' '${response}'\n`, { mode: 0o755 });
      assert.equal(run('bash', [identityGuard, 'commits', signed.stdout.trim()], mockEnv).status, expected);
    }
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.equal(run('bash', [identityGuard, 'commits', signed.stdout.trim()], mockEnv).status, 1);
    writeFileSync(join(cwd, '.env.local'), 'SYNTHETIC=true\n');
    git('add', '-f', '.env.local');
    assert.equal(run('node', [guard, 'staged']).status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
