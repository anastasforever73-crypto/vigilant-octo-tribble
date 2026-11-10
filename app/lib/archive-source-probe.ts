import 'server-only';
import { google } from 'googleapis';
import { contentHash } from './archive-version';
import { getSourceSettings } from './source-settings';
import { getConnection, listConnections } from './connections/store';
import { resolveDebtSettings } from './read-receivables';
import { OPIU_WORKBOOK } from './opiu';
import { spreadsheetId } from './google-sheets';
export type SourceProbe = { versions: Record<string, string>; warnings: string[]; checkedAt: string };
/** Only Drive file metadata is read. No spreadsheet cells, imports or calculations run here. */
export async function probeArchiveSources(kind: string): Promise<SourceProbe> {
  const result: SourceProbe = { versions: {}, warnings: [], checkedAt: new Date().toISOString() };
  const settings = getSourceSettings();
  const targets = new Map<string, { id: string; email: string; key: string }>();
  function add(id: string, email: string, key: string) {
    if (!id || !email || !key) return;
    const file = spreadsheetId(id);
    targets.set(contentHash([file, email]), { id: file, email, key });
  }
  if (kind === 'opiu') {
    try {
      const s = settings.googleServiceAccountEmail && settings.googlePrivateKey ? settings : await resolveDebtSettings(settings);
      add(OPIU_WORKBOOK, s.googleServiceAccountEmail, s.googlePrivateKey);
    } catch { result.warnings.push('Не удалось проверить версию таблицы ОПиУ.'); }
  } else if (kind === 'dashboard') {
    if (settings.googleEnabled) add(settings.googleSheetId, settings.googleServiceAccountEmail, settings.googlePrivateKey);
    if (settings.debtEnabled) {
      try { const s = await resolveDebtSettings(settings); add(s.debtGoogleSheetId, s.googleServiceAccountEmail, s.googlePrivateKey); }
      catch { /* An unconfigured debt source contributes no confirmed data. */ }
    }
    const connections = await listConnections();
    for (const c of connections.filter(c => c.enabled)) {
      if (c.type === 'googleSheets' || c.type === 'debt') {
        const { secrets } = await getConnection(c.id);
        add(c.config.spreadsheetId || '', secrets.serviceAccountEmail || '', secrets.privateKey || '');
      } else {
        result.warnings.push('Данные API проверяются в фоне при обращении к архиву (не чаще раза в час), при синхронизации или вручную.');
      }
    }
    if (settings.fintabloEnabled && settings.fintabloToken) result.warnings.push('Изменения Финтабло проверяются при обновлении данных.');
  }
  await Promise.all([...targets].map(async ([key, target]) => {
    try {
      const auth = new google.auth.JWT({ email: target.email, key: target.key.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'] });
      const response = await google.drive({ version: 'v3', auth }).files.get({ fileId: target.id, fields: 'version,modifiedTime', supportsAllDrives: true }, { timeout: 10000, retry: false });
      if (!response.data.version) throw new Error('Missing file version');
      result.versions[key] = String(response.data.version);
    } catch { result.warnings.push('Версия Google Sheets не подтверждена: проверьте доступ к метаданным Drive API. Архив сохранён; проверка содержимого выполняется в фоне или вручную.'); }
  }));
  result.warnings = [...new Set(result.warnings)];
  return result;
}
