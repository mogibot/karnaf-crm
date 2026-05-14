import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchLeadsList, postCreateLead, postBulkPatchLeads,
  fetchSavedLeadFilters, createSavedLeadFilter, deleteSavedLeadFilter,
  type CreateLeadPayload, type LeadsListSortColumn, type SortDir,
  type SavedLeadFilter,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { HeatBadge, OwnershipBadge, StatusBadge } from '@/components/Badge';
import { formatRelative, STATUS_LABELS, HEAT_LABELS, OWNERSHIP_LABELS } from '@/lib/format';
import type { LeadHeat, LeadStatus, OwnershipMode } from '@/lib/types';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useRealtimeInvalidate } from '@/lib/useRealtimeInvalidate';
import { useAuth } from '@/auth/auth-context';
import { t } from '@/lib/i18n';

const REALTIME_LEADS_KEYS: Array<readonly unknown[]> = [['leads']];

const STATUSES: LeadStatus[] = [
  'new', 'first_contact_sent', 'responded', 'qualified', 'nurture',
  'checkout_pushed', 'payment_pending', 'human_handoff', 'won', 'lost', 'dormant',
];
const HEATS: LeadHeat[] = ['hot', 'warm', 'cool', 'cold'];
const OWNERS: OwnershipMode[] = ['ai_active', 'mia_active', 'phone_sales_pending', 'shared_watch', 'suppressed'];
const MANUAL_SOURCES = [
  'manual_entry', 'whatsapp_direct', 'instagram_dm', 'facebook_lead_ad',
  'landing_page', 'webinar', 'responder_form', 'lead_magnet', 'screenshot_manual', 'unknown',
];

const PAGE_SIZE = 50;

export function LeadsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [heat, setHeat] = useState(searchParams.get('heat') ?? '');
  const [ownership, setOwnership] = useState(searchParams.get('ownership') ?? '');
  // Analytics drill-down can land here with source + date range pre-applied.
  const [source, setSource] = useState(searchParams.get('source') ?? '');
  const [fromIso, setFromIso] = useState(searchParams.get('from') ?? '');
  const [toIso, setToIso] = useState(searchParams.get('to') ?? '');
  const [offset, setOffset] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [sortBy, setSortBy] = useState<LeadsListSortColumn>(
    (searchParams.get('sortBy') as LeadsListSortColumn) || 'updated_at',
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    (searchParams.get('sortDir') as SortDir) || 'desc',
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toast = useToast();
  useDocumentTitle(t('leads_title'));

  const canBulk = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia';

  const canCreate = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia' || auth.role === 'sales_rep';

  const createMutation = useMutation({
    mutationFn: (payload: CreateLeadPayload) => postCreateLead(payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowCreate(false);
      navigate(`/leads/${res.lead.id}`);
    },
  });

  const debouncedSearch = useDebouncedValue(search, 200);

  // Reflect filters + sort in the URL so they survive navigation/share.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (heat) next.set('heat', heat);
    if (ownership) next.set('ownership', ownership);
    if (source) next.set('source', source);
    if (fromIso) next.set('from', fromIso);
    if (toIso) next.set('to', toIso);
    if (sortBy !== 'updated_at') next.set('sortBy', sortBy);
    if (sortDir !== 'desc') next.set('sortDir', sortDir);
    setSearchParams(next, { replace: true });
  }, [status, heat, ownership, source, fromIso, toIso, sortBy, sortDir, setSearchParams]);

  const params = {
    search: debouncedSearch.trim() || undefined,
    status: status || undefined,
    heat: heat || undefined,
    ownershipMode: ownership || undefined,
    source: source || undefined,
    from: fromIso || undefined,
    to: toIso || undefined,
    sortBy,
    sortDir,
    limit: PAGE_SIZE,
    offset,
  };

  function onSortClick(col: LeadsListSortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
    setOffset(0);
  }

  // Reset selection whenever the underlying filter/page changes — leads
  // we can no longer see shouldn't stay "selected" invisibly.
  useEffect(() => { setSelectedIds(new Set()); }, [status, heat, ownership, debouncedSearch, sortBy, sortDir, offset]);

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = (q.data?.leads ?? []).map((l) => l.id);
    setSelectedIds((prev) => {
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  // ── Saved filters (P3.4) ───────────────────────────────────────────────
  const savedFiltersQ = useQuery({
    queryKey: ['lead-saved-filters'],
    queryFn: fetchSavedLeadFilters,
    staleTime: 60_000,
  });
  const saveFilter = useMutation({
    mutationFn: createSavedLeadFilter,
    onSuccess: () => {
      toast.success('סינון נשמר');
      queryClient.invalidateQueries({ queryKey: ['lead-saved-filters'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const removeFilter = useMutation({
    mutationFn: deleteSavedLeadFilter,
    onSuccess: () => {
      toast.success('סינון נמחק');
      queryClient.invalidateQueries({ queryKey: ['lead-saved-filters'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function currentFilterAsJson(): Record<string, string> {
    const obj: Record<string, string> = {};
    if (status) obj.status = status;
    if (heat) obj.heat = heat;
    if (ownership) obj.ownership = ownership;
    if (sortBy !== 'updated_at') obj.sortBy = sortBy;
    if (sortDir !== 'desc') obj.sortDir = sortDir;
    return obj;
  }

  function applySavedFilter(f: SavedLeadFilter) {
    const j = f.filter_json ?? {};
    setStatus(typeof j.status === 'string' ? j.status : '');
    setHeat(typeof j.heat === 'string' ? j.heat : '');
    setOwnership(typeof j.ownership === 'string' ? j.ownership : '');
    setSortBy((j.sortBy as LeadsListSortColumn) || 'updated_at');
    setSortDir((j.sortDir as SortDir) || 'desc');
    setOffset(0);
  }

  const bulkPatch = useMutation({
    mutationFn: (patch: Parameters<typeof postBulkPatchLeads>[0]['patch']) =>
      postBulkPatchLeads({ leadIds: Array.from(selectedIds), patch }),
    onSuccess: (res) => {
      toast.success(`עודכנו ${res.matched} לידים`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function exportSelectedToCsv() {
    const ids = Array.from(selectedIds);
    const rows = (q.data?.leads ?? []).filter((l) => ids.includes(l.id));
    if (rows.length === 0) return;
    const cols: Array<[string, (l: typeof rows[number]) => string | null | undefined]> = [
      ['id', (l) => l.id],
      ['full_name', (l) => l.full_name],
      ['phone', (l) => l.phone],
      ['email', (l) => l.email],
      ['source', (l) => l.source],
      ['lead_status', (l) => l.lead_status],
      ['lead_heat', (l) => l.lead_heat],
      ['ownership_mode', (l) => l.ownership_mode],
      ['lead_score', (l) => String(l.lead_score)],
      ['updated_at', (l) => l.updated_at],
    ];
    const esc = (s: string | null | undefined) => {
      const v = s ?? '';
      // RFC 4180: wrap in quotes when value contains comma / quote / newline.
      if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [
      cols.map((c) => c[0]).join(','),
      ...rows.map((r) => cols.map((c) => esc(c[1](r))).join(',')),
    ];
    // UTF-8 BOM so Excel auto-detects Hebrew text encoding correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `karnaf-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.info(`יוצאו ${rows.length} לידים ל-CSV`);
  }

  const q = useQuery({
    queryKey: ['leads', params],
    queryFn: () => fetchLeadsList(params),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });

  // New leads or status changes → refresh table without a manual reload.
  // Falls back silently to the 30s poll if realtime isn't enabled on the table.
  useRealtimeInvalidate('leads', REALTIME_LEADS_KEYS);

  const total = q.data?.total ?? null;
  const start = total != null ? offset + 1 : null;
  const end = total != null ? Math.min(offset + (q.data?.leads.length ?? 0), total) : null;
  const hasFilters = !!(search || status || heat || ownership || source || fromIso || toIso);

  function clearFilters() {
    setSearch(''); setStatus(''); setHeat(''); setOwnership('');
    setSource(''); setFromIso(''); setToIso('');
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('leads_title')}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{total != null ? `${total} ${t('total_count')}` : ''}</span>
          {canCreate ? (
            <button
              type="button"
              className="kf-btn kf-btn-primary"
              onClick={() => setShowCreate((s) => !s)}
            >
              {showCreate ? 'ביטול' : '+ ליד חדש'}
            </button>
          ) : null}
        </div>
      </header>

      {showCreate ? (
        <CreateLeadInlineForm
          pending={createMutation.isPending}
          error={createMutation.error instanceof Error ? createMutation.error.message : null}
          onSubmit={(payload) => createMutation.mutate(payload)}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

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
              placeholder={t('search_placeholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            />
          </div>
        </div>
        <select className="kf-input" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">{t('filter_all_statuses')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select className="kf-input" value={heat} onChange={(e) => { setHeat(e.target.value); setOffset(0); }}>
          <option value="">{t('filter_all_heat')}</option>
          {HEATS.map((h) => <option key={h} value={h}>{HEAT_LABELS[h]}</option>)}
        </select>
        <select className="kf-input" value={ownership} onChange={(e) => { setOwnership(e.target.value); setOffset(0); }}>
          <option value="">{t('filter_all_ownership')}</option>
          {OWNERS.map((o) => <option key={o} value={o}>{OWNERSHIP_LABELS[o]}</option>)}
        </select>
        {(source || fromIso || toIso) ? (
          <div className="sm:col-span-2 md:col-span-5 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">סינון ניווט:</span>
            {source ? <span className="kf-badge kf-badge-mute">מקור: {source}</span> : null}
            {fromIso ? <span className="kf-badge kf-badge-mute">מ: {fromIso.slice(0, 10)}</span> : null}
            {toIso ? <span className="kf-badge kf-badge-mute">עד: {toIso.slice(0, 10)}</span> : null}
          </div>
        ) : null}
        <SavedFiltersPicker
          savedFilters={savedFiltersQ.data ?? []}
          hasFiltersNow={hasFilters || sortBy !== 'updated_at' || sortDir !== 'desc'}
          onApply={applySavedFilter}
          onSaveCurrent={(name, isShared) =>
            saveFilter.mutate({ name, filter_json: currentFilterAsJson(), is_shared: isShared })
          }
          onDelete={(id) => removeFilter.mutate(id)}
          saving={saveFilter.isPending}
        />
        {hasFilters ? (
          <div className="sm:col-span-2 md:col-span-5">
            <button type="button" className="kf-btn kf-btn-ghost text-xs" onClick={clearFilters}>
              {t('filter_clear')}
            </button>
          </div>
        ) : null}
      </div>

      {canBulk && selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          pending={bulkPatch.isPending}
          onClear={() => setSelectedIds(new Set())}
          onMarkDormant={() => bulkPatch.mutate({ lead_status: 'dormant' })}
          onAssignMia={() => bulkPatch.mutate({ ownership_mode: 'mia_active' })}
          onAssignAi={() => bulkPatch.mutate({ ownership_mode: 'ai_active' })}
          onExportCsv={exportSelectedToCsv}
        />
      ) : null}

      <div className="kf-card overflow-hidden md:overflow-visible">
        <table className="kf-table kf-table-responsive">
          <thead>
            <tr>
              {canBulk ? (
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="בחר את כל הלידים בעמוד"
                    checked={(q.data?.leads ?? []).length > 0
                      && (q.data?.leads ?? []).every((l) => selectedIds.has(l.id))}
                    onChange={toggleSelectAllVisible}
                  />
                </th>
              ) : null}
              <SortableTh label={t('table_name')}     col="full_name"         sortBy={sortBy} sortDir={sortDir} onClick={onSortClick} />
              <th>{t('table_phone')}</th>
              <SortableTh label={t('table_status')}   col="lead_status"       sortBy={sortBy} sortDir={sortDir} onClick={onSortClick} />
              <SortableTh label={t('table_heat')}     col="lead_heat"         sortBy={sortBy} sortDir={sortDir} onClick={onSortClick} />
              <th>{t('table_ownership')}</th>
              <SortableTh label={t('table_score')}    col="lead_score"        sortBy={sortBy} sortDir={sortDir} onClick={onSortClick} />
              <SortableTh label={t('table_updated')}  col="updated_at"        sortBy={sortBy} sortDir={sortDir} onClick={onSortClick} />
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={canBulk ? 8 : 7} className="p-6 text-center text-slate-500">{t('loading')}</td></tr>
            ) : q.data && q.data.leads.length > 0 ? (
              q.data.leads.map((lead) => (
                <tr key={lead.id}>
                  {canBulk ? (
                    <td className="w-8">
                      <input
                        type="checkbox"
                        aria-label={`בחר ${lead.full_name || lead.phone || lead.id}`}
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleRow(lead.id)}
                      />
                    </td>
                  ) : null}
                  <td data-primary>
                    <Link to={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
                      {lead.full_name || '—'}
                    </Link>
                    {lead.email ? (
                      <div className="text-xs text-slate-500 break-all">{lead.email}</div>
                    ) : null}
                  </td>
                  <td data-label={t('table_phone')} className="tabular-nums">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="hover:text-brand-700 hover:underline">{lead.phone}</a>
                    ) : '—'}
                  </td>
                  <td data-label={t('table_status')}><StatusBadge status={lead.lead_status} /></td>
                  <td data-label={t('table_heat')}><HeatBadge heat={lead.lead_heat} /></td>
                  <td data-label={t('table_ownership')}><OwnershipBadge ownership={lead.ownership_mode} /></td>
                  <td data-label={t('table_score')} className="tabular-nums">{lead.lead_score}</td>
                  <td data-label={t('table_updated')} className="text-slate-500" title={lead.updated_at}>{formatRelative(lead.updated_at)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={canBulk ? 8 : 7} className="p-10 text-center text-slate-500">
                <div className="flex flex-col items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m16 16 4 4" />
                  </svg>
                  <span>{t('no_matching_leads')}</span>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button type="button" className="kf-btn" disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>{t('pagination_prev')}</button>
        <span className="text-slate-500 tabular-nums">
          {start != null && end != null ? `${start}–${end} מתוך ${total}` : `עמוד ${Math.floor(offset / PAGE_SIZE) + 1}`}
        </span>
        <button type="button" className="kf-btn"
                disabled={!q.data || q.data.leads.length < PAGE_SIZE}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}>{t('pagination_next')}</button>
      </div>
    </div>
  );
}

interface CreateLeadInlineFormProps {
  pending: boolean;
  error: string | null;
  onSubmit: (payload: CreateLeadPayload) => void;
  onCancel: () => void;
}

function CreateLeadInlineForm({ pending, error, onSubmit, onCancel }: CreateLeadInlineFormProps) {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('manual_entry');
  const [sourceDetail, setSourceDetail] = useState('');
  const [notesInternal, setNotesInternal] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() && !email.trim()) return;
    onSubmit({
      phone: phone.trim() || null,
      email: email.trim() || null,
      fullName: fullName.trim() || null,
      source,
      sourceDetail: sourceDetail.trim() || null,
      notesInternal: notesInternal.trim() || null,
    });
  }

  return (
    <form className="kf-card space-y-3 p-4" onSubmit={handleSubmit}>
      <div className="text-sm font-semibold text-slate-700">יצירת ליד חדש</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-500">טלפון (חובה אם אין אימייל)</span>
          <input
            className="kf-input mt-1"
            placeholder="050-1234567 או +972501234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
            inputMode="tel"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">אימייל (חובה אם אין טלפון)</span>
          <input
            className="kf-input mt-1"
            type="email"
            placeholder="lead@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">שם מלא</span>
          <input
            className="kf-input mt-1"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">מקור</span>
          <select className="kf-input mt-1" value={source} onChange={(e) => setSource(e.target.value)}>
            {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-slate-500">פירוט מקור (אופציונלי)</span>
          <input
            className="kf-input mt-1"
            placeholder="למשל: קמפיין מאי 2026 / שיחת רחוב / הפנייה מ-X"
            value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-slate-500">הערות פנימיות (לא מוצגות לליד)</span>
          <textarea
            className="kf-input mt-1"
            rows={2}
            value={notesInternal}
            onChange={(e) => setNotesInternal(e.target.value)}
          />
        </label>
      </div>
      {error ? <div className="text-sm text-rose-700">{error}</div> : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="kf-btn kf-btn-ghost" onClick={onCancel} disabled={pending}>ביטול</button>
        <button
          type="submit"
          className="kf-btn kf-btn-primary"
          disabled={pending || (!phone.trim() && !email.trim())}
        >
          {pending ? 'יוצר…' : 'צור ליד'}
        </button>
      </div>
    </form>
  );
}

// ── Saved filters picker (P3.4) ──────────────────────────────────────────
function SavedFiltersPicker({
  savedFilters, hasFiltersNow, onApply, onSaveCurrent, onDelete, saving,
}: {
  savedFilters: SavedLeadFilter[];
  hasFiltersNow: boolean;
  onApply: (f: SavedLeadFilter) => void;
  onSaveCurrent: (name: string, isShared: boolean) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const [isShared, setIsShared] = useState(false);

  function save() {
    const n = name.trim();
    if (!n) return;
    onSaveCurrent(n, isShared);
    setName(''); setIsShared(false); setShowSave(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 md:col-span-5">
      {savedFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-slate-500">סינונים שמורים:</span>
          {savedFilters.map((f) => (
            <span key={f.id} className="inline-flex items-center">
              <button
                type="button"
                className="kf-btn kf-btn-ghost text-xs"
                onClick={() => onApply(f)}
                title={f.is_shared ? 'שמור לכולם' : 'שלך בלבד'}
              >
                {f.name}{f.is_shared ? ' 👥' : ''}
              </button>
              <button
                type="button"
                className="text-rose-500 hover:text-rose-700 text-xs px-1"
                aria-label={`מחק ${f.name}`}
                onClick={() => { if (window.confirm(`למחוק "${f.name}"?`)) onDelete(f.id); }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {hasFiltersNow ? (
        showSave ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="kf-input text-sm w-44"
              placeholder='שם לסינון הזה'
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <label className="inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
              <span>שתף לכולם</span>
            </label>
            <button type="button" className="kf-btn kf-btn-primary text-xs" onClick={save} disabled={saving || !name.trim()}>שמור</button>
            <button type="button" className="kf-btn kf-btn-ghost text-xs" onClick={() => setShowSave(false)}>ביטול</button>
          </div>
        ) : (
          <button type="button" className="kf-btn text-xs" onClick={() => setShowSave(true)}>
            💾 שמור סינון נוכחי
          </button>
        )
      ) : null}
    </div>
  );
}

// ── Bulk action bar (P3.2) ────────────────────────────────────────────────
// Sticky at the top of the table when any leads are selected. Keeps the
// destructive actions visible without scrolling and clearly bound to the
// count of selected rows.
function BulkActionBar({
  count, pending,
  onClear, onMarkDormant, onAssignMia, onAssignAi, onExportCsv,
}: {
  count: number;
  pending: boolean;
  onClear: () => void;
  onMarkDormant: () => void;
  onAssignMia: () => void;
  onAssignAi: () => void;
  onExportCsv: () => void;
}) {
  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 shadow-sm">
      <strong className="text-sm text-brand-800">{count} נבחרו</strong>
      <div className="mx-2 h-4 w-px bg-brand-200" aria-hidden="true" />
      <button type="button" className="kf-btn text-xs" onClick={onAssignMia} disabled={pending}>
        העברה למיה
      </button>
      <button type="button" className="kf-btn text-xs" onClick={onAssignAi} disabled={pending}>
        החזרה ל-AI
      </button>
      <button
        type="button"
        className="kf-btn text-xs"
        onClick={() => { if (window.confirm(`לסמן ${count} לידים כ-dormant?`)) onMarkDormant(); }}
        disabled={pending}
      >
        סמן dormant
      </button>
      <button type="button" className="kf-btn text-xs" onClick={onExportCsv} disabled={pending}>
        ייצוא CSV
      </button>
      <button type="button" className="kf-btn kf-btn-ghost text-xs ms-auto" onClick={onClear} disabled={pending}>
        ביטול בחירה
      </button>
    </div>
  );
}

// ── Sortable column header (P3.3) ────────────────────────────────────────
// Visually subtle — header stays clickable, arrow appears only when this
// column is the active sort. Keeps the table familiar but lets Mia answer
// "show me the highest scores" or "show me the oldest" without SQL.
function SortableTh({
  label, col, sortBy, sortDir, onClick,
}: {
  label: string;
  col: LeadsListSortColumn;
  sortBy: LeadsListSortColumn;
  sortDir: SortDir;
  onClick: (col: LeadsListSortColumn) => void;
}) {
  const active = sortBy === col;
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
  return (
    <th>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-current hover:text-brand-700"
        onClick={() => onClick(col)}
        aria-label={`מיון לפי ${label}`}
      >
        <span>{label}</span>
        <span className={active ? 'text-brand-600' : 'text-slate-300'} aria-hidden="true">
          {arrow || '⇅'}
        </span>
      </button>
    </th>
  );
}
