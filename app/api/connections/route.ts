import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { parseConnection, parseSecrets, validateCredentials, ConnectionError } from '@/app/lib/connections/model';
import { listConnections, saveConnection, storageStatus } from '@/app/lib/connections/store';
import { validateMappings } from '@/app/lib/connections/adapters';
import { input, failure } from '@/app/lib/connections/http';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try { const storage = await storageStatus(); return json({ storage, connections: storage.available ? await listConnections() : [] }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const storage = await storageStatus(); if (!storage.available) throw new ConnectionError('storage_required', storage.message, 503);
    const body = await input(request), connection = parseConnection(body), secrets = parseSecrets(body.secrets);
    validateCredentials(connection, secrets);
    await validateMappings(connection, secrets);
    return json({ connection: await saveConnection(connection, secrets, undefined, 0, body.priority === true), message: 'Подключение сохранено в базе. Теперь проверьте доступ к источнику и настройте связи с вкладками.' }, 201);
  } catch (error) { return failure(error); }
}
