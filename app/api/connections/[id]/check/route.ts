import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { getConnection, recordCheck } from '@/app/lib/connections/store';
import { adapters, safeConnectionError } from '@/app/lib/connections/adapters';
import { failure } from '@/app/lib/connections/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const { connection, secrets } = await getConnection((await context.params).id);
    try {
      const result = await adapters[connection.type].inspect(connection, secrets);
      await recordCheck(connection, connection.enabled ? 'checked' : 'disabled'); return json(result);
    } catch (error) {
      const safe = safeConnectionError(error); await recordCheck(connection, 'check_error', safe.message); throw safe;
    }
  } catch (error) { return failure(error); }
}
