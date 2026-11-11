import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
export const BACKUP_LIMIT = 64 * 1024 * 1024;
export class BackupError extends Error { constructor(message: string, public status = 422) { super(message); } }
function password(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new BackupError('Пароль копии должен содержать от 12 до 256 символов.');
}
async function derive(value: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(value, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => e ? reject(e) : resolve(key)));
}
const aad = Buffer.from('mart-backup:v1:scrypt-32768-8-1:aes-256-gcm:gzip');
export async function encryptBackup(data: unknown, pass: unknown): Promise<string> {
  password(pass); const plain = Buffer.from(JSON.stringify(data));
  if (plain.length > BACKUP_LIMIT) throw new BackupError('Копия превышает 64 МБ. Сократите объём архивов перед скачиванием.', 413);
  const salt = randomBytes(16), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await derive(pass, salt), iv);
  cipher.setAAD(aad); const encrypted = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return JSON.stringify({ format: 'mart-encrypted-backup', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}
export async function decryptBackup(file: unknown, pass: unknown): Promise<unknown> {
  password(pass);
  if (typeof file !== 'string' || Buffer.byteLength(file) > BACKUP_LIMIT * 1.4) throw new BackupError('Файл копии слишком большой.', 413);
  try {
    const e = JSON.parse(file);
    if (e.format !== 'mart-encrypted-backup' || e.version !== 1 || Object.keys(e).sort().join() !== 'data,format,iv,salt,tag,version') throw new Error();
    const decode = (v: unknown, bytes?: number) => { if (typeof v !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw new Error(); const b = Buffer.from(v, 'base64'); if (b.toString('base64') !== v || (bytes && b.length !== bytes)) throw new Error(); return b; };
    const decipher = createDecipheriv('aes-256-gcm', await derive(pass, decode(e.salt, 16)), decode(e.iv, 12));
    decipher.setAAD(aad); decipher.setAuthTag(decode(e.tag, 16));
    const zipped = Buffer.concat([decipher.update(decode(e.data)), decipher.final()]);
    return JSON.parse(gunzipSync(zipped, { maxOutputLength: BACKUP_LIMIT }).toString('utf8'));
  } catch { throw new BackupError('Неверный пароль, повреждённый файл или неподдерживаемая версия копии.'); }
}
