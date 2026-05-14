import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth as useAuthForTune } from '@/auth/auth-context';
import {
  fetchLeadDetail, postAdminAction, postSendReply, postQueueResolve,
  postUpdateLead, postSoftDeleteLead,
  postClaimConversation, postReleaseConversation,
  postRestoreLead,
  fetchEmailDraftsForLead, createEmailDraft, archiveEmailDraft,
  fetchAiReviewsForLead, postAiReview,
  fetchAiDecisionsForLead,
  type AdminAction, type CallOutcome, type UpdateLeadPayload,
  type OutboundEmailDraft, type AiDecisionReview, type AiDecisionMetadata,
} from '@/lib/api';
import { HeatBadge, OwnershipBadge, StatusBadge } from '@/components/Badge';
import { QUEUE_LABELS, formatDateTime, formatRelative } from '@/lib/format';
import type { LeadDetail, MessageRow } from '@/lib/types';
import { useAuth } from '@/auth/auth-context';
import { useToast } from '@/components/Toast';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useLeadPresence, type PresenceUser } from '@/lib/useLeadPresence';

const MANUAL_SOURCES = [
  'manual_entry', 'whatsapp_direct', 'instagram_dm', 'facebook_lead_ad',
  'landing_page', 'webinar', 'responder_form', 'lead_magnet', 'screenshot_manual', 'unknown',
];

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const qc = useQueryClient();
  const auth = useAuth();
  const toast = useToast();
  const detailQ = useQuery({
    queryKey: ['lead-detail', leadId],
    queryFn: () => fetchLeadDetail(leadId),
    enabled: !!leadId,
    // Poll every 5s so the operator sees inbound WhatsApp messages live.
    // Pauses automatically when the tab is in the background.
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  useDocumentTitle(detailQ.data?.lead.full_name || 'ליד');

  // Multi-operator presence: shows avatar pills for OTHER operators
  // currently viewing this lead. Subscribes via Supabase Realtime presence
  // channel; falls back gracefully to empty list if RT is down.
  const presenceMe = useMemo(() => {
    if (!auth.user) return null;
    return {
      userId: auth.user.id,
      email: auth.user.email ?? null,
      fullName: (auth.user.user_metadata as { full_name?: string } | undefined)?.full_name ?? null,
      role: auth.role,
    };
  }, [auth.user, auth.role]);
  const otherViewers = useLeadPresence(leadId, presenceMe);

  // Actions whose `mark_*` / ownership flips are reversible within
  // UNDO_WINDOW_SECONDS (server-enforced, see admin-actions). Showing an
  // Undo toast button for these keeps a fat-fingered "Mark Won" from
  // requiring an admin DB poke to reverse.
  const UNDOABLE_ACTIONS: ReadonlySet<AdminAction> = new Set([
    'mark_won', 'mark_lost', 'mark_dnc', 'mark_phone_escalation',
    'assign_to_mia', 'return_to_ai',
  ]);

  const undoAction = useMutation({
    mutationFn: () => postAdminAction({ action: 'undo_recent_action', leadId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('הפעולה בוטלה');
    },
    onError: (err) => toast.error(`לא ניתן לבטל: ${(err as Error).message}`),
  });

  // Optimistic patch shape — keep narrow to columns each action touches.
  type LeadDetailCache = Awaited<ReturnType<typeof fetchLeadDetail>>;
  function optimisticPatchFor(kind: AdminAction): Partial<LeadDetailCache['lead']> | null {
    switch (kind) {
      case 'mark_won':   return { lead_status: 'won' };
      case 'mark_lost':  return { lead_status: 'lost' };
      case 'mark_dnc':   return { lead_status: 'do_not_contact', do_not_contact: true };
      case 'assign_to_mia': return { ownership_mode: 'mia_active', lead_status: 'human_handoff' };
      case 'return_to_ai':  return { ownership_mode: 'ai_active' };
      case 'mark_phone_escalation': return { ownership_mode: 'phone_sales_pending', requested_phone_call: true };
      default: return null;
    }
  }

  const action = useMutation({
    mutationFn: (input: { action: AdminAction; note?: string; label: string }) =>
      postAdminAction({ action: input.action, leadId, note: input.note ?? null }).then((r) => ({ r, label: input.label, kind: input.action })),
    // Write-through cache so the badge updates instantly instead of after
    // the round-trip. Rolls back on error using the snapshot returned here.
    onMutate: async (input) => {
      const patch = optimisticPatchFor(input.action);
      if (!patch) return { previous: null };
      await qc.cancelQueries({ queryKey: ['lead-detail', leadId] });
      const previous = qc.getQueryData<LeadDetailCache>(['lead-detail', leadId]);
      if (previous) {
        qc.setQueryData<LeadDetailCache>(['lead-detail', leadId], {
          ...previous,
          lead: { ...previous.lead, ...patch },
        });
      }
      return { previous };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      if (UNDOABLE_ACTIONS.has(data.kind)) {
        toast.push({
          message: `${data.label} – בוצע`,
          tone: 'success',
          action: { label: 'בטל', onClick: () => undoAction.mutate() },
        });
      } else {
        toast.success(`${data.label} – בוצע`);
      }
    },
    onError: (err, _vars, ctx) => {
      // Rollback the optimistic patch so the badge bounces back.
      if (ctx?.previous) qc.setQueryData(['lead-detail', leadId], ctx.previous);
      toast.error((err as Error).message);
    },
    onSettled: () => {
      // Always re-fetch authoritative state after the dust settles.
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
  });

  const logCall = useMutation({
    mutationFn: (input: { outcome: CallOutcome; durationMinutes: number; note: string | null }) =>
      postAdminAction({
        action: 'log_phone_call',
        leadId,
        callOutcome: input.outcome,
        callDurationMinutes: input.durationMinutes,
        note: input.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      toast.success('שיחת טלפון נרשמה');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const conversationId = detailQ.data?.conversations[0]?.id;

  const sendReply = useMutation({
    mutationFn: (text: string) => {
      if (!conversationId) throw new Error('No conversation');
      return postSendReply({ leadId, conversationId, text });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      toast.success('הודעה נשלחה');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const resolveQueue = useMutation({
    mutationFn: (input: { queueItemId: string; note?: string }) =>
      postQueueResolve({ queueItemId: input.queueItemId, resolutionNote: input.note ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      toast.success('פריט תור נסגר');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const [editing, setEditing] = useState(false);
  const updateLead = useMutation({
    mutationFn: (payload: UpdateLeadPayload) => postUpdateLead(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('פרטי הליד עודכנו');
      setEditing(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const softDelete = useMutation({
    mutationFn: () => postSoftDeleteLead(leadId, 'soft_delete_from_ui'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('הליד הוסר (DNC הופעל)');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const restore = useMutation({
    mutationFn: () => postRestoreLead(leadId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('הליד שוחזר');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  // Optimistic UI flag for claim status. Server is source of truth (the
  // orchestrator reads conversation_claims directly), so a refresh resets
  // it — that's fine. Setting in onMutate (not onSuccess) means the button
  // flips instantly on click, even on 4G.
  const [claimedByMe, setClaimedByMe] = useState(false);
  const claim = useMutation({
    mutationFn: (ttl: number) => {
      if (!conversationId) throw new Error('No conversation');
      return postClaimConversation(conversationId, ttl);
    },
    onMutate: () => {
      const previous = claimedByMe;
      setClaimedByMe(true);
      return { previous };
    },
    onSuccess: (res) => {
      const expiresMin = Math.round((Date.parse(res.claim.expires_at) - Date.now()) / 60000);
      toast.success(`השיחה תפוסה על-ידך — AI מושעה לעוד ${expiresMin} דק'`);
    },
    onError: (err, _vars, ctx) => {
      // Roll the optimistic flip back to the snapshot.
      if (ctx) setClaimedByMe(ctx.previous);
      const e = err as Error;
      if (e.message.includes('already claimed')) {
        toast.error('השיחה כבר תפוסה ע"י מפעיל אחר');
      } else {
        toast.error(e.message);
      }
    },
  });
  const release = useMutation({
    mutationFn: () => {
      if (!conversationId) throw new Error('No conversation');
      return postReleaseConversation(conversationId, 'released_from_ui');
    },
    onMutate: () => {
      const previous = claimedByMe;
      setClaimedByMe(false);
      return { previous };
    },
    onSuccess: () => {
      toast.success('השיחה שוחררה — AI פעיל שוב');
    },
    onError: (err, _vars, ctx) => {
      if (ctx) setClaimedByMe(ctx.previous);
      toast.error((err as Error).message);
    },
  });

  if (detailQ.isLoading) return <p className="text-slate-500">טוען...</p>;
  if (detailQ.error) return <p className="text-rose-600">שגיאה: {(detailQ.error as Error).message}</p>;
  if (!detailQ.data) return null;

  const { lead, messages, queueItems, tasks, events } = detailQ.data;
  const canEditData = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia' || auth.role === 'sales_rep';

  return (
    <div className="space-y-4">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">← חזרה לרשימה</Link>

      <header className="kf-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{lead.full_name || 'ליד ללא שם'}</h1>
          <StatusBadge status={lead.lead_status} />
          <HeatBadge heat={lead.lead_heat} />
          <OwnershipBadge ownership={lead.ownership_mode} />
          <span className="kf-badge kf-badge-mute">ציון {lead.lead_score}</span>
          {lead.do_not_contact ? <span className="kf-badge bg-rose-100 text-rose-700">DNC</span> : null}
          {lead.removed_by_request ? <span className="kf-badge bg-rose-100 text-rose-700">הוסר לבקשתו</span> : null}
          {otherViewers.length > 0 ? <PresenceStack viewers={otherViewers} /> : null}
          {canEditData && !editing ? (
            <button
              type="button"
              className="kf-btn kf-btn-ghost ms-auto text-xs"
              onClick={() => setEditing(true)}
            >
              ערוך פרטים
            </button>
          ) : null}
          <button
            type="button"
            className="kf-btn kf-btn-ghost text-xs"
            title="הורדת השיחה כ-JSON — שימושי לדיבוג / שליחה לסקירה"
            onClick={() => exportLeadAsJson(detailQ.data)}
          >
            ייצוא JSON
          </button>
        </div>

        {editing ? (
          <LeadEditForm
            lead={lead}
            pending={updateLead.isPending}
            error={updateLead.error instanceof Error ? updateLead.error.message : null}
            onSubmit={(payload) => updateLead.mutate(payload)}
            onCancel={() => { setEditing(false); updateLead.reset(); }}
          />
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
            <ContactRow label="טלפון" value={lead.phone} kind="phone" />
            <ContactRow label="אימייל" value={lead.email} kind="email" />
            <DataRow label="מקור" value={lead.source} />
            <DataRow label="נוצר" value={formatDateTime(lead.created_at)} />
            <DataRow label="נכנס לאחרונה" value={formatRelative(lead.last_inbound_at)} />
            <DataRow label="יצא לאחרונה" value={formatRelative(lead.last_outbound_at)} />
          </dl>
        )}

        {/* Lifecycle/ownership transitions are restricted server-side to
            owner / admin / mia; hide them for sales_rep so the UI matches. */}
        {auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia' ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionGroup label="בעלות">
              <button type="button" className="kf-btn" onClick={() => action.mutate({ action: 'assign_to_mia', label: 'הועבר למיה' })}>
                העברה למיה
              </button>
              <button type="button" className="kf-btn" onClick={() => action.mutate({ action: 'return_to_ai', label: 'הוחזר ל-AI' })}>
                החזרה ל-AI
              </button>
              <button type="button" className="kf-btn" onClick={() => action.mutate({ action: 'mark_phone_escalation', label: 'סומן לשיחה' })}>
                סימון לשיחה
              </button>
            </ActionGroup>
            <ActionGroup label="סטטוס">
              <button type="button" className="kf-btn kf-btn-primary" onClick={() => action.mutate({ action: 'mark_won', label: 'נסגר ברכישה' })}>
                סימון כסגירה
              </button>
              <button type="button" className="kf-btn" onClick={() => action.mutate({ action: 'mark_lost', note: 'manual_close', label: 'סומן כאבוד' })}>
                סימון כאבוד
              </button>
            </ActionGroup>
            <ActionGroup label="הסרה">
              <button type="button" className="kf-btn kf-btn-danger" onClick={() => action.mutate({ action: 'mark_dnc', label: 'סומן כ-DNC' })}>
                DNC
              </button>
              {auth.role === 'owner' || auth.role === 'admin' ? (
                lead.removed_by_request ? (
                  <button
                    type="button"
                    className="kf-btn"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm('לשחזר את הליד? removed_by_request + DNC יבוטלו. AI יחזור לטפל בליד.')) {
                        restore.mutate();
                      }
                    }}
                  >
                    {restore.isPending ? 'משחזר…' : 'שחזור'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="kf-btn kf-btn-danger"
                    disabled={softDelete.isPending}
                    onClick={() => {
                      if (window.confirm('להסיר את הליד? הוא יסומן removed_by_request + DNC. הנתונים נשמרים אבל לא יישלחו אליו עוד הודעות.')) {
                        softDelete.mutate();
                      }
                    }}
                  >
                    הסרה (soft)
                  </button>
                )
              ) : null}
            </ActionGroup>
          </div>
        ) : null}
        {action.error ? <p className="mt-2 text-sm text-rose-600">{(action.error as Error).message}</p> : null}
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="kf-card p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">שיחה</h2>
            <div className="flex flex-wrap items-center gap-2">
              {conversationId ? (
                claimedByMe ? (
                  <button
                    type="button"
                    className="kf-btn kf-btn-ghost text-xs"
                    onClick={() => release.mutate()}
                    disabled={release.isPending}
                    title="שחרור — AI יחזור לענות אוטומטית על הודעות חדשות"
                  >
                    {release.isPending ? 'משחרר…' : 'שחרר את השיחה (AI חוזר)'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="kf-btn kf-btn-primary text-xs"
                    onClick={() => claim.mutate(30)}
                    disabled={claim.isPending}
                    title="השעיית AI לזמן קצר כדי שתוכל לענות ידנית בלי הפרעות"
                  >
                    {claim.isPending ? 'תופס…' : 'תפוס שיחה (השעה AI ל-30 דק׳)'}
                  </button>
                )
              ) : null}
              {lead.phone ? (
                <a
                  href={waLink(lead.phone)} target="_blank" rel="noopener noreferrer"
                  className="kf-btn kf-btn-ghost text-xs"
                  title="פתיחת שיחה ב-WhatsApp"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d="M10 2.5a7.5 7.5 0 0 0-6.4 11.4L2.5 17.5l3.7-1.1A7.5 7.5 0 1 0 10 2.5Zm4.4 10.6c-.2.6-1 1.1-1.6 1.2-.4.1-.9.1-3-.7-2.5-1-4.1-3.5-4.2-3.7-.1-.2-1-1.3-1-2.5 0-1.2.6-1.7.9-2 .2-.2.4-.2.6-.2h.4c.1 0 .3 0 .5.4.2.5.7 1.6.7 1.7s.1.2 0 .3c-.1.2-.1.3-.3.4-.1.1-.2.3-.4.4-.1.1-.3.3-.1.5.2.4.7 1.1 1.5 1.8 1 .9 1.8 1.2 2.1 1.3.3.1.5.1.6 0 .2-.2.7-.8.9-1 .2-.3.4-.2.6-.1.3.1 1.7.8 2 .9.3.1.4.2.5.4.1.2.1.7-.1 1.3Z" />
                  </svg>
                  WhatsApp
                </a>
              ) : null}
            </div>
          </div>
          <Transcript messages={messages} leadId={leadId} />
          <ReplyBox
            disabled={!conversationId || lead.do_not_contact || lead.removed_by_request}
            onSend={(text) => sendReply.mutate(text)}
            sending={sendReply.isPending}
            errorMessage={sendReply.error ? (sendReply.error as Error).message : null}
          />
        </div>

        <aside className="space-y-4">
          <div className="kf-card p-4">
            <h2 className="font-semibold">הקשר ליד</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <Row k="מטרה" v={lead.goal_summary} />
              <Row k="כאב מרכזי" v={lead.pain_point_summary} />
              <Row k="חסם עיקרי" v={lead.main_blocker} />
              <Row k="סטטוס תשלום" v={lead.payment_status} />
            </dl>
            {canEditData ? (
              <NextActionInline
                leadId={leadId}
                currentType={lead.next_action_type ?? null}
                currentDueAt={lead.next_action_due_at ?? null}
                onSaved={() => qc.invalidateQueries({ queryKey: ['lead-detail', leadId] })}
              />
            ) : (
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="פעולה הבאה" v={lead.next_action_type} />
                <Row k="עד" v={lead.next_action_due_at ? formatDateTime(lead.next_action_due_at) : null} />
              </dl>
            )}
          </div>

          <div className="kf-card p-4">
            <h2 className="font-semibold">תורי עבודה</h2>
            {queueItems.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">אין פריטים פתוחים.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {queueItems.map((q) => (
                  <li key={q.id} className="rounded-md bg-slate-50 p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{QUEUE_LABELS[q.queue_type] ?? q.queue_type}</strong>
                      <span className="text-xs text-slate-500">{q.status}</span>
                    </div>
                    <div className="text-slate-600">{q.reason || '—'}</div>
                    {(q.status === 'pending' || q.status === 'claimed') ? (
                      <button
                        type="button"
                        className="kf-btn mt-2 text-xs"
                        onClick={() => resolveQueue.mutate({ queueItemId: q.id, note: 'resolved_by_user' })}
                      >
                        סגירה
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(auth.role === 'sales_rep' || auth.role === 'mia' || auth.role === 'admin' || auth.role === 'owner') ? (
            <div className="kf-card p-4">
              <h2 className="font-semibold">תיעוד שיחת טלפון</h2>
              <CallLogForm
                onSubmit={(outcome, durationMinutes, note) => logCall.mutate({ outcome, durationMinutes, note })}
                submitting={logCall.isPending}
                errorMessage={logCall.error ? (logCall.error as Error).message : null}
              />
            </div>
          ) : null}

          <div className="kf-card p-4">
            <h2 className="font-semibold">משימות</h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">אין משימות.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {tasks.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span>{t.title}</span>
                    <span className="text-xs text-slate-500">{t.task_status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <EmailDraftsPanel leadId={leadId} leadEmail={lead.email} />

          <div className="kf-card p-4">
            <h2 className="font-semibold">היסטוריית אירועים</h2>
            <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs text-slate-600">
              {events.slice(0, 30).map((e) => (
                <li key={e.id}>
                  <span className="text-slate-400">{formatRelative(e.created_at)}</span>
                  {' '}<strong>{e.event_type}</strong>{' '}<span className="text-slate-500">{e.actor_type}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}

function exportLeadAsJson(detail: { lead: LeadDetail; messages: MessageRow[]; [k: string]: unknown } | null | undefined) {
  if (!detail) return;
  const payload = { exported_at: new Date().toISOString(), ...detail };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = (detail.lead.full_name || detail.lead.id).replace(/\s+/g, '_');
  a.download = `karnaf-lead-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-1.5">
      <span className="w-full px-2 text-xs text-slate-500 sm:w-auto">{label}</span>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="col-span-1 text-slate-500">{k}</dt>
      <dd className="col-span-2 text-slate-800">{v || '—'}</dd>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-slate-500">{label}:</span>
      <strong className="text-slate-800">{value || '—'}</strong>
    </div>
  );
}

function ContactRow({ label, value, kind }: { label: string; value: string | null | undefined; kind: 'phone' | 'email' }) {
  const toast = useToast();
  if (!value) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-slate-500">{label}:</span>
        <strong className="text-slate-800">—</strong>
      </div>
    );
  }
  const href = kind === 'phone' ? `tel:${value}` : `mailto:${value}`;
  function copy() {
    navigator.clipboard?.writeText(value!).then(
      () => toast.success(`${label} הועתק`),
      () => toast.error('העתקה נכשלה'),
    );
  }
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-slate-500">{label}:</span>
      <a href={href} className="font-medium text-slate-800 hover:text-brand-700 hover:underline tabular-nums">{value}</a>
      <button
        type="button" onClick={copy}
        className="text-slate-400 transition hover:text-brand-600"
        aria-label={`העתקת ${label}`}
        title={`העתקת ${label}`}
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="6" y="6" width="10" height="10" rx="1.5" /><path d="M4 13V5a1 1 0 0 1 1-1h8" />
        </svg>
      </button>
    </div>
  );
}

const dayFormatter = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

function Transcript({ messages, leadId }: { messages: MessageRow[]; leadId: string }) {
  const auth = useAuthForTune();
  const canTune = auth.role === 'owner' || auth.role === 'admin';
  const canRate = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia' || auth.role === 'sales_rep';
  // P3.6 — Open the decision inspector to managers (mia), not just admin.
  // Mia now sees variant + playbook + flags inline, so her thumbs-up/down
  // ratings have visible context. Admins still see the technical fields.
  const canDebug = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'mia';
  const isAdmin = auth.role === 'owner' || auth.role === 'admin';
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  const reviewsQ = useQuery({
    queryKey: ['ai-reviews-for-lead', leadId],
    queryFn: () => fetchAiReviewsForLead(leadId),
    enabled: !!leadId && canRate,
  });
  const reviewsByDecision = new Map<string, AiDecisionReview>();
  for (const r of reviewsQ.data?.reviews ?? []) {
    reviewsByDecision.set(r.decision_id, r);
  }

  // Lazy: only fetch decision metadata when at least one AI message in this
  // transcript has a decision_id and the operator can debug.
  const hasDecisions = canDebug && messages.some((m) => m.ai_decision_id);
  const decisionsQ = useQuery({
    queryKey: ['ai-decisions-for-lead', leadId],
    queryFn: () => fetchAiDecisionsForLead(leadId),
    enabled: hasDecisions,
  });
  const decisionsById = new Map<string, AiDecisionMetadata>();
  for (const d of decisionsQ.data ?? []) decisionsById.set(d.id, d);

  if (messages.length === 0) return <p className="mt-2 text-sm text-slate-500">אין הודעות.</p>;
  return (
    <ol className="mt-3 max-h-[60vh] space-y-3 overflow-auto pr-1 sm:max-h-[28rem]">
      {grouped.map(({ day, items }) => (
        <li key={day}>
          <div className="my-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{day}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <ul className="space-y-2">
            {items.map((m) => {
              const existing = m.ai_decision_id ? reviewsByDecision.get(m.ai_decision_id) ?? null : null;
              return (
                <li key={m.id} className={messageBubbleClass(m)}>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{senderLabel(m.sender_type)}</span>
                    <span>·</span>
                    <span title={m.created_at}>{formatRelative(m.created_at)}</span>
                    {m.provider_status ? <span className="kf-badge kf-badge-mute">{m.provider_status}</span> : null}
                    {canTune && m.direction === 'inbound' && m.content_text ? (
                      <Link
                        to={`/admin/objections?from_lead=${encodeURIComponent(leadId)}&inbound=${encodeURIComponent(m.content_text)}`}
                        className="ms-auto text-[11px] text-brand-700 hover:underline"
                        title="צור התנגדות חדשה עם ההודעה הזו כ-keyword"
                      >
                        + התנגדות
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {m.content_text || (m.message_type === 'media' ? '[מדיה]' : '—')}
                  </div>
                  {canRate && m.sender_type === 'ai' && m.ai_decision_id ? (
                    <ReviewWidget decisionId={m.ai_decision_id} leadId={leadId} existing={existing} />
                  ) : null}
                  {canDebug && m.sender_type === 'ai' && m.ai_decision_id ? (
                    <DebugPanel decision={decisionsById.get(m.ai_decision_id) ?? null} isAdmin={isAdmin} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function DebugPanel({ decision, isAdmin }: { decision: AiDecisionMetadata | null; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  if (!decision) {
    return (
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer select-none">🔍 פרטי AI (טוען…)</summary>
      </details>
    );
  }
  const validatedReply = (decision.validated_output_json?.replyText as string | null | undefined) ?? null;
  const rawReply = (decision.raw_output_json?.replyText as string | null | undefined) ?? null;
  const replyChanged = !!rawReply && !!validatedReply && rawReply !== validatedReply;
  const flags = (decision.validated_output_json?.policyFlags as string[] | undefined) ?? [];
  const intent = decision.validated_output_json?.intentClassification as string | undefined;
  const sendMode = decision.validated_output_json?.sendMode as string | undefined;

  return (
    <details
      className="mt-2 rounded-md border border-slate-200/70 bg-white/50 text-xs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-2 py-1 text-slate-600 hover:text-brand-700">
        🔍 פרטי AI · גרסה {decision.prompt_version}
      </summary>
      <dl className="space-y-1 p-2">
        <DebugRow k="playbook" v={decision.playbook_name} />
        <DebugRow k="prompt_version" v={decision.prompt_version} />
        {isAdmin ? <DebugRow k="model" v={decision.model_name} /> : null}
        <DebugRow
          k="status"
          v={decision.execution_status}
          highlight={!decision.execution_status.endsWith('_success')}
        />
        {intent ? <DebugRow k="intent" v={intent} /> : null}
        {sendMode ? <DebugRow k="send_mode" v={sendMode} /> : null}
        {decision.error_message ? <DebugRow k="error" v={decision.error_message} highlight /> : null}
        {flags.length > 0 ? (
          <DebugRow k="flags" v={flags.join(', ')} highlight />
        ) : null}
        {replyChanged ? (
          <div className="mt-2 rounded bg-amber-50 p-2">
            <div className="text-[11px] font-medium text-amber-800">⚠️ הvalidator שינה את הreply</div>
            <div className="mt-1 text-[11px] text-slate-600 line-through">{rawReply}</div>
            <div className="mt-1 text-[11px] text-slate-700">{validatedReply ?? '(הוסר)'}</div>
          </div>
        ) : null}
        {!isAdmin ? (
          <p className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-600">
            💡 גרסת ה-prompt שצוינה למעלה היא זו שייצרה את התשובה. הדרוג שלך נשמר ומשפיע על המשקל של הגרסה בריצה הלילית הבאה.
          </p>
        ) : null}
      </dl>
    </details>
  );
}

function DebugRow({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
      <dd className={highlight ? 'text-rose-700 font-medium' : 'text-slate-700'}>{v}</dd>
    </div>
  );
}

function ReviewWidget({
  decisionId, leadId, existing,
}: {
  decisionId: string;
  leadId: string;
  existing: AiDecisionReview | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState(existing?.correction_text ?? '');

  const rate = useMutation({
    mutationFn: (rating: -1 | 0 | 1) =>
      postAiReview({ decisionId, rating, correctionText: correction.trim() || null }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ai-reviews-for-lead', leadId] });
      toast.success(res.review.rating === 1 ? 'תודה — סומן כחיובי' : res.review.rating === -1 ? 'נרשם — נשתפר' : 'הערה נשמרה');
      setShowCorrection(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const upActive = existing?.rating === 1;
  const downActive = existing?.rating === -1;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2">
      <button
        type="button"
        className={`rounded-full px-2 py-0.5 text-xs ${upActive ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-emerald-50'}`}
        title="תשובה טובה"
        onClick={() => rate.mutate(1)}
        disabled={rate.isPending}
      >👍</button>
      <button
        type="button"
        className={`rounded-full px-2 py-0.5 text-xs ${downActive ? 'bg-rose-100 text-rose-800' : 'text-slate-500 hover:bg-rose-50'}`}
        title="תשובה רעה — שווה תיקון"
        onClick={() => rate.mutate(-1)}
        disabled={rate.isPending}
      >👎</button>
      <button
        type="button"
        className="text-xs text-slate-500 hover:text-brand-700 hover:underline"
        onClick={() => setShowCorrection((s) => !s)}
      >
        {showCorrection ? 'סגור' : 'הוסף הערה'}
      </button>
      {existing?.correction_text ? (
        <span className="text-xs text-slate-500" title={existing.correction_text}>· הערה רשומה</span>
      ) : null}
      {showCorrection ? (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); rate.mutate(existing?.rating ?? 0); }}
        >
          <textarea
            className="kf-input flex-1 min-h-[44px] text-xs"
            placeholder="מה היה צריך להיות במקום? (יישמר לcorrection_text)"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />
          <button type="submit" className="kf-btn kf-btn-primary text-xs" disabled={rate.isPending || !correction.trim()}>
            שמור הערה
          </button>
        </form>
      ) : null}
    </div>
  );
}

function groupByDay(messages: MessageRow[]): Array<{ day: string; items: MessageRow[] }> {
  const groups = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const ts = Date.parse(m.created_at);
    const key = Number.isFinite(ts) ? dayFormatter.format(new Date(ts)) : '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
}

function senderLabel(t: MessageRow['sender_type']): string {
  switch (t) {
    case 'lead': return 'ליד';
    case 'ai': return 'AI';
    case 'mia': return 'מיה';
    case 'sales_rep': return 'איש מכירות';
    case 'system': return 'מערכת';
    case 'admin': return 'אדמין';
    default: return t;
  }
}

function messageBubbleClass(m: MessageRow): string {
  const base = 'rounded-2xl p-3 max-w-[85%] shadow-sm';
  if (m.direction === 'inbound') return `${base} bg-slate-100 mr-auto`;
  if (m.sender_type === 'ai') return `${base} bg-brand-50 ms-auto`;
  return `${base} bg-amber-50 ms-auto`;
}

function waLink(phone: string): string {
  // WhatsApp wa.me expects international format with no '+' (e.g. 972501234567).
  // Israeli leads land in the DB as 0XXXXXXXXX (per normalizeIsraeliPhone),
  // so we need to swap the leading 0 for 972 when we shape the URL.
  const digits = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 9)) {
    return `https://wa.me/972${digits.slice(1)}`;
  }
  return `https://wa.me/${digits}`;
}

function CallLogForm({ onSubmit, submitting, errorMessage }: {
  onSubmit: (outcome: CallOutcome, durationMinutes: number, note: string | null) => void;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>('connected');
  const [duration, setDuration] = useState<string>('5');
  const [note, setNote] = useState('');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const minutes = Math.max(0, Number(duration) || 0);
    onSubmit(outcome, minutes, note.trim() || null);
    setNote('');
    setDuration('5');
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-slate-600">תוצאה</span>
          <select className="kf-input mt-1" value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
            <option value="connected">התקיימה שיחה</option>
            <option value="no_answer">אין מענה</option>
            <option value="voicemail">תא קולי</option>
            <option value="declined">סירב לדבר</option>
            <option value="callback_requested">ביקש שנחזור</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">משך (דק׳)</span>
          <input type="number" min={0} max={180} className="kf-input mt-1" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      <textarea
        className="kf-input min-h-[64px]"
        placeholder="סיכום השיחה והצעדים הבאים..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit" className="kf-btn kf-btn-primary w-full sm:w-auto" disabled={submitting}>
        {submitting ? 'שומר...' : 'שמירת שיחה'}
      </button>
      {errorMessage ? <p className="text-rose-600">{errorMessage}</p> : null}
    </form>
  );
}

function EmailDraftsPanel({ leadId, leadEmail }: { leadId: string; leadEmail: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const drafts = useQuery({
    queryKey: ['email-drafts', leadId],
    queryFn: () => fetchEmailDraftsForLead(leadId),
    enabled: !!leadId,
  });
  const create = useMutation({
    mutationFn: () => createEmailDraft({ leadId, subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-drafts', leadId] });
      setSubject(''); setBody(''); setComposing(false);
      toast.success('טיוטה נשמרה');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveEmailDraft(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-drafts', leadId] });
      toast.success('טיוטה הועברה לארכיון');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function mailtoFor(d: OutboundEmailDraft): string {
    const to = leadEmail ?? '';
    const params = new URLSearchParams({ subject: d.subject, body: d.body });
    return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  }

  const live = (drafts.data ?? []).filter((d) => d.status !== 'archived');

  return (
    <div className="kf-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">טיוטות אימייל</h2>
        {!composing ? (
          <button
            type="button" className="kf-btn kf-btn-ghost text-xs"
            onClick={() => setComposing(true)}
            disabled={!leadEmail}
            title={leadEmail ? 'יצירת טיוטה חדשה' : 'אין אימייל לליד'}
          >
            + טיוטה
          </button>
        ) : null}
      </div>
      {!leadEmail ? (
        <p className="mt-2 text-xs text-slate-500">אין אימייל לליד — הוסף אימייל כדי לחבר טיוטה.</p>
      ) : null}

      {composing ? (
        <form
          className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50/40 p-3"
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
          <input
            className="kf-input"
            placeholder="נושא"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
          <textarea
            className="kf-input min-h-[120px]"
            placeholder="גוף האימייל"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="kf-btn kf-btn-ghost" onClick={() => { setComposing(false); setSubject(''); setBody(''); }}>
              ביטול
            </button>
            <button type="submit" className="kf-btn kf-btn-primary" disabled={create.isPending || !subject.trim() || !body.trim()}>
              {create.isPending ? 'שומר…' : 'שמירת טיוטה'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            ⓘ הטיוטה נשמרת ב-DB. אין כרגע שילוב עם ספק email — עד לחיבור, פתח עם "פתח ב-mail" כדי לשלוח דרך הקליינט שלך.
          </p>
        </form>
      ) : null}

      {drafts.isLoading ? (
        <p className="mt-2 text-sm text-slate-500">טוען…</p>
      ) : live.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">אין טיוטות פתוחות.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {live.map((d) => (
            <li key={d.id} className="rounded-md bg-slate-50 p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <strong className="truncate">{d.subject}</strong>
                <span className="text-xs text-slate-500">{formatRelative(d.created_at)}</span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-slate-600">{d.body}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a className="kf-btn kf-btn-ghost text-xs" href={mailtoFor(d)}>פתח ב-mail</a>
                <button
                  type="button" className="kf-btn kf-btn-ghost text-xs"
                  onClick={() => archive.mutate(d.id)}
                  disabled={archive.isPending}
                >
                  ארכוב
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadEditForm({ lead, pending, error, onSubmit, onCancel }: {
  lead: LeadDetail;
  pending: boolean;
  error: string | null;
  onSubmit: (payload: UpdateLeadPayload) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(lead.full_name ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [email, setEmail] = useState(lead.email ?? '');
  const [source, setSource] = useState(lead.source ?? 'manual_entry');
  const [sourceDetail, setSourceDetail] = useState(lead.source_detail ?? '');
  const [sourceCampaign, setSourceCampaign] = useState(lead.source_campaign ?? '');
  const [notesInternal, setNotesInternal] = useState(lead.notes_internal ?? '');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Send only fields that actually changed — minimises blast radius.
    const payload: UpdateLeadPayload = { leadId: lead.id, expectedUpdatedAt: lead.updated_at };
    if ((lead.full_name ?? '') !== fullName) payload.fullName = fullName.trim() || null;
    if ((lead.phone ?? '') !== phone) payload.phone = phone.trim() || null;
    if ((lead.email ?? '') !== email) payload.email = email.trim() || null;
    if ((lead.source ?? '') !== source) payload.source = source;
    if ((lead.source_detail ?? '') !== sourceDetail) payload.sourceDetail = sourceDetail.trim() || null;
    if ((lead.source_campaign ?? '') !== sourceCampaign) payload.campaignName = sourceCampaign.trim() || null;
    if ((lead.notes_internal ?? '') !== notesInternal) payload.notesInternal = notesInternal.trim() || null;
    onSubmit(payload);
  }

  return (
    <form className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/40 p-4" onSubmit={handleSubmit}>
      <div className="text-sm font-semibold text-slate-700">עריכת פרטי הליד</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-500">שם מלא</span>
          <input className="kf-input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">טלפון</span>
          <input
            className="kf-input mt-1"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">אימייל</span>
          <input
            className="kf-input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">מקור</span>
          <select className="kf-input mt-1" value={source} onChange={(e) => setSource(e.target.value)}>
            {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">פירוט מקור</span>
          <input className="kf-input mt-1" value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">קמפיין מקור</span>
          <input className="kf-input mt-1" value={sourceCampaign} onChange={(e) => setSourceCampaign(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-slate-500">הערות פנימיות</span>
          <textarea
            className="kf-input mt-1"
            rows={3}
            value={notesInternal}
            onChange={(e) => setNotesInternal(e.target.value)}
          />
        </label>
      </div>
      {error ? (
        <div className="text-sm text-rose-700">
          {error}
          {error.includes('Lead was modified') ? (
            <div className="mt-1 text-xs">רענן את הדף וטען את הגרסה האחרונה לפני שמירה.</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="kf-btn kf-btn-ghost" onClick={onCancel} disabled={pending}>ביטול</button>
        <button type="submit" className="kf-btn kf-btn-primary" disabled={pending}>
          {pending ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </form>
  );
}

function ReplyBox({ disabled, onSend, sending, errorMessage }: {
  disabled: boolean;
  onSend: (text: string) => void;
  sending: boolean;
  errorMessage: string | null;
}) {
  const [text, setText] = useState('');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <textarea
        className="kf-input min-h-[88px]"
        placeholder={disabled ? 'לא ניתן לשלוח (ליד מושתק או חסרה שיחה).' : 'הקלד תשובה ידנית...'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="text-xs text-slate-500">
          ייצא דרך WhatsApp באופן אוטומטי. מחוץ לחלון 24 שעות תישלח תבנית.
        </p>
        <button type="submit" className="kf-btn kf-btn-primary w-full sm:w-auto" disabled={disabled || sending || !text.trim()}>
          {sending ? 'שולח...' : 'שליחה'}
        </button>
      </div>
      {errorMessage ? <p className="text-sm text-rose-600">{errorMessage}</p> : null}
    </form>
  );
}

// ── Multi-operator presence stack (P2.5) ─────────────────────────────────
function PresenceStack({ viewers }: { viewers: PresenceUser[] }) {
  if (viewers.length === 0) return null;
  return (
    <div
      className="ms-auto inline-flex -space-x-1 rtl:space-x-reverse"
      title={viewers.map((v) => v.fullName || v.email || v.userId).join(', ')}
      aria-label={`${viewers.length} ${viewers.length === 1 ? 'מפעיל נוסף צופה' : 'מפעילים נוספים צופים'}`}
    >
      {viewers.slice(0, 3).map((v) => (
        <span
          key={v.userId}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-amber-100 text-[10px] font-semibold text-amber-800 shadow"
          title={v.fullName || v.email || v.userId}
        >
          {initialsOf(v.fullName ?? v.email ?? '?')}
        </span>
      ))}
      {viewers.length > 3 ? (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-700 shadow">
          +{viewers.length - 3}
        </span>
      ) : null}
      <span className="ms-2 self-center text-xs text-slate-500">
        {viewers.length === 1 ? 'צופה בליד עכשיו' : `${viewers.length} צופים בליד עכשיו`}
      </span>
    </div>
  );
}

function initialsOf(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  // Single-word: take first two chars (handles Hebrew first names cleanly).
  return parts[0]!.slice(0, 2);
}

// ── Inline next-action setter (P2.7) ──────────────────────────────────────
// Until now, setting "follow up tomorrow" required opening the full lead
// edit form (4 fields + concurrency token). This widget is two selects in
// the sidebar — saves Mia a ~5-click workflow.

const NEXT_ACTION_OPTIONS: Array<{ value: import('@/lib/api').NextActionType; label: string }> = [
  { value: 'wait_inbound',    label: 'מחכה לתגובה מהליד' },
  { value: 'send_follow_up',  label: 'שליחת פולואפ' },
  { value: 'send_template',   label: 'שליחת תבנית' },
  { value: 'phone_call',      label: 'שיחת טלפון' },
  { value: 'mia_takeover',    label: 'מיה תיקח את זה' },
  { value: 'mark_dormant',    label: 'סמן כ-dormant' },
  { value: 'custom',          label: 'אחר' },
];

const DUE_AT_PRESETS: Array<{ key: string; label: string; deltaHours: number | 'custom' }> = [
  { key: 'today_eod', label: 'היום (סוף יום)', deltaHours: 0 },
  { key: 'plus_1d',   label: 'מחר',           deltaHours: 24 },
  { key: 'plus_3d',   label: '+3 ימים',       deltaHours: 72 },
  { key: 'plus_7d',   label: 'שבוע',          deltaHours: 168 },
  { key: 'custom',    label: 'מותאם...',      deltaHours: 'custom' },
];

function presetToIso(deltaHours: number | 'custom', customIsoLocal: string | null): string | null {
  if (deltaHours === 'custom') {
    if (!customIsoLocal) return null;
    const d = new Date(customIsoLocal);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (deltaHours === 0) {
    // "End of today" (Asia/Jerusalem 23:59 local).
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  return new Date(Date.now() + deltaHours * 3_600_000).toISOString();
}

function NextActionInline({
  leadId, currentType, currentDueAt, onSaved,
}: {
  leadId: string;
  currentType: string | null;
  currentDueAt: string | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState<string>(currentType ?? '');
  const [preset, setPreset] = useState<string>('plus_1d');
  const [customIso, setCustomIso] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function save() {
    setSaving(true); setError(null);
    try {
      const presetCfg = DUE_AT_PRESETS.find((p) => p.key === preset);
      const dueAt = presetCfg ? presetToIso(presetCfg.deltaHours, customIso || null) : null;
      await postUpdateLead({
        leadId,
        nextActionType: type ? (type as import('@/lib/api').NextActionType) : null,
        nextActionDueAt: dueAt,
      });
      toast.success('פעולה הבאה נקבעה');
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function clearAction() {
    setSaving(true); setError(null);
    try {
      await postUpdateLead({ leadId, nextActionType: null, nextActionDueAt: null });
      setType('');
      toast.success('פעולה הבאה נוקתה');
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-slate-700">פעולה הבאה</strong>
        {currentDueAt ? (
          <button type="button" className="text-xs text-slate-500 hover:text-rose-600" onClick={clearAction} disabled={saving}>
            נקה
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select
          className="kf-input"
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={saving}
        >
          <option value="">— בחר סוג —</option>
          {NEXT_ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="kf-input"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          disabled={saving}
        >
          {DUE_AT_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>
      {preset === 'custom' ? (
        <input
          type="datetime-local"
          className="kf-input"
          value={customIso}
          onChange={(e) => setCustomIso(e.target.value)}
          disabled={saving}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {currentDueAt ? `נוכחי: ${formatDateTime(currentDueAt)}` : 'אין פעולה הבאה'}
        </span>
        <button
          type="button"
          className="kf-btn kf-btn-primary text-xs"
          onClick={save}
          disabled={saving || !type}
        >
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
