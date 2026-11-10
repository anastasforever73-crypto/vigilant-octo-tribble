/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit operator commands. Never print connection strings, ciphertext or raw driver errors.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('./lib/operator-env.cjs').operatorEnv();
// Load exactly the application's server modules outside Next's bundler.
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = path.join(root, name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { storageConfiguration, storageFailure } = require('../app/lib/connections/storage-health.ts');
const { storageStatus, getConnection, removeConnection } = require('../app/lib/connections/store.ts');
const { postgres } = require('./lib/postgres.cjs');
const { unseal } = require('../app/lib/connections/crypto.ts');
function ensure(value, message) { if (!value) throw new OperatorError(message); }
class OperatorError extends Error {}
async function verify(sql) {
  // Temporary credentials authorize only this process's route-handler calls.
  process.env.AUTH_SECRET = crypto.randomBytes(48).toString('hex');
  const { NextRequest } = require('next/server');
  const auth = require('../app/lib/auth.ts');
  const collection = require('../app/api/connections/route.ts');
  const item = require('../app/api/connections/[id]/route.ts');
  const origin = 'http://localhost:3100';
  const secret = crypto.randomBytes(32).toString('hex');
  const marker = `Проверка хранилища ${crypto.randomUUID()}`;
  let id;
  const call = async (handler, method, body, role = 'admin') => {
    const response = await handler(new NextRequest(origin + '/api/connections' + (id ? '/' + id : ''), {
      method, headers: { origin, cookie: `${auth.SESSION_COOKIE}=${auth.createSession(role)}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), { params: Promise.resolve({ id }) });
    const text = await response.text();
    ensure(!text.includes(secret), 'Проверка защиты ответа не пройдена.');
    ensure(response.headers.get('cache-control')?.includes('no-store'), 'Ответ не запрещает кэширование.');
    return { status: response.status, body: JSON.parse(text) };
  };
  try {
    const input = { name: marker, type: 'crm', enabled: false, config: { crmName: 'Проверка постоянного хранилища' }, bindings: [], secrets: { token: secret } };
    const created = await call(collection.POST, 'POST', input);
    ensure(created.status === 201, 'Создание через API не прошло.');
    id = created.body.connection.id;
    let c = created.body.connection;
    ensure(c.secretMasks?.token === '••••••••', 'Безопасная маска сохранённого токена отсутствует.');
    const rows = await sql`SELECT secrets FROM mart_connections WHERE id=${id}`;
    ensure(rows.length === 1 && !rows[0].secrets.includes(secret), 'Секрет не зашифрован в базе.');
    ensure(unseal(rows[0].secrets, id).token === secret, 'Расшифрование не прошло.');
    const listed = await call(collection.GET, 'GET');
    ensure(listed.status === 200 && listed.body.connections.some(c => c.id === id), 'Сохранённая запись не прочитана.');
    const edited = await call(item.POST, 'POST', { ...c, name: marker + ' — изменено', secrets: { token: '' } });
    ensure(edited.status === 200, 'Редактирование через API не прошло.');
    c = edited.body.connection;
    ensure((await getConnection(id)).secrets.token === secret, 'Пустое поле удалило сохранённый секрет.');
    for (const action of ['enable', 'disable']) {
      const result = await call(item.POST, 'POST', { action, revision: c.revision });
      ensure(result.status === 200 && result.body.connection.enabled === (action === 'enable'), 'Переключение состояния не прошло.');
      c = result.body.connection;
    }
    ensure((await call(item.POST, 'POST', { action: 'enable', revision: c.revision - 1 })).status === 409, 'Защита версии не прошла.');
    ensure((await call(collection.GET, 'GET', undefined, 'user')).status === 403, 'Права user не ограничены.');
    ensure((await call(item.DELETE, 'DELETE', { revision: c.revision, confirm: true })).status === 200, 'Удаление через API не прошло.');
    ensure((await sql`SELECT id FROM mart_connections WHERE id=${id}`).length === 0, 'Запись осталась после удаления.');
    id = undefined;
    console.log('Проверено на реальной базе: создание, чтение, редактирование, включение, выключение, удаление, шифрование, отсутствие секрета в API-ответах и права доступа.');
  } finally {
    // Clean only our own uniquely named, unbound record, even after a failed assertion.
    if (id) await removeConnection(id, (await getConnection(id)).connection.revision);
    else await sql`DELETE FROM mart_connections WHERE name=${marker} AND type='crm'`;
  }
}
(async () => {
  const command = process.argv[2];
  ensure(['check', 'migrate', 'archive-migrate', 'verify'].includes(command), 'Используйте storage:check, storage:migrate или storage:verify.');
  const issue = storageConfiguration();
  if (issue) throw new OperatorError(issue.message);
  const sql = postgres(process.env.DATABASE_URL, { statementTimeoutMs: 15000 });
  if (command === 'migrate' || command === 'archive-migrate') {
    // This fixed migration has no procedural SQL; run its statements as one transaction.
    const source = (command === 'archive-migrate' ? ['004-dashboard-archive.sql', '005-durable-period-archive.sql', '006-source-input-archive.sql'] : ['001-connections.sql', '002-multiple-source-links.sql', '003-user-access.sql', '004-dashboard-archive.sql', '005-durable-period-archive.sql', '006-source-input-archive.sql', '007-wallet-percentage.sql', '008-user-registry.sql']).map(file => fs.readFileSync(path.join(root, 'migrations', file), 'utf8')).join('\n');
    const statements = source.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(s => s && !/^(BEGIN|COMMIT)$/i.test(s));
    await sql.transaction(statements.map(statement => sql.query(statement, [])));
    console.log('Миграции подключений выполнены в одной транзакции.');
  }
  const status = await storageStatus();
  ensure(status.available, status.message);
  console.log(status.message);
  if (command === 'verify') await verify(sql);
})().catch(error => {
  console.error(error instanceof OperatorError ? error.message : storageFailure(error).message);
  process.exitCode = 1;
});
