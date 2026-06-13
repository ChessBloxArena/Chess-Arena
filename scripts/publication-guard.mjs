#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function pathIssues(path, mode = '100644') {
  const issues = [];
  const parts = path.split('/');
  const name = parts.at(-1);
  if (mode === '120000' || mode === '160000') issues.push('symlink or submodule requires review');
  if (parts.some(p => ['.local', '.railway', 'artifacts', 'tower-wager-port-kit', 'node_modules', 'target', 'dist', 'coverage', 'test-results', 'playwright-report'].includes(p))) issues.push('private or generated directory');
  if (path.startsWith('docs/') && !path.startsWith('docs/public/')) issues.push('internal document');
  if (['AGENTS.md', 'design-qa.md', 'ZIP-CONTENTS.txt'].includes(name)) issues.push('internal document');
  if (/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') issues.push('environment file');
  if (/\.(pem|key|p12|pfx|keystore|sqlite\w*|db|dump|bak|zip|gz|pdf|docx|xlsx)$/i.test(name) || /keypair.*\.json$/i.test(name)) issues.push('credential, database, archive, or unreviewed document');
  return issues;
}

export function contentIssues(text) {
  const issues = [];
  if (/\/(?:Users|home)\/[a-zA-Z0-9._-]+\//.test(text)) issues.push('personal filesystem path');
  if (/[A-Z0-9._%+-]+@(?:gmail|outlook|hotmail|icloud|protonmail|proton|yahoo)\.[A-Z]{2,}/i.test(text)) issues.push('personal email address');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push('private key');
  if (/\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/.test(text)) issues.push('possible wallet keypair byte array');
  return issues;
}

function git(...args) { return execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 }); }
export function scan(mode, range) {
  const snapshots = mode === 'staged' ? [null] : git('rev-list', range).toString().trim().split('\n').filter(Boolean);
  const seen = new Set();
  const failures = [];
  for (const revision of snapshots) {
    const entries = git(...(revision ? ['ls-tree', '-rz', revision] : ['ls-files', '--stage', '-z'])).toString().split('\0').filter(Boolean);
    for (const entry of entries) {
      const [metadata, path] = entry.split('\t');
      const [fileMode, ,] = metadata.split(' ');
      const sha = metadata.split(' ')[revision ? 2 : 1];
      const key = `${path}:${sha}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const problems = pathIssues(path, fileMode);
      // Never read explicitly excluded credential/document paths.
      if (!problems.length) {
        const blob = git('cat-file', 'blob', sha);
        if (!blob.includes(0)) problems.push(...contentIssues(blob.toString('utf8')));
      }
      for (const problem of problems) failures.push(`${path}: ${problem}`);
    }
  }
  if (failures.length) throw new Error(`Publication blocked:\n${[...new Set(failures)].join('\n')}`);
  console.log(`Publication guard passed (${seen.size} file revisions).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode = 'staged', range] = process.argv.slice(2);
    if (mode !== 'staged' && !(mode === 'commits' && range && !range.startsWith('-'))) throw new Error('Usage: publication-guard.mjs {staged|commits RANGE}');
    scan(mode, range);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
