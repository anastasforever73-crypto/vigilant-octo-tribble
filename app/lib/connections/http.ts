import 'server-only';
import type { NextRequest } from 'next/server';
import { json } from '../auth';
import { ConnectionError } from './model';
import { safeConnectionError } from './adapters';
export async function input(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.nextUrl.search) throw new ConnectionError('input', 'Передавайте настройки только в теле запроса', 400);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new ConnectionError('input', 'Нужен JSON запрос', 415);
  if (Number(request.headers.get('content-length') || 0) > 65536) throw new ConnectionError('input', 'Слишком большой запрос', 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > 65536) throw new ConnectionError('input', 'Слишком большой запрос', 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ConnectionError('input', 'Некорректный JSON', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionError('input', 'Некорректные параметры', 400);
  if (request.method !== 'POST' && Object.hasOwn(value, 'secrets')) throw new ConnectionError('method', 'Реквизиты принимаются только POST-запросом.', 405);
  return value as Record<string, unknown>;
}
export function failure(error: unknown) {
  const e = safeConnectionError(error);
  return json({ error: e.message, status: e.code }, e.status);
}
