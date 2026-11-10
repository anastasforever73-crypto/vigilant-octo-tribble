import type { StorageStatus } from './model';

export function storageConfiguration(env: NodeJS.ProcessEnv = process.env): StorageStatus | undefined {
  const missing = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL (подключение PostgreSQL)');
  if (!env.CONNECTIONS_ENCRYPTION_KEY) missing.push('CONNECTIONS_ENCRYPTION_KEY (серверный ключ шифрования)');
  if (missing.length) return { available: false, code: 'configuration_missing', message: `Сохранение недоступно. Не настроены: ${missing.join('; ')}. Добавьте переменные на сервере и перезапустите приложение.` };
  if (!/^[a-f0-9]{64}$/i.test(env.CONNECTIONS_ENCRYPTION_KEY!) || env.CONNECTIONS_ENCRYPTION_KEY === env.AUTH_SECRET) return { available: false, code: 'encryption_invalid', message: 'Ключ шифрования должен содержать 64 шестнадцатеричных символа и отличаться от AUTH_SECRET. Существующий ключ нельзя заменять без переноса зашифрованных данных.' };
  try {
    const url = new URL(env.DATABASE_URL!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw new Error();
  } catch { return { available: false, code: 'database_url_invalid', message: 'Некорректный DATABASE_URL. Скопируйте строку подключения PostgreSQL из настроек PostgreSQL в серверную переменную.' }; }
}

export function storageFailure(error: unknown): StorageStatus {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '42P01' || code === '42703') return { available: false, code: 'migration_required', message: 'База доступна, но схема подключений не готова. Выполните npm run storage:migrate на сервере с настроенным DATABASE_URL.' };
  if (code === '28P01' || code === '28000') return { available: false, code: 'database_auth', message: 'База отклонила авторизацию. Обновите DATABASE_URL из настроек PostgreSQL и перезапустите приложение.' };
  if (code === '42501') return { available: false, code: 'database_permissions', message: 'Недостаточно прав в базе. Роли приложения нужны права чтения и изменения таблиц подключений; для миграции — право создания таблиц.' };
  return { available: false, code: 'database_unavailable', message: 'Не удалось связаться с базой. Проверьте доступность PostgreSQL, сеть и актуальность DATABASE_URL. Изменения не сохранены.' };
}
