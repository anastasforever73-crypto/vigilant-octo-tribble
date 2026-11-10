import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { parseConnection, parseSecrets, ConnectionError } from '@/app/lib/connections/model';
import { adapters } from '@/app/lib/connections/adapters';
import { getConnection } from '@/app/lib/connections/store';
import { input, failure } from '@/app/lib/connections/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const body = await input(request);
    const connection = parseConnection({ ...body, bindings: [] });
    const saved = typeof body.id === 'string' ? await getConnection(body.id) : undefined;
    if (saved && saved.connection.type !== connection.type) throw new ConnectionError('type', 'Тип подключения не совпадает');
    const secrets = { ...saved?.secrets, ...parseSecrets(body.secrets) };
    return json(await adapters[connection.type].inspect(connection, secrets, typeof body.sheet === 'string' ? body.sheet : undefined, Number(body.headerRow || 1)));
  } catch (error) { return failure(error); }
}
