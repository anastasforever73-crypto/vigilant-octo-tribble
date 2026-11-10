// Publish only code identity, never environment values or credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.posix.join(dir, item.name);
    if (name === 'public/build-info.json' || item.isSymbolicLink()) continue;
    if (item.isDirectory()) walk(name); else files.push(name);
  }
}
for (const dir of ['app', 'public', 'migrations', 'scripts']) walk(dir);
for (const file of ['package.json', 'package-lock.json', 'next.config.ts', 'postcss.config.mjs', 'proxy.ts', 'tsconfig.json', 'shadcn-tailwind-4.13.0.css']) files.push(file);
const hash = crypto.createHash('sha256');
for (const file of files.sort()) hash.update(file + '\0').update(fs.readFileSync(file)).update('\0');
let gitCommit = null;
try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
if (gitCommit && !/^[a-f0-9]{40}$/.test(gitCommit)) gitCommit = null;
fs.writeFileSync('public/build-info.json', JSON.stringify({
  gitCommit, sourceFingerprint: hash.digest('hex'),
  vercelBaseDeployment: 'dpl_4XfG71z3JMCEri4ZCWdSCG8j23JZ',
}) + '\n');
console.log('Build identity generated');
