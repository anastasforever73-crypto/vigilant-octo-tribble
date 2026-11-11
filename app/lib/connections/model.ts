export const sections = { overview: 'Оперативный дашборд', cash: 'ДДС', opiu: 'ОПиУ', balance: 'Баланс', sales: 'Продажи по менеджерам', goods: 'Управление товаром', logistics: 'Логистика', debt: 'Расчёты и обязательства', plan: 'Планирование' } as const;
export type Section = keyof typeof sections;
export const sourceTypes = { googleSheets: 'Google Sheets', debt: 'Google Sheets — задолженность', fintablo: 'Финтабло', crm: 'CRM' } as const;
export type SourceType = keyof typeof sourceTypes;
export const datasets = {
  nlpkPayables: { label: 'Кредиторская задолженность НЛПК', sections: ['overview', 'debt'], required: ['date', 'balance'], fields: { date: 'Дата остатка', balance: 'Остаток долга НЛПК', document: 'Документ', dueDate: 'Срок оплаты', note: 'Комментарий' } },
  planPayments: { label: 'План списаний', sections: ['plan'], required: ['date', 'category', 'amount'], fields: { date: 'Плановая дата', category: 'Категория', amount: 'Плановая сумма (положительная)', counterparty: 'Контрагент', note: 'Комментарий' } },
  planReceipts: { label: 'План поступлений', sections: ['plan'], required: ['date', 'category', 'amount'], fields: { date: 'Плановая дата', category: 'Категория', amount: 'Плановая сумма (положительная)', counterparty: 'Контрагент', note: 'Комментарий' } },
  balanceSheet: { label: 'Бухгалтерский баланс', sections: ['balance'], required: ['date', 'category', 'article', 'amount'], fields: { date: 'Дата баланса', category: 'Раздел (активы / обязательства / капитал)', article: 'Статья', amount: 'Сумма' } },
  cash: { label: 'Операции ДДС', sections: ['cash'], required: ['date', 'amount'], fields: { date: 'Дата', amount: 'Сумма со знаком', source: 'Счёт / источник', counterparty: 'Контрагент', article: 'Статья', flow: 'Вид движения' } },
  balances: { label: 'Остатки денежных средств', sections: ['cash'], required: ['date', 'account', 'wallet'], fields: { date: 'Дата', account: 'Расчётный счёт', wallet: 'Кошелёк' } },
  orders: { label: 'Заказы / сделки', sections: ['overview', 'sales'], required: ['date', 'order', 'revenue', 'manager'], fields: { date: 'Дата', order: 'Заказ / сделка', revenue: 'Сумма', manager: 'Менеджер', client: 'Клиент', payer: 'Плательщик', region: 'Регион', product: 'Товар', qty: 'Количество', paymentType: 'Вид оплаты', department: 'Отдел', volume: 'Объём', paid: 'Оплачено', debt: 'Долг', delivery: 'Дата доставки', stage: 'Этап', status: 'Статус' } },
  debt: { label: 'Реестр задолженности', sections: ['debt'], required: ['category', 'balance'], fields: { category: 'Категория задолженности', balance: 'Остаток долга', paymentMethod: 'Вид оплаты', recipient: 'Конечный получатель', direction: 'Направление', marker: 'Признак' } },
  payables: { label: 'Кредиторская задолженность', sections: ['debt'], required: ['counterparty', 'balance'], fields: { counterparty: 'Поставщик / кредитор', balance: 'Остаток долга', document: 'Документ', date: 'Дата', dueDate: 'Срок оплаты' } },
  pnl: { label: 'Записи ОПиУ', sections: ['opiu'], required: ['date', 'value', 'category'], fields: { date: 'Дата', value: 'Сумма как в источнике', category: 'Статья', type: 'Тип статьи' } },
  goods: { label: 'Подтверждённые данные по товару', sections: ['goods'], required: [], fields: {} },
  logistics: { label: 'Подтверждённые данные по логистике', sections: ['logistics'], required: [], fields: {} },
} as const;
export type Dataset = keyof typeof datasets;
export type Binding = { mode?: 'primary' | 'fallback' | 'merge'; priority?: number; section: Section; dataset: Dataset; sheet: string; headerRow: number; columns: Record<string, number>; headers?: Record<string, string>; apiFields?: Record<string, string>; confirmed: boolean };
export type ConnectionConfig = { debtTransitSheet?: string; debtStockSheet?: string; spreadsheetId?: string; baseUrl?: string; crmName?: string; documentationUrl?: string; authMethod?: string; pipelineId?: string; accountIds?: number[]; managerMapping?: Record<string, string> };
export type ConnectionInput = { name: string; type: SourceType; enabled: boolean; config: ConnectionConfig; bindings: Binding[] };
export type Connection = ConnectionInput & { id: string; revision: number; status: string; error?: string; lastSuccess?: string; checkedAt?: string; secretFields: string[]; secretMasks?: Partial<Record<keyof Secrets, string>> };
export type Secrets = { token?: string; serviceAccountEmail?: string; privateKey?: string };
export type Inspection = { sheets?: { title: string; columns: number }[]; headers?: { index: number; label: string }[]; accounts?: { id: number; name: string }[]; pipelines?: { id: string; name: string }[]; managers?: { id: string; name: string }[]; fields?: { key: string; label: string }[]; message: string; checkedAt: string };
export type StoredData = Partial<Record<Dataset, unknown>> & { syncedAt?: string; byBinding?: Record<string, unknown> };
export type ReadinessCheck = 'ready' | 'missing' | 'error' | 'unchecked';
export type StorageStatus = { mode?: 'environment' | 'database' | 'temporary'; available: boolean; message: string; code?: string; checks?: { database: ReadinessCheck; migration: ReadinessCheck; encryption: ReadinessCheck } };
export const SECRET_MASK = '••••••••';
export function maskedSecrets(fields: readonly string[]): Partial<Record<keyof Secrets, string>> {
  return Object.fromEntries(['token', 'serviceAccountEmail', 'privateKey'].filter(field => fields.includes(field)).map(field => [field, SECRET_MASK]));
}
export class ConnectionError extends Error { constructor(public code: string, message: string, public status = 422) { super(message); } }
export const capabilities: Record<SourceType, Dataset[]> = { fintablo: ['cash', 'balances', 'pnl'], googleSheets: ['cash', 'balances', 'orders', 'debt', 'pnl', 'balanceSheet', 'payables', 'planReceipts', 'planPayments', 'nlpkPayables'], debt: ['debt', 'payables', 'nlpkPayables'], crm: ['orders'] };
export function bindingIssues(type: SourceType, b: Binding): string[] {
  const issues: string[] = [];
  if (type === 'googleSheets' || type === 'debt') {
    if (!b.sheet.trim()) issues.push('Выберите лист');
    const fields = datasets[b.dataset].fields as Record<string, string>;
    for (const field of datasets[b.dataset].required) {
      if (b.columns[field] == null) issues.push(`Назначьте обязательное поле «${fields[field]}»`);
    }
    for (const field of Object.keys(b.columns)) {
      if (!b.headers?.[field]) issues.push(`Получите заголовок колонки для поля «${fields[field] || field}»`);
    }
  }
  if (!b.confirmed) issues.push('Подтвердите назначение полей и целевой раздел');
  return issues;
}
export function parseConnection(value: unknown): ConnectionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionError('input', 'Некорректные настройки');
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120 || typeof v.type !== 'string' || !Object.hasOwn(sourceTypes, v.type) || typeof v.enabled !== 'boolean') throw new ConnectionError('input', 'Укажите название, тип и состояние подключения');
  const type = v.type as SourceType;
  const c = v.config && typeof v.config === 'object' && !Array.isArray(v.config) ? v.config as Record<string, unknown> : {};
  const config: ConnectionConfig = {};
  for (const key of ['debtTransitSheet', 'debtStockSheet', 'spreadsheetId', 'baseUrl', 'crmName', 'documentationUrl', 'authMethod', 'pipelineId'] as const) {
    if (c[key] != null && (typeof c[key] !== 'string' || c[key].length > 1000)) throw new ConnectionError('input', 'Некорректное поле подключения');
    if (typeof c[key] === 'string' && c[key].trim()) config[key] = c[key].trim();
  }
  if (config.authMethod && !['token', 'oauth2', 'other'].includes(config.authMethod)) throw new ConnectionError('auth_method', 'Выберите способ авторизации; секрет вводится только в поле токена');
  if (config.spreadsheetId) {
    let id = config.spreadsheetId;
    if (id.startsWith('https://')) {
      try { const url = new URL(id); if (url.hostname !== 'docs.google.com' || url.username || url.password) throw new Error(); id = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/)?.[1] || ''; }
      catch { throw new ConnectionError('spreadsheet', 'Укажите ссылку Google Sheets или ID таблицы'); }
    }
    if (!/^[\w-]+$/.test(id)) throw new ConnectionError('spreadsheet', 'Укажите корректный ID таблицы');
    config.spreadsheetId = id;
  }
  for (const key of ['baseUrl', 'documentationUrl'] as const) if (config[key]) {
    try { const url = new URL(config[key]); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (key === 'baseUrl' && url.pathname !== '/')) throw new Error(); }
    catch { throw new ConnectionError('url', 'Укажите HTTPS URL без секретов и параметров; базовый API URL — без пути'); }
  }
  if (c.accountIds != null) {
    if (!Array.isArray(c.accountIds) || c.accountIds.length > 100 || !c.accountIds.every(x => Number.isSafeInteger(x) && x > 0)) throw new ConnectionError('accounts', 'Выберите счета из результата проверки');
    config.accountIds = [...new Set(c.accountIds as number[])];
  }
  if (c.managerMapping != null) {
    if (typeof c.managerMapping !== 'object' || Array.isArray(c.managerMapping) || Object.entries(c.managerMapping).some(([k, x]) => k.length > 200 || typeof x !== 'string' || x.length > 200)) throw new ConnectionError('mapping', 'Некорректное сопоставление менеджеров');
    config.managerMapping = c.managerMapping as Record<string, string>;
  }
  if (!Array.isArray(v.bindings) || v.bindings.length > 30) throw new ConnectionError('mapping', 'Некорректные связи с разделами');
  const bindings: Binding[] = v.bindings.map((raw, bindingIndex) => {
    if (!raw || typeof raw !== 'object') throw new ConnectionError('mapping', 'Некорректная связь');
    const b = raw as Binding;
    if (!Object.hasOwn(sections, b.section) || !capabilities[type].includes(b.dataset) || !(datasets[b.dataset].sections as readonly string[]).includes(b.section)) throw new ConnectionError('mapping', 'Этот набор данных не поддерживается в выбранном разделе');
    if (typeof b.sheet !== 'string' || b.sheet.length > 200 || !Number.isInteger(b.headerRow) || b.headerRow < 1 || b.headerRow > 100) throw new ConnectionError('mapping', 'Укажите лист и строку заголовков');
    if (!b.columns || typeof b.columns !== 'object' || Array.isArray(b.columns)) throw new ConnectionError('mapping', 'Укажите соответствие колонок');
    const columns: Record<string, number> = {};
    for (const [field, index] of Object.entries(b.columns)) {
      if (!Object.hasOwn(datasets[b.dataset].fields, field) || !Number.isInteger(index) || index < 0 || index > 18277) throw new ConnectionError('mapping', 'Некорректное соответствие колонок');
      columns[field] = index;
    }
    const issues = bindingIssues(type, { ...b, columns });
    if (issues.length) throw new ConnectionError(b.confirmed !== true ? 'confirmation' : 'mapping', `Связь ${bindingIndex + 1} — ${sections[b.section]}: ${issues.join('; ')}.`);
    const apiFields: Record<string, string> = {};
    if (type === 'crm' && b.apiFields) for (const [field, value] of Object.entries(b.apiFields)) {
      if (!Object.hasOwn(datasets[b.dataset].fields, field) || typeof value !== 'string' || !value || value.length > 200) throw new ConnectionError('mapping', 'Некорректное поле CRM');
      apiFields[field] = value;
    }
    const headers: Record<string, string> = {};
    if (type === 'googleSheets' || type === 'debt') {
      for (const field of Object.keys(columns)) {
        const label = b.headers?.[field];
        if (typeof label !== 'string' || !label || label.length > 200) throw new ConnectionError('headers', 'Получите заголовки и подтвердите соответствие полей');
        headers[field] = label;
      }
    }
    if (b.mode && !['primary', 'fallback', 'merge'].includes(b.mode)) throw new ConnectionError('mapping', 'Выберите основной, резервный источник или объединение строк');
    if (b.priority != null && (!Number.isInteger(b.priority) || b.priority < 0 || b.priority > 100)) throw new ConnectionError('mapping', 'Приоритет должен быть от 0 до 100');
    return { mode: b.mode || 'primary', priority: b.priority ?? 50, section: b.section, dataset: b.dataset, sheet: b.sheet, headerRow: b.headerRow, columns, headers, apiFields, confirmed: true };
  });
  return { name: v.name.trim(), type, enabled: v.enabled, config, bindings };
}
export function parseSecrets(value: unknown): Secrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Secrets = {};
  for (const key of ['token', 'serviceAccountEmail', 'privateKey'] as const) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === SECRET_MASK) throw new ConnectionError('secrets', 'Маску нельзя сохранить как реквизит. Оставьте поле пустым или введите новое значение.');
    if (entry != null && (typeof entry !== 'string' || entry.length > 16000)) throw new ConnectionError('secrets', 'Некорректное секретное поле');
    if (typeof entry === 'string' && entry.trim()) result[key] = entry.trim();
  }
  return result;
}
// Saving a connection without bindings is supported, but never discard its credentials silently.
export function validateCredentials(connection: ConnectionInput, secrets: Secrets) {
  if (connection.type === 'googleSheets' || connection.type === 'debt') {
    if (!connection.config.spreadsheetId || !secrets.serviceAccountEmail || !secrets.privateKey) {
      throw new ConnectionError('credentials_required', 'Для сохранения укажите таблицу, email и ключ сервисного аккаунта. После проверки несохранённого подключения введите реквизиты повторно.');
    }
  }
  if (connection.type === 'fintablo') {
    if (!secrets.token) throw new ConnectionError('credentials_required', 'Введите API-токен Финтабло для сохранения подключения.');
    const url = new URL(connection.config.baseUrl || 'https://api.fintablo.ru');
    if (url.origin !== 'https://api.fintablo.ru' || url.pathname !== '/') throw new ConnectionError('url', 'Используйте официальный API https://api.fintablo.ru');
    if (connection.config.accountIds?.length && connection.bindings.some(b => b.dataset === 'pnl')) throw new ConnectionError('pnl_scope', 'Для ОПиУ создайте отдельное подключение без фильтра счетов.');
  }
}

export function conflictIssues(connections: Pick<ConnectionInput, 'name' | 'enabled' | 'bindings'>[]): string[] {
  const groups = new Map<string, { name: string; binding: Binding }[]>();
  for (const c of connections.filter(c => c.enabled)) for (const b of c.bindings) {
    const key = `${b.section}:${b.dataset}`;
    groups.set(key, [...(groups.get(key) || []), { name: `${c.name} / ${b.sheet}`, binding: b }]);
  }
  const issues: string[] = [];
  for (const entries of groups.values()) {
    const b = entries[0].binding;
    if (entries.some(e => e.binding.mode === 'merge') && (b.dataset === 'balances' || b.dataset === 'nlpkPayables')) issues.push(`${datasets[b.dataset].label}: снимки остатков нельзя объединять по строкам; выберите основной / резервный источник.`);
    if (entries.length < 2) continue;
    const main = entries.filter(e => !e.binding.mode || e.binding.mode === 'primary');
    const ranks = main.map(e => e.binding.priority ?? 50);
    if (new Set(ranks).size !== ranks.length || (entries.some(e => e.binding.mode === 'merge') && main.length)) issues.push(`${sections[b.section]} — ${datasets[b.dataset].label}: ${entries.map(e => e.name).join(', ')}. Выберите объединение для всех строк либо основной и резервный источник с различными приоритетами (меньшее число — выше).`);
  }
  return issues;
}
