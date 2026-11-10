import type { QueryResultRow } from 'pg';
export type Row = QueryResultRow;
export interface Query<R extends Row = Row> extends PromiseLike<R[]> { catch: Promise<R[]>['catch']; finally: Promise<R[]>['finally']; }
export interface Sql {
  <R extends Row = Row>(strings: TemplateStringsArray, ...values: unknown[]): Query<R>;
  query<R extends Row = Row>(text: string, values?: unknown[]): Query<R>;
  transaction(queries: Query[] | ((sql: Sql) => Query[]), options?: { isolationLevel?: 'ReadUncommitted'|'ReadCommitted'|'RepeatableRead'|'Serializable'; readOnly?: boolean; deferrable?: boolean }): Promise<Row[][]>;
  close(): Promise<void>;
}
export function postgres(connectionString: string, options?: { statementTimeoutMs?: number; env?: NodeJS.ProcessEnv }): Sql;
export function closePools(): Promise<void>;
