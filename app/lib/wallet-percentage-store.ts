import 'server-only';
import { postgres, storageEnabled } from './postgres';
import { parseWalletPercentage, type WalletPercentageRule } from './wallet-percentage';
function database() {
  if (!storageEnabled()) throw new Error('Для сохранения процента подключите базу данных.');
  return postgres(process.env.DATABASE_URL || '', { statementTimeoutMs: 15000 });
}
export async function readWalletPercentage(): Promise<WalletPercentageRule[]> {
  if (!storageEnabled()) return [];
  try {
    const rows = await database()`SELECT to_char(effective_from, 'YYYY-MM-DD') AS date, percent FROM mart_wallet_percentage ORDER BY effective_from`;
    return rows.map(r => ({ effectiveFrom: String(r.date), percent: Number(r.percent) }));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '42P01') return [];
    throw new Error('Не удалось прочитать настройки процента кошелька.');
  }
}
export async function saveWalletPercentage(value: unknown) {
  const rule = parseWalletPercentage(value);
  try { await database()`INSERT INTO mart_wallet_percentage(effective_from,percent) VALUES (${rule.effectiveFrom}::date,${rule.percent}) ON CONFLICT(effective_from) DO UPDATE SET percent=EXCLUDED.percent,updated_at=now()`; }
  catch { throw new Error('Не удалось сохранить процент. Проверьте базу и миграцию 007-wallet-percentage.sql.'); }
  return rule;
}
