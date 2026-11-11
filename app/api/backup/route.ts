import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { guard, json, requestSession } from '@/app/lib/auth';
import { BACKUP_LIMIT, BackupError, encryptBackup, decryptBackup } from '@/app/lib/backup-codec';
import { exportState, validateBackup, previewState, restoreState } from '@/app/lib/backup-store';
import { temporaryStorage, memoryStatus, markDownloaded, storageEnabled } from '@/app/lib/postgres';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;
const flights = new Set<string>();
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  return json({ enabled: storageEnabled(), ...memoryStatus(), temporary: temporaryStorage(), maxFileBytes: Math.floor(BACKUP_LIMIT * 1.4) });
}
async function body(request: NextRequest) {
  if (request.nextUrl.search || request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new BackupError('Нужен JSON в теле запроса.', 400);
  const limit = Math.ceil(BACKUP_LIMIT * 1.5);
  if (Number(request.headers.get('content-length') || 0) > limit) throw new BackupError('Файл копии слишком большой.', 413);
  const reader = request.body?.getReader(); if (!reader) throw new BackupError('Пустой запрос.');
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new BackupError('Файл копии слишком большой.', 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BackupError('Некорректный запрос.', 400); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  const session = await requestSession(request); if (!session) return json({ error: 'Требуется вход' }, 401);
  if (flights.has(session.nonce)) return json({ error: 'Предыдущая операция с копией ещё выполняется.' }, 429);
  flights.add(session.nonce);
  try {
    const input = await body(request);
    if (input.action === 'download') {
      const { backup, revision } = await exportState();
      const encrypted = await encryptBackup(backup, input.password);
      return new Response(encrypted, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="mart-backup-${backup.createdAt.slice(0,10)}.martbackup"`, 'Cache-Control': 'private, no-store', 'X-Backup-Revision': String(revision) } });
    }
    if (input.action === 'downloaded') { if (!Number.isInteger(input.revision) || input.revision < 0 || input.revision > memoryStatus().revision) throw new BackupError('Некорректная версия копии.'); markDownloaded(input.revision); return json({ saved: true }); }
    if (!['preview','restore'].includes(input.action)) throw new BackupError('Неизвестная операция.');
    const backup = validateBackup(await decryptBackup(input.file, input.password));
    const digest = createHash('sha256').update(input.file).digest('hex');
    if (input.action === 'preview') return json(await previewState(backup, digest, session.nonce));
    if (input.confirm !== true) throw new BackupError('Подтвердите замену данных.');
    await restoreState(backup, digest, input.token, session.nonce);
    return json({ restored: true });
  } catch (e) { return json({ error: e instanceof BackupError ? e.message : 'Операция не выполнена. Действующие настройки не заменены.' }, e instanceof BackupError ? e.status : (e && typeof e === 'object' && 'status' in e && e.status === 409) ? 409 : 503); }
  finally { flights.delete(session.nonce); }
}
