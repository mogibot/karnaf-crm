import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchLeadsList } from '@/lib/api';
import { HeatBadge, OwnershipBadge, StatusBadge } from '@/components/Badge';
import { formatRelative, STATUS_LABELS, HEAT_LABELS, OWNERSHIP_LABELS } from '@/lib/format';
import type { LeadHeat, LeadStatus, OwnershipMode } from '@/lib/types';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const STATUSES: LeadStatus[] = [
  'new', 'first_contact_sent', 'responded', 'qualified', 'nurture',
  'checkout_pushed', 'payment_pending', 'human_handoff', 'won', 'lost', 'dormant',
];
const HEATS: LeadHeat[] = ['hot', 'warm', 'cool', 'cold'];
const OWNERS: OwnershipMode[] = ['ai_active', 'mia_active', 'phone_sales_pending', 'shared_watch', 'suppressed'];

const PAGE_SIZE = 50;

export function LeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [heat, setHeat] = useState(searchParams.get('heat') ?? '');
  const [ownership, setOwnership] = useState(searchParams.get('ownership') ?? '');
  const [offset, setOffset] = useState(0);
  useDocumentTitle('לידים');

  const debouncedSearch = useDebouncedValue(search, 200);

  // Reflect filters in the URL so they survive navigation/share.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (heat) next.set('heat', heat);
    if (ownership) next.set('ownership', ownership);
    setSearchParams(next, { replace: true });
  }, [status, heat, ownership, setSearchParams]);

  const params = {
    search: debouncedSearch.trim() || undefined,
    status: status || undefined,
    heat: heat || undefined,
    ownershipMode: ownership || undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const q = useQuery({
    queryKey: ['leads', params],
    queryFn: () => fetchLeadsList(params),
    placeholderData: (prev) => prev,
  });

  const total = q.data?.total ?? null;
  const start = total != null ? offset + 1 : null;
  const end = total != null ? Math.min(offset + (q.data?.leads.length ?? 0), total) : null;
  const hasFilters = !!(search || status || heat || ownership);

  function clearFilters() {
    setSearch(''); setStatus(''); setHeat(''); setOwnership(''); setOffset(0);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">לידים</h1>
        <span className="text-sm text-slate-500">{total != null ? `${total} סה"כ` : ''}</span>
      </header>

      <div className="kf-card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-5">
        <div className="sm:col-span-2 md:col-span-2">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-slate-400">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="9" cy="9" r="5.5" /><path strokeLinecap="round" d="m13.5 13.5 3 3" />
              </svg>
            </span>
            <input
              className="kf-input pe-9"
              placeholder="חיפוש לפי שם / טלפון / אימייל"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            />
          </div>
        </div>
        <select className="kf-input" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">כל הסטטוסים</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select className="kf-input" value={heat} onChange={(e) => { setHeat(e.target.value); setOffset(0); }}>
          <option value="">כל החום</option>
          {HEATS.map((h) => <option key={h} value={h}>{HEAT_LABELS[h]}</option>)}
        </select>
        <select className="kf-input" value={ownership} onChange={(e) => { setOwnership(e.target.value); setOffset(0); }}>
          <option value="">כל הבעלויות</option>
          {OWNERS.map((o) => <option key={o} value={o}>{OWNERSHIP_LABELS[o]}</option>)}
        </select>
        {hasFilters ? (
          <div className="sm:col-span-2 md:col-span-5">
            <button type="button" className="kf-btn kf-btn-ghost text-xs" onClick={clearFilters}>
              ניקוי סינונים
            </button>
          </div>
        ) : null}
      </div>

      <div className="kf-card overflow-hidden md:overflow-visible">
        <table className="kf-table kf-table-responsive">
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              <th>סטטוס</th>
              <th>חום</th>
              <th>בעלות</th>
              <th>ציון</th>
              <th>עודכן</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-500">טוען...</td></tr>
            ) : q.data && q.data.leads.length > 0 ? (
              q.data.leads.map((lead) => (
                <tr key={lead.id}>
                  <td data-primary>
                    <Link to={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
                      {lead.full_name || '—'}
                    </Link>
                    {lead.email ? (
                      <div className="text-xs text-slate-500 break-all">{lead.email}</div>
                    ) : null}
                  </td>
                  <td data-label="טלפון" className="tabular-nums">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="hover:text-brand-700 hover:underline">{lead.phone}</a>
                    ) : '—'}
                  </td>
                  <td data-label="סטטוס"><StatusBadge status={lead.lead_status} /></td>
                  <td data-label="חום"><HeatBadge heat={lead.lead_heat} /></td>
                  <td data-label="בעלות"><OwnershipBadge ownership={lead.ownership_mode} /></td>
                  <td data-label="ציון" className="tabular-nums">{lead.lead_score}</td>
                  <td data-label="עודכן" className="text-slate-500" title={lead.updated_at}>{formatRelative(lead.updated_at)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} className="p-10 text-center text-slate-500">
                <div className="flex flex-col items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m16 16 4 4" />
                  </svg>
                  <span>אין לידים תואמים.</span>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button type="button" className="kf-btn" disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>הקודם</button>
        <span className="text-slate-500 tabular-nums">
          {start != null && end != null ? `${start}–${end} מתוך ${total}` : `עמוד ${Math.floor(offset / PAGE_SIZE) + 1}`}
        </span>
        <button type="button" className="kf-btn"
                disabled={!q.data || q.data.leads.length < PAGE_SIZE}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}>הבא</button>
      </div>
    </div>
  );
}
