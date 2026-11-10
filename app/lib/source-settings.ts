import 'server-only';
export type SourceSettings = {
  fintabloBaseUrl: string; fintabloToken: string;
  googleSheetId: string; googleServiceAccountEmail: string; googlePrivateKey: string;
  debtGoogleSheetId: string;
  debtTransitSheet?: string; debtStockSheet?: string;
  cashSheet: string; ordersSheet: string; debtorSheet: string; factorySheet: string; walletSheet: string; accountSheet: string; debtSheet: string;
  googleEnabled: boolean; fintabloEnabled: boolean; debtEnabled: boolean;
};
export type FintabloSettings = Pick<SourceSettings, 'fintabloBaseUrl' | 'fintabloToken'>;
export function getSourceSettings(): SourceSettings {
  return {
    fintabloBaseUrl: process.env.FINTABLO_API_URL || process.env.FINTABLO_API_BASE_URL || '', fintabloToken: process.env.FINTABLO_API_TOKEN || '',
    googleSheetId: process.env.GOOGLE_SHEET_ID || '', googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '', googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || '',
    debtGoogleSheetId: process.env.DEBT_GOOGLE_SHEET_ID || '',
    debtTransitSheet: process.env.DEBT_TRANSIT_SHEET || 'Транзит', debtStockSheet: process.env.DEBT_STOCK_SHEET || 'Склад',
    cashSheet: process.env.CASH_SHEET || 'ДДС недельный - по статьям', ordersSheet: process.env.ORDERS_SHEET || 'техн.лист плита - заказы',
    debtorSheet: process.env.DEBTOR_SHEET || 'дебиторка (расчет)', factorySheet: process.env.FACTORY_SHEET || 'Кредиторка по Заводу (1с)',
    walletSheet: process.env.WALLET_SHEET || 'Техн.лист (кошелек)', accountSheet: process.env.ACCOUNT_SHEET || 'техн рс остатки', debtSheet: process.env.DEBT_SHEET || 'Лист6',
    googleEnabled: process.env.GOOGLE_SHEETS_ENABLED !== 'false', fintabloEnabled: process.env.FINTABLO_ENABLED !== 'false', debtEnabled: process.env.DEBT_ENABLED !== 'false',
  };
}
export function getFintabloSettings(): FintabloSettings { const s = getSourceSettings(); return { fintabloBaseUrl: s.fintabloBaseUrl, fintabloToken: s.fintabloToken }; }
export const storageMessage = 'Постоянное серверное хранилище не настроено. Подключения читаются из переменных окружения Vercel. Сохранение и отключение из интерфейса станут доступны после подключения PostgreSQL с шифрованием реквизитов и журналом синхронизаций.';

/** Logical calculation sources stay stable; physical sheet names are explicit. */
export function debtSourceSheets(settings: Pick<SourceSettings, 'debtTransitSheet' | 'debtStockSheet'>) {
  return { Транзит: settings.debtTransitSheet || 'Транзит', Склад: settings.debtStockSheet || 'Склад' };
}
