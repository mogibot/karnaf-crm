import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  fetchPromptVariants, postCreatePromptVariant, postUpdatePromptVariant,
  postDeletePromptVariant, fetchPromptVariantRatingStats,
  fetchPromptVariantChangeRequests, postRequestPromptVariantChange,
  postReviewPromptVariantChangeRequest,
  type PlaybookName, type PromptVariantRow, type PromptVariantRatingStat,
  type PromptVariantChangeRequest, type PromptVariantRequestKind,
} from '@/lib/api';
import { useAuth } from '@/auth/auth-context';
import { useToast } from '@/components/Toast';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { formatDateTime } from '@/lib/format';

const PLAYBOOKS: PlaybookName[] = [
  'first_contact_whatsapp_inbound', 'first_contact_form_lead', 'qualification',
  'price_objection', 'free_advice_boundary', 'checkout_push',
  'payment_pending_rescue', 'phone_request', 'opt_out',
];

export function PromptVariantsPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle('תבניות AI');
  const list = useQuery({ queryKey: ['prompt-variants'], queryFn: fetchPromptVariants });
  const ratingsQ = useQuery({
    queryKey: ['prompt-variant-rating-stats'],
    queryFn: fetchPromptVariantRatingStats,
    refetchInterval: 60_000,
  });

  const ratingsByKey = new Map<string, PromptVariantRatingStat>();
  for (const s of ratingsQ.data ?? []) {
    ratingsByKey.set(`${s.playbook_name}::${s.prompt_version}`, s);
  }

  const create = useMutation({
    mutationFn: postCreatePromptVariant,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompt-variants'] }); toast.success('גרסה נוצרה'); },
    onError: (err) => toast.error((err as Error).message),
  });
  const update = useMutation({
    mutationFn: postUpdatePromptVariant,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompt-variants'] }); toast.success('גרסה עודכנה'); },
    onError: (err) => toast.error((err as Error).message),
  });
  const remove = useMutation({
    mutationFn: postDeletePromptVariant,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompt-variants'] }); toast.success('גרסה נמחקה'); },
    onError: (err) => toast.error((err as Error).message),
  });

  const isAdmin = auth.role === 'owner' || auth.role === 'admin';
  const isManager = isAdmin || auth.role === 'mia';

  // Sales reps + viewers still bounce — they have no business with prompts.
  if (!isManager) {
    return <Navigate to="/" replace />;
  }

  const variantsByPlaybook = (list.data ?? []).reduce<Record<string, PromptVariantRow[]>>((acc, v) => {
    const bucket = acc[v.playbook_name] ?? [];
    bucket.push(v);
    acc[v.playbook_name] = bucket;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">תבניות AI</h1>
        <p className="text-sm text-slate-500">
          {isAdmin
            ? 'ניהול גרסאות prompt לכל playbook. משקלים נורמלים אוטומטית. גרסה לא פעילה לא תיבחר.'
            : 'מצב צפייה — ניתן לראות סטטיסטיקות, להגיש בקשת שינוי לאדמין.'}
        </p>
      </header>

      {isAdmin ? (
        <>
          <CreateVariantForm
            onSubmit={(payload) => create.mutate(payload)}
            submitting={create.isPending}
          />
          <PendingRequestsPanel />
        </>
      ) : (
        <ManagerRequestPanel variants={list.data ?? []} />
      )}

      {list.isLoading ? (
        <p className="text-slate-500">טוען...</p>
      ) : null}

      {PLAYBOOKS.map((playbook) => (
        <PlaybookSection
          key={playbook}
          playbook={playbook}
          variants={variantsByPlaybook[playbook] ?? []}
          ratingsByKey={ratingsByKey}
          readOnly={!isAdmin}
          onUpdate={(payload) => update.mutate(payload)}
          onDelete={(id) => remove.mutate(id)}
          updating={update.isPending}
          deleting={remove.isPending}
        />
      ))}
    </div>
  );
}

// ── Manager (mia) request flow ──────────────────────────────────────────
const REQUEST_KIND_LABELS: Record<PromptVariantRequestKind, string> = {
  tweak_objective: 'תיקון מטרה (objective)',
  tweak_guidance: 'תיקון הנחיות (guidance)',
  change_weight: 'שינוי משקל',
  activate: 'הפעלת גרסה',
  deactivate: 'השבתת גרסה',
  create_new: 'יצירת גרסה חדשה',
  remove: 'מחיקת גרסה',
};

function ManagerRequestPanel({ variants }: { variants: PromptVariantRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [playbook, setPlaybook] = useState<PlaybookName>('qualification');
  const [variantId, setVariantId] = useState<string>('');
  const [kind, setKind] = useState<PromptVariantRequestKind>('tweak_guidance');
  const [rationale, setRationale] = useState('');
  const [proposalText, setProposalText] = useState('');

  const myRequests = useQuery({
    queryKey: ['pvcr', 'pending'],
    queryFn: () => fetchPromptVariantChangeRequests('pending'),
  });

  const submit = useMutation({
    mutationFn: postRequestPromptVariantChange,
    onSuccess: () => {
      toast.success('בקשת השינוי נשלחה לאדמין');
      setRationale('');
      setProposalText('');
      qc.invalidateQueries({ queryKey: ['pvcr', 'pending'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const variantsForPlaybook = variants.filter((v) => v.playbook_name === playbook);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rationale.trim()) return;
    const proposed_change: Record<string, unknown> = {};
    if (proposalText.trim()) proposed_change.proposal_text = proposalText.trim();
    submit.mutate({
      variant_id: variantId || null,
      playbook_name: playbook,
      request_kind: kind,
      rationale: rationale.trim(),
      proposed_change,
    });
  }

  return (
    <details className="kf-card p-4">
      <summary className="cursor-pointer font-medium">📨 הגשת בקשת שינוי לאדמין</summary>
      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-700">Playbook</span>
          <select className="kf-input mt-1" value={playbook} onChange={(e) => { setPlaybook(e.target.value as PlaybookName); setVariantId(''); }}>
            {PLAYBOOKS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">גרסה ספציפית (אופציונלי)</span>
          <select className="kf-input mt-1" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">— כל הגרסאות / גרסה חדשה —</option>
            {variantsForPlaybook.map((v) => (
              <option key={v.id} value={v.id}>{v.version}{v.is_active ? ' (פעילה)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">סוג שינוי</span>
          <select className="kf-input mt-1" value={kind} onChange={(e) => setKind(e.target.value as PromptVariantRequestKind)}>
            {(Object.keys(REQUEST_KIND_LABELS) as PromptVariantRequestKind[]).map((k) => (
              <option key={k} value={k}>{REQUEST_KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="text-slate-700">למה? (חובה — תיאור הבעיה / דוגמאות מתשובות AI שגויות)</span>
          <textarea
            className="kf-input mt-1 min-h-[100px]"
            required
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="לדוגמה: ה-AI לא מבין שהליד שאל פעמיים על מחיר; כדאי להוסיף הנחיה."
          />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="text-slate-700">הצעת ניסוח (אופציונלי)</span>
          <textarea
            className="kf-input mt-1 min-h-[80px]"
            value={proposalText}
            onChange={(e) => setProposalText(e.target.value)}
            placeholder="טקסט מוצע ל-objective / guidance / וכו'"
          />
        </label>
        <div className="md:col-span-2 flex justify-end">
          <button type="submit" className="kf-btn kf-btn-primary" disabled={submit.isPending || !rationale.trim()}>
            {submit.isPending ? 'שולח...' : 'שלח לאדמין'}
          </button>
        </div>
      </form>

      {(myRequests.data ?? []).length > 0 ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-medium text-slate-700">בקשות פתוחות ({myRequests.data!.length})</h3>
          <ul className="mt-2 space-y-2">
            {myRequests.data!.map((r) => (
              <li key={r.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-white px-1.5 py-0.5">{r.playbook_name}</code>
                  <span className="kf-badge kf-badge-mute">{REQUEST_KIND_LABELS[r.request_kind]}</span>
                  <span className="text-slate-500">הוגש {formatDateTime(r.requested_at)}</span>
                </div>
                <p className="mt-1 text-slate-700">{r.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}

// ── Admin: pending change-requests review panel ─────────────────────────
function PendingRequestsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useQuery({
    queryKey: ['pvcr', 'pending'],
    queryFn: () => fetchPromptVariantChangeRequests('pending'),
    refetchInterval: 30_000,
  });
  const review = useMutation({
    mutationFn: postReviewPromptVariantChangeRequest,
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === 'accept' ? 'בקשה אושרה' : 'בקשה נדחתה');
      qc.invalidateQueries({ queryKey: ['pvcr', 'pending'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const [noteByReq, setNoteByReq] = useState<Record<string, string>>({});

  if (!pending.data || pending.data.length === 0) return null;

  return (
    <section className="kf-card p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">בקשות שינוי ממתינות ({pending.data.length})</h2>
        <span className="text-xs text-slate-500">רענון כל 30 שנ'</span>
      </header>
      <ul className="mt-3 space-y-2">
        {pending.data.map((r: PromptVariantChangeRequest) => (
          <li key={r.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-white px-1.5 py-0.5">{r.playbook_name}</code>
              <span className="kf-badge kf-badge-mute">{REQUEST_KIND_LABELS[r.request_kind]}</span>
              <span className="text-xs text-slate-500" title={r.requested_at}>{formatDateTime(r.requested_at)}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-slate-700">{r.rationale}</p>
            {r.proposed_change && typeof r.proposed_change === 'object' && 'proposal_text' in r.proposed_change ? (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">
                {String((r.proposed_change as { proposal_text?: string }).proposal_text)}
              </pre>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="kf-input flex-1 min-w-0"
                placeholder="הערת אדמין (אופציונלי)"
                value={noteByReq[r.id] ?? ''}
                onChange={(e) => setNoteByReq((m) => ({ ...m, [r.id]: e.target.value }))}
              />
              <button
                className="kf-btn kf-btn-primary text-xs"
                disabled={review.isPending}
                onClick={() => review.mutate({ request_id: r.id, decision: 'accept', reviewer_note: noteByReq[r.id] || null })}
              >
                אשר
              </button>
              <button
                className="kf-btn kf-btn-danger text-xs"
                disabled={review.isPending}
                onClick={() => review.mutate({ request_id: r.id, decision: 'decline', reviewer_note: noteByReq[r.id] || null })}
              >
                דחה
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlaybookSection({
  playbook, variants, ratingsByKey, readOnly = false, onUpdate, onDelete, updating, deleting,
}: {
  playbook: PlaybookName;
  variants: PromptVariantRow[];
  ratingsByKey: Map<string, PromptVariantRatingStat>;
  readOnly?: boolean;
  onUpdate: (input: { id: string; weight?: number; is_active?: boolean; prompt_overrides?: PromptVariantRow['prompt_overrides']; notes?: string | null }) => void;
  onDelete: (id: string) => void;
  updating: boolean;
  deleting: boolean;
}) {
  const totalWeight = variants.filter((v) => v.is_active).reduce((acc, v) => acc + Math.max(0, v.weight), 0);
  return (
    <section className="kf-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{playbook}</h2>
        <span className="text-xs text-slate-500">
          {variants.length} גרסאות · משקל פעיל {totalWeight}
        </span>
      </div>
      {variants.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">אין גרסאות. ה-AI ירוץ עם הגרסה הקבועה ב-config.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {variants.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              activeShare={totalWeight > 0 && v.is_active ? Math.round((Math.max(0, v.weight) / totalWeight) * 100) : 0}
              ratingStat={ratingsByKey.get(`${v.playbook_name}::${v.version}`) ?? null}
              readOnly={readOnly}
              onUpdate={onUpdate}
              onDelete={onDelete}
              updating={updating}
              deleting={deleting}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function VariantRow({
  variant, activeShare, ratingStat, readOnly = false, onUpdate, onDelete, updating, deleting,
}: {
  variant: PromptVariantRow;
  activeShare: number;
  ratingStat: PromptVariantRatingStat | null;
  readOnly?: boolean;
  onUpdate: (input: { id: string; weight?: number; is_active?: boolean; prompt_overrides?: PromptVariantRow['prompt_overrides']; notes?: string | null }) => void;
  onDelete: (id: string) => void;
  updating: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [objective, setObjective] = useState(variant.prompt_overrides.objective ?? '');
  const [guidanceText, setGuidanceText] = useState((variant.prompt_overrides.guidance ?? []).join('\n'));
  const [notes, setNotes] = useState(variant.notes ?? '');

  function saveOverrides() {
    const guidance = guidanceText.split('\n').map((l) => l.trim()).filter(Boolean);
    onUpdate({
      id: variant.id,
      prompt_overrides: {
        ...variant.prompt_overrides,
        objective: objective.trim() || undefined,
        guidance: guidance.length > 0 ? guidance : undefined,
      },
      notes: notes.trim() || null,
    });
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm font-medium">{variant.version}</code>
            {variant.is_active
              ? <span className="kf-badge kf-badge-success">פעילה</span>
              : <span className="kf-badge kf-badge-mute">מושבתת</span>}
            {activeShare > 0 ? (
              <span className="text-xs text-slate-500">חלוקה: {activeShare}%</span>
            ) : null}
            {ratingStat && ratingStat.ratings_total > 0 ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-slate-600"
                title={`👍 ${ratingStat.thumbs_up} · 👎 ${ratingStat.thumbs_down} · ממוצע ${Number(ratingStat.mean_rating).toFixed(2)}`}
              >
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700">👍 {ratingStat.thumbs_up}</span>
                <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-rose-700">👎 {ratingStat.thumbs_down}</span>
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate-500" title={variant.created_at}>
            עודכן {formatDateTime(variant.updated_at)}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">משקל</span>
          <input
            type="number" min={0} max={100}
            className="kf-input w-20"
            defaultValue={variant.weight}
            disabled={updating || readOnly}
            readOnly={readOnly}
            onBlur={(e) => {
              if (readOnly) return;
              const next = Number(e.currentTarget.value);
              if (Number.isFinite(next) && next !== variant.weight) {
                onUpdate({ id: variant.id, weight: next });
              }
            }}
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={variant.is_active}
            disabled={updating || readOnly}
            onChange={(e) => { if (!readOnly) onUpdate({ id: variant.id, is_active: e.target.checked }); }}
          />
          <span className="text-slate-700">פעילה</span>
        </label>
        <div className="flex items-center gap-2 justify-self-end">
          <button type="button" className="kf-btn text-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'סגור' : (readOnly ? 'צפה בתבנית' : 'ערוך תבנית')}
          </button>
          {readOnly ? null : (
            <button
              type="button"
              className="kf-btn kf-btn-danger text-xs"
              disabled={deleting}
              onClick={() => {
                if (window.confirm(`למחוק את הגרסה ${variant.version}?`)) onDelete(variant.id);
              }}
            >
              מחיקה
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3">
          <label className="block text-sm">
            <span className="text-slate-700">מטרה (objective override)</span>
            <textarea
              className="kf-input mt-1 min-h-[60px]"
              placeholder="ברירת מחדל: ה-objective של ה-playbook"
              value={objective}
              readOnly={readOnly}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">הנחיות (שורה לכל בולט)</span>
            <textarea
              className="kf-input mt-1 min-h-[100px] font-mono text-xs"
              placeholder="ברירת מחדל: ה-guidance של ה-playbook"
              value={guidanceText}
              readOnly={readOnly}
              onChange={(e) => setGuidanceText(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">הערות (פנימיות)</span>
            <input
              className="kf-input mt-1"
              value={notes}
              readOnly={readOnly}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {readOnly ? (
            <p className="text-xs text-slate-500">מצב צפייה — כדי לבקש שינוי, השתמש ב"הגשת בקשת שינוי" למעלה.</p>
          ) : (
            <div className="flex justify-end">
              <button type="button" className="kf-btn kf-btn-primary" onClick={saveOverrides} disabled={updating}>
                שמור שינויים
              </button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function CreateVariantForm({
  onSubmit, submitting,
}: {
  onSubmit: (payload: { playbook_name: PlaybookName; version: string; weight: number; is_active: boolean; notes?: string | null }) => void;
  submitting: boolean;
}) {
  const [playbook, setPlaybook] = useState<PlaybookName>('qualification');
  const [version, setVersion] = useState('');
  const [weight, setWeight] = useState('50');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!version.trim()) return;
    onSubmit({
      playbook_name: playbook,
      version: version.trim(),
      weight: Number(weight) || 0,
      is_active: isActive,
      notes: notes.trim() || null,
    });
    setVersion(''); setWeight('50'); setNotes(''); setIsActive(true);
  }

  return (
    <form onSubmit={submit} className="kf-card grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 md:grid-cols-6">
      <label className="block text-sm md:col-span-2">
        <span className="text-slate-700">Playbook</span>
        <select className="kf-input mt-1" value={playbook} onChange={(e) => setPlaybook(e.target.value as PlaybookName)}>
          {PLAYBOOKS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Version</span>
        <input className="kf-input mt-1" required value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v2-friendlier" />
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">משקל</span>
        <input className="kf-input mt-1" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
      </label>
      <label className="block text-sm md:col-span-1">
        <span className="text-slate-700">הערות</span>
        <input className="kf-input mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-3 sm:col-span-2 md:col-span-6">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-slate-700">פעילה מיד</span>
        </label>
        <button type="submit" className="kf-btn kf-btn-primary" disabled={submitting}>
          {submitting ? 'מוסיף...' : 'הוספת גרסה'}
        </button>
      </div>
    </form>
  );
}
