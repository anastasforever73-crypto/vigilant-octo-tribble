import { temporaryStorage, memoryKey } from '../postgres';
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConnectionError } from './model';
export function encryptionConfigured() { return temporaryStorage() || /^[a-f0-9]{64}$/i.test(process.env.CONNECTIONS_ENCRYPTION_KEY || ''); }
function key() {
  if (temporaryStorage()) return memoryKey();
  if (!encryptionConfigured()) throw new ConnectionError('storage_required', 'Нужен серверный ключ шифрования подключений', 503);
  return Buffer.from(process.env.CONNECTIONS_ENCRYPTION_KEY!, 'hex');
}
export function seal(value: unknown, context: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function unseal<T>(value: string, context: string): T {
  try {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || extra) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')) as T;
  } catch { throw new ConnectionError('encryption', 'Не удалось расшифровать серверные настройки. Проверьте ключ шифрования.', 503); }
}
