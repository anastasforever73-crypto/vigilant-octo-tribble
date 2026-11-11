import { environmentOverride } from './postgres';
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
  const env = { ...process.env, ...environmentOverride() };
  return {
    fintabloBaseUrl: env.FINTABLO_API_URL || env.FINTABLO_API_BASE_URL || '', fintabloToken: env.FINTABLO_API_TOKEN || '',
    googleSheetId: env.GOOGLE_SHEET_ID || '', googleServiceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '', googlePrivateKey: env.GOOGLE_PRIVATE_KEY || '',
    debtGoogleSheetId: env.DEBT_GOOGLE_SHEET_ID || '',
    debtTransitSheet: env.DEBT_TRANSIT_SHEET || 'Транзит', debtStockSheet: env.DEBT_STOCK_SHEET || 'Склад',
    cashSheet: env.CASH_SHEET || 'ДДС недельный - по статьям', ordersSheet: env.ORDERS_SHEET || 'техн.лист плита - заказы',
    debtorSheet: env.DEBTOR_SHEET || 'дебиторка (расчет)', factorySheet: env.FACTORY_SHEET || 'Кредиторка по Заводу (1с)',
    walletSheet: env.WALLET_SHEET || 'Техн.лист (кошелек)', accountSheet: env.ACCOUNT_SHEET || 'техн рс остатки', debtSheet: env.DEBT_SHEET || 'Лист6',
    googleEnabled: env.GOOGLE_SHEETS_ENABLED !== 'false', fintabloEnabled: env.FINTABLO_ENABLED !== 'false', debtEnabled: env.DEBT_ENABLED !== 'false',
  };
}
export function getFintabloSettings(): FintabloSettings { const s = getSourceSettings(); return { fintabloBaseUrl: s.fintabloBaseUrl, fintabloToken: s.fintabloToken }; }
export const storageMessage = 'Постоянное серверное хранилище не настроено. Подключения читаются из закрытых переменных окружения сервера. Сохранение и отключение из интерфейса станут доступны после подключения PostgreSQL с шифрованием реквизитов и журналом синхронизаций.';

/** Logical calculation sources stay stable; physical sheet names are explicit. */
export function debtSourceSheets(settings: Pick<SourceSettings, 'debtTransitSheet' | 'debtStockSheet'>) {
  return { Транзит: settings.debtTransitSheet || 'Транзит', Склад: settings.debtStockSheet || 'Склад' };
}
