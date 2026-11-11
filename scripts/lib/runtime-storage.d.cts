export { postgres } from './postgres.cjs';
export function temporaryStorage(): boolean;
export function storageEnabled(): boolean;
export function memoryKey(): Buffer;
export function memoryStatus(): { temporary: boolean; revision: number; lastDownload: string | null; dirty: boolean };
export function markDownloaded(revision: number): void;
export function environmentOverride(): Record<string, string> | null;
export function setEnvironmentOverride(value: Record<string, string>): void;
export function temporaryTransaction<T>(write: boolean, fn: (tx: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>, expectedRevision?: number): Promise<T>;
