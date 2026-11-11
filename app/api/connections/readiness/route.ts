import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { temporaryStorage } from '@/app/lib/postgres';
import { storageStatus } from '@/app/lib/connections/store';
import { failure } from '@/app/lib/connections/http';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try { return json({ ...await storageStatus(), mode: temporaryStorage() ? 'temporary' : process.env.DATABASE_URL ? 'database' : 'environment' }); }
  catch (error) { return failure(error); }
}
