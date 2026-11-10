import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { parseConnection, parseSecrets, validateCredentials, ConnectionError } from '@/app/lib/connections/model';
import { getConnection, saveConnection, removeConnection } from '@/app/lib/connections/store';
import { validateMappings } from '@/app/lib/connections/adapters';
import { input, failure } from '@/app/lib/connections/http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
async function update(request: NextRequest, context: Context, actionsOnly = false) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const { id } = await context.params, body = await input(request);
    if (actionsOnly && !['enable', 'disable'].includes(String(body.action))) throw new ConnectionError('method', 'Для изменения реквизитов используйте POST.', 405);
    const old = await getConnection(id);
    if (body.revision !== old.connection.revision) throw new ConnectionError('revision', 'Подключение изменилось. Откройте его заново.', 409);
    const changingEnabled = body.action === 'disable' || body.action === 'enable';
    const connection = parseConnection(changingEnabled ? { ...old.connection, enabled: body.action === 'enable' } : body);
    if (connection.type !== old.connection.type) throw new ConnectionError('type', 'Тип сохранённого подключения не меняется. Создайте новое.');
    const secrets = { ...old.secrets, ...parseSecrets(body.secrets) };
    if (!changingEnabled) { validateCredentials(connection, secrets); await validateMappings(connection, secrets); }
    return json({ connection: await saveConnection(connection, secrets, id, old.connection.revision, body.priority === true), message: body.action === 'disable' ? 'Подключение отключено. Настройки сохранены в базе.' : body.action === 'enable' ? 'Подключение включено. Обновите данные за выбранный период.' : 'Настройки подключения сохранены в базе.' });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) { return update(request, context); }
// Compatibility for state toggles only: this method never accepts credentials.
export async function PATCH(request: NextRequest, context: Context) { return update(request, context, true); }
export async function DELETE(request: NextRequest, context: Context) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const { id } = await context.params, body = await input(request);
    if (body.confirm !== true) throw new ConnectionError('confirmation', 'Подтвердите удаление подключения');
    await getConnection(id);
    await removeConnection(id, Number(body.revision)); return json({ deleted: true, message: 'Подключение, его связи и история удалены из базы.' });
  } catch (error) { return failure(error); }
}
