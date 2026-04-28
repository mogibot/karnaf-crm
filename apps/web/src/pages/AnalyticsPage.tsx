import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchAnalyticsSummary } from '@/lib/api';
import { STATUS_LABELS, formatRelative } from '@/lib/format';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export function AnalyticsPage() {
  const q = useQuery({ queryKey: ['analytics'], queryFn: fetchAnalyticsSummary });
  useDocumentTitle('אנליטיקה');

  if (q.isLoading) return <p className="text-slate-500">טוען נתונים...</p>;
  if (q.error) return <p className="text-rose-600">שגיאה: {(q.error as Error).message}</p>;
  if (!q.data) return null;

  const { sourcePerformance, aging, recentActivity, aiVsHuman, promptVariants } = q.data;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">אנליטיקה</h1>
        <button
          type="button" className="kf-btn kf-btn-ghost"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >{q.isFetching ? 'מרענן...' : 'רענון'}</button>
      </header>

      <section className="kf-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">ביצועים לפי מקור</h2>
        <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
          <table className="kf-table min-w-[44rem]">
            <thead>
              <tr>
                <th>מקור</th>
                <th>סה"כ</th>
                <th>פעילים</th>
                <th>הוסמך</th>
                <th>קישור רכישה</th>
                <th>נסגר</th>
                <th>אבד</th>
                <th>% המרה</th>
              </tr>
            </thead>
            <tbody>
              {sourcePerformance.length === 0 ? (
                <tr><td colSpan={8} className="p-4 text-center text-slate-500">אין נתונים.</td></tr>
              ) : sourcePerformance.map((row) => (
                <tr key={row.source}>
                  <td className="font-medium">{row.source}</td>
                  <td className="tabular-nums">{row.leads_total}</td>
                  <td className="tabular-nums">{row.leads_engaged}</td>
                  <td className="tabular-nums">{row.leads_qualified}</td>
                  <td className="tabular-nums">{row.leads_checkout_pushed}</td>
                  <td className="tabular-nums text-emerald-700">{row.leads_won}</td>
                  <td className="tabular-nums text-slate-500">{row.leads_lost}</td>
                  <td className="tabular-nums">
                    <ConversionBar pct={row.win_rate_pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="kf-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">זמן ממוצע במצב</h2>
          <div className="mt-3 space-y-2">
            {Object.entries(aging).map(([status, bucket]) => (
              <div key={status} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-slate-700">{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}</span>
                <span className="text-slate-500 tabular-nums">
                  {bucket.count} לידים · ממוצע {formatMinutes(bucket.avgMinutes)} · מקס׳ {formatMinutes(bucket.maxMinutes)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="kf-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">השפעת AI מול אדם על תוצאה</h2>
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-right text-slate-600">
                <tr><th className="p-2">תבנית מגע</th><th className="p-2">סטטוס</th><th className="p-2">לידים</th></tr>
              </thead>
              <tbody>
                {aiVsHuman.length === 0 ? (
                  <tr><td colSpan={3} className="p-4 text-center text-slate-500">אין נתונים.</td></tr>
                ) : aiVsHuman.map((row, i) => (
                  <tr key={`${row.touch_pattern}-${row.lead_status}-${i}`} className="border-t border-slate-100">
                    <td className="p-2">{row.touch_pattern}</td>
                    <td className="p-2">{STATUS_LABELS[row.lead_status as keyof typeof STATUS_LABELS] ?? row.lead_status}</td>
                    <td className="p-2 tabular-nums">{row.leads_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="kf-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">A/B תבניות prompt</h2>
          <span className="hidden text-xs text-slate-500 sm:inline">
            ניתן לערוך ב-`prompt_variants`. ברירת מחדל: גרסת config.
          </span>
        </div>
        {promptVariants.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            אין גרסאות מוגדרות. ה-AI ירוץ בגרסה היחידה שב-`crm_config.ai_runtime`.
          </p>
        ) : (
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="kf-table min-w-[44rem]">
              <thead>
                <tr>
                  <th>Playbook</th>
                  <th>Version</th>
                  <th>החלטות</th>
                  <th>הצליח</th>
                  <th>נחסם</th>
                  <th>לידים</th>
                  <th>נסגר</th>
                  <th>אבד</th>
                  <th>% המרה</th>
                </tr>
              </thead>
              <tbody>
                {promptVariants.map((v) => {
                  const winRate = v.leads_touched > 0 ? Math.round((v.leads_won / v.leads_touched) * 100) : 0;
                  return (
                    <tr key={`${v.playbook_name}::${v.prompt_version}`}>
                      <td className="font-medium">{v.playbook_name}</td>
                      <td className="tabular-nums"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{v.prompt_version}</code></td>
                      <td className="tabular-nums">{v.decisions_total}</td>
                      <td className="tabular-nums text-emerald-700">{v.success_total}</td>
                      <td className="tabular-nums text-rose-600">{v.blocked_total}</td>
                      <td className="tabular-nums">{v.leads_touched}</td>
                      <td className="tabular-nums text-emerald-700">{v.leads_won}</td>
                      <td className="tabular-nums text-slate-500">{v.leads_lost}</td>
                      <td className="tabular-nums"><ConversionBar pct={winRate} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kf-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">פעילות אחרונה</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {recentActivity.length === 0 ? (
            <li className="p-2 text-slate-500">אין אירועים ב־24 שעות אחרונות.</li>
          ) : recentActivity.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <Link to={`/leads/${row.lead_id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand-700">
                <strong>{row.event_type}</strong>{' · '}
                <span>{row.full_name || row.phone || row.lead_id.slice(0, 8)}</span>
              </Link>
              <span className="text-xs text-slate-500">{formatRelative(row.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ConversionBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <span
          className="block h-full rounded-full bg-gradient-to-l from-emerald-500 to-emerald-400"
          style={{ width: `${w}%` }}
        />
      </span>
      <span>{pct}%</span>
    </span>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} ד׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} שעות`;
  const days = Math.round(hours / 24);
  return `${days} ימים`;
}
