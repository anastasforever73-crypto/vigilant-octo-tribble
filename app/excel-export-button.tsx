'use client';
import { useRef, useState } from 'react';
import type { ExportOptions } from './lib/excel-report';
import './excel-export.css';

export default function ExcelExportButton({ options, disabled = false }: { options: ExportOptions; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function download() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ section: options.section, start: options.start, end: options.end, compare: options.compare ? '1' : '0' });
      if (options.asOf) params.set('asOf', options.asOf);
      if (options.segment) params.set('segment', options.segment);
      const response = await fetch(`/api/export?${params}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Сессия завершена. Войдите снова.' : response.status === 403 ? 'Нет доступа к этому отчёту.' : 'Не удалось сформировать Excel. Повторите попытку позже.');
      if (!response.headers.get('content-type')?.includes('spreadsheetml')) throw new Error('Сервер не вернул файл Excel. Повторите попытку.');
      const blob = await response.blob();
      const filename = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename ? decodeURIComponent(filename) : 'Отчёт.xlsx';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось скачать Excel. Повторите попытку.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="excel-export">
    <button type="button" className="excel-export-button" disabled={disabled || busy} onClick={download} aria-busy={busy}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3h12v18H9" fill="#21A366"/><path d="M12 7h7M12 11h7M12 15h7M16 5v14" stroke="white"/><rect x="1" y="6" width="12" height="13" rx="1" fill="#107C41"/><path d="m4 9 6 7m0-7-6 7" stroke="white" strokeWidth="1.7"/></svg>
      {busy ? 'Формируем Excel…' : 'Скачать Excel'}
    </button>
    {error && <p className="excel-export-error" role="alert">{error}</p>}
  </div>;
}
