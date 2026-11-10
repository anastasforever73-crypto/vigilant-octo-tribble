import type { Metric } from './lib/operational';
import type { NlpkPayable } from './lib/nlpk-payables';
import { nlpkTotal } from './lib/nlpk-payables';
import { rub } from './lib/live-data';
export default function NlpkPayablesPanel({ rows, configured, onConfigure, comparison, compare = true }: { rows?: NlpkPayable[]; configured?: boolean; onConfigure?: () => void; comparison?: Metric; compare?: boolean }) {
  const total = rows ? nlpkTotal(rows) : null;
  return <section className="panel nlpk-panel"><div className="panel-head"><div><h3>Кредиторская задолженность НЛПК</h3><p>{rows?.[0]?.date ? `Остаток на ${rows[0].date.split('-').reverse().join('.')}` : 'На последнюю дату не позже конца выбранного периода'}</p>{compare && comparison && <p>Сравнение: {comparison.value == null ? 'Нет данных' : rub(comparison.value)}{comparison.date && <> на {comparison.date.split('-').reverse().join('.')}</>}</p>}</div><strong>{total == null ? 'Нет данных' : rub(total)}</strong></div>
    {!rows?.length ? <p role="status">{configured ? 'Нет доступного снимка кредиторской задолженности НЛПК на выбранную дату.' : 'Подключите отдельный источник кредиторской задолженности НЛПК.'}</p> : <div className="scroll" tabIndex={0} role="region" aria-label="Документы кредиторской задолженности НЛПК"><table><thead><tr><th scope="col">Документ</th><th scope="col">Срок оплаты</th><th scope="col">Остаток долга</th><th scope="col">Комментарий</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.document || 'Сводный остаток НЛПК'}</td><td>{row.dueDate ? row.dueDate.split('-').reverse().join('.') : '—'}</td><td className="numeric">{rub(row.balance)}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}
    {onConfigure && <button type="button" className="reference-source-action" onClick={onConfigure}>Настроить источник НЛПК</button>}
  </section>;
}
