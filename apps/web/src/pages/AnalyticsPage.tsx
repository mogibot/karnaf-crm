import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchAnalyticsSummary } from '@/lib/api';
import { STATUS_LABELS, formatRelative } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

type DateRangePreset = 'all' | '7d' | '30d' | '90d' | 'custom';

function presetToRange(preset: DateRangePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === 'all') return { from: '', to: '' };
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 0;
  if (days === 0) return { from: '', to: '' };
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

function toIsoStartOfDay(d: string): string | undefined {
  if (!d) return undefined;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}
function toIsoEndOfDay(d: string): string | undefined {
  if (!d) return undefined;
  const t = Date.parse(`${d}T23:59:59Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export function AnalyticsPage() {
  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo(() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    return presetToRange(preset);
  }, [preset, customFrom, customTo]);

  const drillFromIso = toIsoStartOfDay(range.from);
  const drillToIso = toIsoEndOfDay(range.to);

  const q = useQuery({
    queryKey: ['analytics', range.from, range.to],
    queryFn: fetchAnalyticsSummary,
  });
  useDocumentTitle(t('analytics_title'));

  if (q.isLoading) return <p className="text-slate-500">{t('loading')} נתונים...</p>;
  if (q.error) return <p className="text-rose-600">{t('error_prefix')}: {(q.error as Error).message}</p>;
  if (!q.data) return null;

  const { sourcePerformance, aging, recentActivity, aiVsHuman, promptVariants, cohorts, firstResponseTimes } = q.data;

  function leadsLinkFor(opts: { source?: string; status?: string }): string {
    const sp = new URLSearchParams();
    if (opts.source) sp.set('source', opts.source);
    if (opts.status) sp.set('status', opts.status);
    if (drillFromIso) sp.set('from', drillFromIso);
    if (drillToIso) sp.set('to', drillToIso);
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : '/leads';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics_title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            onPreset={setPreset}
            onCustomFrom={setCustomFrom}
            onCustomTo={setCustomTo}
          />
          <button
            type="button" className="kf-btn kf-btn-ghost text-xs"
            onClick={() => downloadAnalyticsCsv(q.data)}
          >ייצוא CSV</button>
          <button
            type="button" className="kf-btn kf-btn-ghost"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >{q.isFetching ? t('refreshing') : t('refresh')}</button>
        </div>
      </header>
      {(range.from || range.to) ? (
        <p className="text-xs text-slate-500">
          טווח: {range.from || '∞'} → {range.to || 'היום'} · הערה: סיכומי-מקור ו-cohorts מתבססים על תצוגות מצטברות; טווח התאריכים פעיל בעיקר על drill-down לרשימת לידים.
        </p>
      ) : null}

      <section className="kf-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{t('analytics_by_source')}</h2>
        <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
          <table className="kf-table min-w-[44rem]">
            <thead>
              <tr>
                <th>{t('analytics_source')}</th>
                <th>{t('analytics_total')}</th>
                <th>{t('analytics_engaged')}</th>
                <th>{t('analytics_qualified')}</th>
                <th>{t('analytics_checkout')}</th>
                <th>{t('analytics_won')}</th>
                <th>{t('analytics_lost')}</th>
                <th>{t('analytics_conversion_pct')}</th>
              </tr>
            </thead>
            <tbody>
              {sourcePerformance.length === 0 ? (
                <tr><td colSpan={8} className="p-4 text-center text-slate-500">{t('analytics_no_data')}</td></tr>
              ) : sourcePerformance.map((row) => (
                <tr key={row.source}>
                  <td className="font-medium">
                    <Link to={leadsLinkFor({ source: row.source })} className="text-brand-700 hover:underline">
                      {row.source}
                    </Link>
                  </td>
                  <td className="tabular-nums">
                    <Link to={leadsLinkFor({ source: row.source })} className="hover:text-brand-700">{row.leads_total}</Link>
                  </td>
                  <td className="tabular-nums">{row.leads_engaged}</td>
                  <td className="tabular-nums">{row.leads_qualified}</td>
                  <td className="tabular-nums">{row.leads_checkout_pushed}</td>
                  <td className="tabular-nums text-emerald-700">
                    <Link to={leadsLinkFor({ source: row.source, status: 'won' })} className="hover:underline">{row.leads_won}</Link>
                  </td>
                  <td className="tabular-nums text-slate-500">
                    <Link to={leadsLinkFor({ source: row.source, status: 'lost' })} className="hover:underline">{row.leads_lost}</Link>
                  </td>
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
          <h2 className="text-lg font-semibold">{t('analytics_avg_time_in_status')}</h2>
          <div className="mt-3 space-y-2">
            {Object.entries(aging).map(([status, bucket]) => (
              <div key={status} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-slate-700">{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}</span>
                <span className="text-slate-500 tabular-nums">
                  {bucket.count} {t('analytics_leads_count_suffix')} · {t('analytics_average_prefix')} {formatMinutes(bucket.avgMinutes)} · {t('analytics_max_prefix')} {formatMinutes(bucket.maxMinutes)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="kf-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{t('analytics_ai_vs_human')}</h2>
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-right text-slate-600">
                <tr><th className="p-2">{t('analytics_touch_pattern')}</th><th className="p-2">{t('analytics_status')}</th><th className="p-2">{t('analytics_leads')}</th></tr>
              </thead>
              <tbody>
                {aiVsHuman.length === 0 ? (
                  <tr><td colSpan={3} className="p-4 text-center text-slate-500">{t('analytics_no_data')}</td></tr>
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
          <h2 className="text-lg font-semibold">{t('analytics_first_response_title')}</h2>
          <span className="hidden text-xs text-slate-500 sm:inline">{t('analytics_first_response_sla')}</span>
        </div>
        {firstResponseTimes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('analytics_first_response_empty')}</p>
        ) : (
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="kf-table min-w-[36rem]">
              <thead>
                <tr>
                  <th>{t('analytics_source')}</th>
                  <th>{t('analytics_measured')}</th>
                  <th>{t('analytics_median')}</th>
                  <th>{t('analytics_p90')}</th>
                  <th>{t('analytics_max')}</th>
                  <th>{t('analytics_unanswered')}</th>
                </tr>
              </thead>
              <tbody>
                {firstResponseTimes.map((row) => (
                  <tr key={row.source}>
                    <td className="font-medium">
                      <Link to={leadsLinkFor({ source: row.source })} className="text-brand-700 hover:underline">{row.source}</Link>
                    </td>
                    <td className="tabular-nums">{row.measured_leads}</td>
                    <td className="tabular-nums">{formatMinutes(row.p50_minutes)}</td>
                    <td className="tabular-nums">{formatMinutes(row.p90_minutes)}</td>
                    <td className="tabular-nums">{formatMinutes(row.max_minutes)}</td>
                    <td className={row.unanswered_leads > 0 ? 'tabular-nums text-rose-700' : 'tabular-nums text-slate-500'}>
                      {row.unanswered_leads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kf-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('analytics_cohorts_title')}</h2>
          <span className="hidden text-xs text-slate-500 sm:inline">{t('analytics_cohorts_hint')}</span>
        </div>
        {cohorts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('analytics_no_data_yet')}</p>
        ) : (
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="kf-table min-w-[44rem]">
              <thead>
                <tr>
                  <th>{t('analytics_week')}</th>
                  <th>{t('analytics_source')}</th>
                  <th>{t('analytics_total')}</th>
                  <th>{t('analytics_responded')}</th>
                  <th>{t('analytics_qualified')}</th>
                  <th>{t('analytics_checkout')}</th>
                  <th>{t('analytics_won')}</th>
                  <th>{t('analytics_lost')}</th>
                  <th>{t('analytics_conversion_pct')}</th>
                  <th>{t('analytics_days_to_win')}</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c, i) => (
                  <tr key={`${c.cohort_week}::${c.source}::${i}`}>
                    <td className="tabular-nums">{formatWeek(c.cohort_week)}</td>
                    <td className="font-medium">
                      <Link to={leadsLinkFor({ source: c.source })} className="text-brand-700 hover:underline">{c.source}</Link>
                    </td>
                    <td className="tabular-nums">{c.leads_total}</td>
                    <td className="tabular-nums">{c.responded}</td>
                    <td className="tabular-nums">{c.qualified}</td>
                    <td className="tabular-nums">{c.checkout_pushed}</td>
                    <td className="tabular-nums text-emerald-700">{c.won}</td>
                    <td className="tabular-nums text-slate-500">{c.lost}</td>
                    <td className="tabular-nums">{c.win_rate_pct}%</td>
                    <td className="tabular-nums">{c.avg_minutes_to_win > 0 ? Math.round(c.avg_minutes_to_win / 60 / 24) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kf-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('analytics_prompt_ab')}</h2>
          <span className="hidden text-xs text-slate-500 sm:inline">
            {t('analytics_prompt_hint')}
          </span>
        </div>
        {promptVariants.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {t('analytics_prompt_empty')}
          </p>
        ) : (
          <div className="mt-3 -mx-4 overflow-x-auto sm:mx-0">
            <table className="kf-table min-w-[44rem]">
              <thead>
                <tr>
                  <th>{t('analytics_playbook')}</th>
                  <th>{t('analytics_version')}</th>
                  <th>{t('analytics_decisions')}</th>
                  <th>{t('analytics_success')}</th>
                  <th>{t('analytics_blocked')}</th>
                  <th>{t('analytics_leads')}</th>
                  <th>{t('analytics_won')}</th>
                  <th>{t('analytics_lost')}</th>
                  <th>{t('analytics_conversion_pct')}</th>
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
        <h2 className="text-lg font-semibold">{t('analytics_recent_activity')}</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {recentActivity.length === 0 ? (
            <li className="p-2 text-slate-500">{t('analytics_recent_empty')}</li>
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

function formatWeek(iso: string): string {
  // Display the cohort start date (Monday) as a short DD/MM/YY label.
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

// ── Date range picker (P3.1) ─────────────────────────────────────────────
function DateRangePicker({
  preset, customFrom, customTo, onPreset, onCustomFrom, onCustomTo,
}: {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
  onPreset: (p: DateRangePreset) => void;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className="kf-input text-sm" value={preset} onChange={(e) => onPreset(e.target.value as DateRangePreset)}>
        <option value="all">כל הזמן</option>
        <option value="7d">7 ימים אחרונים</option>
        <option value="30d">30 ימים אחרונים</option>
        <option value="90d">90 ימים אחרונים</option>
        <option value="custom">טווח מותאם</option>
      </select>
      {preset === 'custom' ? (
        <>
          <input type="date" className="kf-input text-sm" value={customFrom} onChange={(e) => onCustomFrom(e.target.value)} />
          <span className="text-slate-400">→</span>
          <input type="date" className="kf-input text-sm" value={customTo} onChange={(e) => onCustomTo(e.target.value)} />
        </>
      ) : null}
    </div>
  );
}

// ── CSV export (P3.1) ────────────────────────────────────────────────────
// Wraps the analytics summary into a multi-section CSV — section headers
// as blank-line-separated blocks. Excel reads UTF-8 BOM + handles RTL
// Hebrew without import-as-data fiddling.
type AnalyticsSummary = Awaited<ReturnType<typeof fetchAnalyticsSummary>>;

function csvEsc(s: unknown): string {
  const v = s == null ? '' : String(s);
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadAnalyticsCsv(data: AnalyticsSummary) {
  const blocks: string[][] = [];

  blocks.push(['Source performance']);
  blocks.push(['source', 'total', 'engaged', 'qualified', 'checkout', 'won', 'lost', 'win_rate_pct']);
  for (const r of data.sourcePerformance) {
    blocks.push([r.source, String(r.leads_total), String(r.leads_engaged), String(r.leads_qualified),
      String(r.leads_checkout_pushed), String(r.leads_won), String(r.leads_lost), String(r.win_rate_pct)]);
  }
  blocks.push(['']);

  blocks.push(['Aging by status (avg / max minutes)']);
  blocks.push(['status', 'count', 'avg_minutes', 'max_minutes']);
  for (const [status, b] of Object.entries(data.aging)) {
    blocks.push([status, String(b.count), String(b.avgMinutes), String(b.maxMinutes)]);
  }
  blocks.push(['']);

  blocks.push(['First-response SLA']);
  blocks.push(['source', 'measured', 'p50_min', 'p90_min', 'max_min', 'unanswered']);
  for (const r of data.firstResponseTimes) {
    blocks.push([r.source, String(r.measured_leads), String(r.p50_minutes),
      String(r.p90_minutes), String(r.max_minutes), String(r.unanswered_leads)]);
  }
  blocks.push(['']);

  blocks.push(['Cohorts (per week × source)']);
  blocks.push(['cohort_week', 'source', 'total', 'responded', 'qualified', 'checkout', 'won', 'lost', 'win_rate_pct', 'avg_minutes_to_win']);
  for (const c of data.cohorts) {
    blocks.push([c.cohort_week, c.source, String(c.leads_total), String(c.responded),
      String(c.qualified), String(c.checkout_pushed), String(c.won), String(c.lost),
      String(c.win_rate_pct), String(c.avg_minutes_to_win ?? '')]);
  }

  const csv = blocks.map((row) => row.map(csvEsc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `karnaf-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
