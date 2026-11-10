import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readFile, open, rename, link, unlink, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validPassword } from '../app/lib/password-policy.mjs';

const keys = ['AUTH_SECRET', 'USER_LOGIN', 'USER_PASSWORD_HASH', 'ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH'];
export class SetupError extends Error {}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
  });
  return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function validLogin(value) { return /^[\p{L}\p{N}_.@+-]{3,128}$/u.test(value); }
// Keep unrelated assignments byte-for-byte, including quoted multiline source keys.
function envEntries(contents) {
  const lines = contents.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    const match = text.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)/);
    if (!match) { entries.push({ text }); continue; }
    let value = match[2].trim();
    const quote = value[0];
    if (['"', "'", '`'].includes(quote)) {
      const closing = () => {
        for (let pos = 1; pos < value.length; pos++) {
          if (value[pos] === '\\') { pos++; continue; }
          if (value[pos] === quote) return pos;
        }
        return -1;
      };
      while (closing() === -1 && i + 1 < lines.length) { const next = lines[++i]; text += next; value += '\n' + next; }
      if (closing() === -1) throw new SetupError('Проверка: незакрытая кавычка в .env.local; запись отменена.');
      value = value.slice(1, closing());
    } else value = value.split('#')[0].trim();
    entries.push({ text, key: match[1], value });
  }
  return entries;
}
export function mergeSettings(contents, settings, { reset = false } = {}) {
  const retained = envEntries(contents).filter(entry => {
    if (!keys.includes(entry.key)) return true;
    if (!reset && entry.value) throw new SetupError('Проверка: авторизация уже настроена; для сброса используйте --reset. Существующие значения не изменены.');
    return false;
  }).map(entry => entry.text).join('');
  // Next.js expands $ even inside quotes: escape every dollar in scrypt hashes.
  return retained + (retained && !retained.endsWith('\n') ? '\n' : '') + keys.map(key => `${key}=${settings[key].replaceAll('$', '\\$')}`).join('\n') + '\n';
}
async function regularFile(filename) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new SetupError('Проверка: небезопасный тип файла; запись отменена.');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export async function ensureGitProtection(root) {
  if (path.resolve(git(root, ['rev-parse', '--show-toplevel'])) !== path.resolve(root)) throw new SetupError('Проверка: запускайте настройку в корневом Git-проекте.');
  if (git(root, ['ls-files', '--', '.env.local'])) throw new SetupError('Проверка: .env.local уже отслеживается Git. Секреты не записаны; сначала исключите файл из индекса.');
  if (git(root, ['log', '--all', '-1', '--format=%H', '--', '.env.local'])) throw new SetupError('Проверка: .env.local найден в истории Git. Секреты не записаны; сначала устраните утечку и смените прежние секреты.');
  const ignorePath = path.join(root, '.gitignore');
  await regularFile(ignorePath);
  const before = await readFile(ignorePath, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const rules = ['/.env.local', '/.env.local.setup-*'];
  // Append last: any earlier negation must not override the secret-file protection.
  if (!before.endsWith(rules.join('\n') + '\n')) {
    const handle = await open(ignorePath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile((before.endsWith('\n') || !before ? '' : '\n') + rules.join('\n') + '\n'); } finally { await handle.close(); }
  }
  git(root, ['check-ignore', '--no-index', '-q', '--', '.env.local']);
}
export async function saveSettings(root, original, settings, options = {}) {
  await ensureGitProtection(root);
  const target = path.join(root, '.env.local');
  const existing = await regularFile(target);
  const current = existing ? await readFile(target, 'utf8') : '';
  if (current !== original) throw new SetupError('Проверка: .env.local изменился во время настройки; запись отменена.');
  const output = mergeSettings(current, settings, options);
  const temp = path.join(root, `.env.local.setup-${randomBytes(16).toString('hex')}`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(output);
    await handle.sync();
    await handle.close(); handle = null;
    if (existing) {
      const latest = await regularFile(target);
      if (!latest || latest.ino !== existing.ino || await readFile(target, 'utf8') !== original) throw new SetupError('Проверка: файл изменился; запись отменена.');
      await rename(temp, target);
    } else {
      // link fails if another process has created the target; do not overwrite it.
      await link(temp, target);
      await unlink(temp);
    }
    await chmod(target, 0o600);
    const result = await readFile(target, 'utf8');
    const mode = (await lstat(target)).mode & 0o777;
    if (result !== output || mode !== 0o600 || git(root, ['ls-files', '--', '.env.local'])) throw new SetupError('Проверка файла не пройдена; публикация запрещена.');
    git(root, ['check-ignore', '--no-index', '-q', '--', '.env.local']);
  } finally {
    if (handle) await handle.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function ask(label, hidden = false) {
  const input = process.stdin, output = process.stdout;
  return new Promise((resolve, reject) => {
    let answer = '';
    const previousRaw = input.isRaw;
    const cleanup = () => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', abort);
      process.removeListener('SIGTERM', abort);
      input.setRawMode(previousRaw); input.pause(); output.write('\n');
    };
    const abort = () => { answer = ''; cleanup(); reject(new SetupError('Проверка: настройка отменена; секреты не записаны.')); };
    const onKey = (character, key = {}) => {
      if (key.ctrl && ['c', 'd', 'z'].includes(key.name)) { abort(); return; }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(answer); answer = ''; return; }
      if (key.name === 'backspace') { if (answer) { answer = [...answer].slice(0, -1).join(''); if (!hidden) output.write('\b \b'); } return; }
      if (!character || key.ctrl || key.meta || /[\x00-\x1f\x7f]/.test(character)) return;
      if (answer.length + character.length > 1024) return;
      answer += character; if (!hidden) output.write(character);
    };
    input.setRawMode(true);
    input.on('keypress', onKey); input.once('end', abort); process.once('SIGTERM', abort);
    input.resume(); output.write(label);
  });
}
async function askLogin(label, other) {
  while (true) {
    const value = (await ask(label)).trim();
    if (validLogin(value) && value !== other) return value;
    process.stdout.write('Проверка логина: нужны 3–128 букв, цифр или символов _.@+-. Логины должны различаться.\n');
  }
}
async function askPassword(label) {
  while (true) {
    let password = await ask(label, true);
    if (!validPassword(password)) { password = ''; process.stdout.write('Проверка пароля: требуется ровно 4 символа.\n'); continue; }
    let repeated = await ask('Повторите пароль: ', true);
    const left = Buffer.from(password), right = Buffer.from(repeated);
    const matches = left.length === right.length && timingSafeEqual(left, right);
    left.fill(0); right.fill(0); repeated = '';
    if (matches) return password;
    password = ''; process.stdout.write('Проверка пароля: введённые значения не совпадают.\n');
  }
}
export async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--reset')) throw new SetupError('Использование: npm run setup-auth [-- --reset]. Пароли вводятся только скрыто в терминале.');
  const reset = args[0] === '--reset';
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') throw new SetupError('Проверка: нужен интерактивный терминал; ввод через pipe и перенаправление вывода запрещены.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  await ensureGitProtection(root);
  const target = path.join(root, '.env.local');
  const existing = await regularFile(target);
  const original = existing ? await readFile(target, 'utf8') : '';
  // Reject existing nonempty auth values before requesting any credentials.
  mergeSettings(original, Object.fromEntries(keys.map(key => [key, ''])), { reset });
  const current = Object.fromEntries(envEntries(original).filter(entry => keys.includes(entry.key)).map(entry => [entry.key, entry.value]));
  if (reset && (!validLogin(current.USER_LOGIN || '') || !validLogin(current.ADMIN_LOGIN || '') || current.USER_LOGIN === current.ADMIN_LOGIN)) throw new SetupError('Проверка: для --reset нужны два корректных разных логина в .env.local.');
  emitKeypressEvents(process.stdin);
  const userLogin = reset ? current.USER_LOGIN : await askLogin('USER_LOGIN: ');
  const adminLogin = reset ? current.ADMIN_LOGIN : await askLogin('ADMIN_LOGIN: ', userLogin);
  let userPassword = '', adminPassword = '';
  try {
    userPassword = await askPassword('Пароль пользователя (ввод скрыт): ');
    adminPassword = await askPassword('Пароль администратора (ввод скрыт): ');
    const userHash = await hashPassword(userPassword);
    const adminHash = await hashPassword(adminPassword);
    userPassword = ''; adminPassword = '';
    await saveSettings(root, original, { AUTH_SECRET: randomBytes(48).toString('hex'), USER_LOGIN: userLogin, ADMIN_LOGIN: adminLogin, USER_PASSWORD_HASH: userHash, ADMIN_PASSWORD_HASH: adminHash }, { reset });
    process.stdout.write('Проверка пройдена: авторизация настроена; .env.local защищён правами 600, исключён из Git и не отслеживается.\n');
  } finally { userPassword = ''; adminPassword = ''; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never print arbitrary exception details: they can contain file contents or secrets.
    process.stderr.write(error instanceof SetupError ? `${error.message}\n` : 'Проверка не пройдена: настройку не удалось завершить. Секреты не выводятся.\n');
    process.exitCode = 1;
  });
}
