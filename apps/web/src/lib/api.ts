import { supabase } from './supabase';
import type {
  ConversationRow, DashboardSummary, EventRow, LeadDetail, LeadRow,
  MessageRow, QueueRow, TaskRow,
} from './types';

const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL || '/functions/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-correlation-id': crypto.randomUUID(),
  };
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined> | object): Promise<T> {
  const url = new URL(`${baseUrl}${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = await authHeaders();
  const res = await fetch(url.toString().replace(window.location.origin, ''), { headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed: ${res.status}`, body);
  return body as T;
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed: ${res.status}`, body);
  return body as T;
}

// === Reads ================================================================

export async function fetchDashboardSummary() {
  const r = await getJson<{ ok: true; summary: DashboardSummary }>('/dashboard-summary');
  return r.summary;
}

export type LeadsListSortColumn =
  | 'updated_at' | 'created_at' | 'lead_score' | 'lead_status' | 'lead_heat'
  | 'last_inbound_at' | 'last_outbound_at' | 'last_message_at' | 'full_name';
export type SortDir = 'asc' | 'desc';

export interface LeadsListParams {
  status?: string; heat?: string; ownershipMode?: string; search?: string;
  limit?: number; offset?: number;
  sortBy?: LeadsListSortColumn;
  sortDir?: SortDir;
}
export async function fetchLeadsList(params: LeadsListParams = {}) {
  const r = await getJson<{ ok: true; leads: LeadRow[]; total: number | null; limit: number; offset: number }>(
    '/leads-list', params,
  );
  return { leads: r.leads, total: r.total, limit: r.limit, offset: r.offset };
}

export async function fetchLeadDetail(leadId: string) {
  return getJson<{
    ok: true;
    lead: LeadDetail;
    conversations: ConversationRow[];
    messages: MessageRow[];
    queueItems: QueueRow[];
    tasks: TaskRow[];
    events: EventRow[];
  }>('/lead-detail', { leadId });
}

export async function fetchQueueList(params: { queueType?: string; status?: string } = {}) {
  const r = await getJson<{ ok: true; queueItems: QueueRow[] }>('/queue-list', params);
  return r.queueItems;
}

// === Writes ===============================================================

export type AdminAction =
  | 'assign_to_mia' | 'return_to_ai' | 'mark_phone_escalation'
  | 'mark_dnc' | 'mark_lost' | 'mark_won' | 'resolve_queue' | 'log_phone_call'
  | 'undo_recent_action';

export type CallOutcome = 'connected' | 'no_answer' | 'voicemail' | 'declined' | 'callback_requested';

export async function postAdminAction(payload: {
  action: AdminAction;
  leadId?: string;
  conversationId?: string | null;
  queueItemId?: string;
  note?: string | null;
  callOutcome?: CallOutcome;
  callDurationMinutes?: number;
}) {
  return postJson<{ ok: true; action: string }>('/admin-actions', payload);
}

export async function postSendReply(payload: { leadId: string; conversationId: string; text: string }) {
  return postJson<{ ok: true; mode: string }>('/send-reply', payload);
}

export async function postQueueResolve(payload: { queueItemId: string; resolutionNote?: string | null }) {
  return postJson<{ ok: true }>('/queue-resolve', payload);
}

// === Leads management ====================================================

export interface CreateLeadPayload {
  phone?: string | null;
  email?: string | null;
  fullName?: string | null;
  source?: string;
  sourceDetail?: string | null;
  campaignName?: string | null;
  city?: string | null;
  notesInternal?: string | null;
}

export type NextActionType =
  | 'wait_inbound' | 'send_follow_up' | 'phone_call' | 'mia_takeover'
  | 'send_template' | 'mark_dormant' | 'custom';

export interface UpdateLeadPayload {
  leadId: string;
  expectedUpdatedAt?: string;
  phone?: string | null;
  fullName?: string | null;
  email?: string | null;
  source?: string;
  sourceDetail?: string | null;
  campaignName?: string | null;
  webinarName?: string | null;
  leadMagnetName?: string | null;
  city?: string | null;
  notesInternal?: string | null;
  nextActionType?: NextActionType | null;
  nextActionDueAt?: string | null;
}

export async function postCreateLead(payload: CreateLeadPayload) {
  return postJson<{ ok: true; lead: LeadRow }>('/leads-manage', { action: 'create', ...payload });
}

export async function postUpdateLead(payload: UpdateLeadPayload) {
  return postJson<{ ok: true; lead: LeadRow }>('/leads-manage', { action: 'update', ...payload });
}

// ── Saved filters (P3.4) ──────────────────────────────────────────────────
// Uses the Supabase JS client directly — the table has RLS so the server
// enforces ownership/sharing. No Edge Function wrapper needed.
export interface SavedLeadFilter {
  id: string;
  owner_id: string;
  name: string;
  filter_json: Record<string, string>;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchSavedLeadFilters(): Promise<SavedLeadFilter[]> {
  const { data, error } = await supabase
    .from('lead_saved_filters')
    .select('id, owner_id, name, filter_json, is_shared, created_at, updated_at')
    .order('name');
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as SavedLeadFilter[];
}

export async function createSavedLeadFilter(payload: {
  name: string;
  filter_json: Record<string, string>;
  is_shared?: boolean;
}): Promise<SavedLeadFilter> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new ApiError(401, 'Not signed in');
  const { data, error } = await supabase
    .from('lead_saved_filters')
    .insert({
      owner_id: uid,
      name: payload.name.trim(),
      filter_json: payload.filter_json,
      is_shared: payload.is_shared ?? false,
    })
    .select('id, owner_id, name, filter_json, is_shared, created_at, updated_at')
    .single();
  if (error) throw new ApiError(500, error.message);
  return data as SavedLeadFilter;
}

export async function deleteSavedLeadFilter(id: string): Promise<void> {
  const { error } = await supabase.from('lead_saved_filters').delete().eq('id', id);
  if (error) throw new ApiError(500, error.message);
}

export async function postBulkPatchLeads(payload: {
  leadIds: string[];
  patch: {
    ownership_mode?: 'ai_active' | 'mia_active' | 'phone_sales_pending' | 'shared_watch' | 'suppressed';
    lead_status?: 'new' | 'first_contact_sent' | 'responded' | 'qualified' | 'nurture' | 'dormant';
    next_action_type?: NextActionType | null;
    next_action_due_at?: string | null;
    notes_internal?: string | null;
  };
}) {
  return postJson<{ ok: true; matched: number }>('/leads-manage', { action: 'bulk_patch', ...payload });
}

export async function postSoftDeleteLead(leadId: string, reason?: string | null) {
  return postJson<{ ok: true }>('/leads-manage', { action: 'delete', leadId, reason: reason ?? null });
}

export async function postRestoreLead(leadId: string) {
  return postJson<{ ok: true }>('/leads-manage', { action: 'restore', leadId });
}

// === Conversation claims (operator pause-AI) ===========================

export interface ConversationClaim {
  id: string;
  conversation_id: string;
  operator_id: string;
  claimed_at: string;
  expires_at: string;
  released_at: string | null;
  release_reason: string | null;
}

export async function postClaimConversation(conversationId: string, ttlMinutes = 30) {
  return postJson<{ ok: true; claim: ConversationClaim }>(
    '/conversation-claims',
    { action: 'claim', conversationId, ttlMinutes },
  );
}

export async function postReleaseConversation(conversationId: string, reason?: string | null) {
  return postJson<{ ok: true; claim: ConversationClaim | null }>(
    '/conversation-claims',
    { action: 'release', conversationId, reason: reason ?? null },
  );
}

// === AI decision reviews (operator feedback) ===========================

export interface AiDecisionReview {
  id?: string;
  decision_id: string;
  rating: -1 | 0 | 1;
  correction_text?: string | null;
  created_at?: string;
}

export async function fetchAiReviewsForLead(leadId: string) {
  return getJson<{ ok: true; reviews: AiDecisionReview[] }>('/ai-review', { leadId });
}

export async function postAiReview(payload: { decisionId: string; rating: -1 | 0 | 1; correctionText?: string | null }) {
  return postJson<{ ok: true; review: AiDecisionReview }>('/ai-review', payload);
}

// === AI decision metadata (debug panel) =================================
//
// Slim projection — skips input_context_json so the wire stays small. RLS
// on ai_decisions lets staff read, so we go through supabase-js direct.

export interface AiDecisionMetadata {
  id: string;
  lead_id: string;
  playbook_name: string;
  prompt_version: string;
  model_name: string;
  execution_status: string;
  error_message: string | null;
  validated_output_json: {
    replyText?: string | null;
    policyFlags?: string[];
    sendMode?: string;
    intentClassification?: string;
    [k: string]: unknown;
  } | null;
  raw_output_json: {
    replyText?: string | null;
    [k: string]: unknown;
  } | null;
  created_at: string;
}

// === All AI reviews (admin dashboard) ====================================
//
// Joins ai_decision_reviews → ai_decisions so we can show the AI reply
// alongside the rating. RLS lets staff read both tables; service role not
// required.

export interface AiReviewWithDecision {
  id: string;
  decision_id: string;
  operator_id: string;
  rating: -1 | 0 | 1;
  correction_text: string | null;
  created_at: string;
  decision: {
    id: string;
    lead_id: string;
    playbook_name: string;
    prompt_version: string;
    validated_output_json: { replyText?: string | null } | null;
  };
}

export async function fetchAllAiReviews(opts: { rating?: -1 | 0 | 1; limit?: number } = {}): Promise<AiReviewWithDecision[]> {
  let q = supabase
    .from('ai_decision_reviews')
    .select('id, decision_id, operator_id, rating, correction_text, created_at, decision:ai_decisions!inner(id, lead_id, playbook_name, prompt_version, validated_output_json)')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (typeof opts.rating === 'number') q = q.eq('rating', opts.rating);
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  // Supabase typing for embedded selects returns an array; collapse to single.
  return (data ?? []).map((r) => ({
    ...r,
    decision: Array.isArray(r.decision) ? r.decision[0] : r.decision,
  })) as unknown as AiReviewWithDecision[];
}

export async function fetchAiDecisionsForLead(leadId: string): Promise<AiDecisionMetadata[]> {
  const { data, error } = await supabase
    .from('ai_decisions')
    .select('id, lead_id, playbook_name, prompt_version, model_name, execution_status, error_message, validated_output_json, raw_output_json, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as AiDecisionMetadata[];
}

// === Health page queries ===============================================
//
// All read-only via supabase-js. RLS on each base table already gates this
// to staff. We aggregate client-side because the volumes are small and the
// queries are dirt-simple.

export interface HealthSnapshot {
  leadsLast7d: number;
  leadsBySourceLast7d: Array<{ source: string; count: number; last_at: string | null }>;
  aiDecisionsLast24h: Array<{ status: string; count: number }>;
  aiDecisionsTotal24h: number;
  lastInboundPerChannel: Array<{ channel: string; last_at: string | null }>;
  recentBreachCount24h: number;
}

export async function fetchHealthSnapshot(): Promise<HealthSnapshot> {
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Leads in last 7d, grouped client-side by source.
  const leadsRes = await supabase
    .from('leads')
    .select('source, created_at')
    .gte('created_at', since7d)
    .limit(2000);
  const leadsBySource = new Map<string, { count: number; last_at: string | null }>();
  for (const row of leadsRes.data ?? []) {
    const s = (row.source as string) || 'unknown';
    const cur = leadsBySource.get(s) ?? { count: 0, last_at: null };
    cur.count += 1;
    if (!cur.last_at || (row.created_at as string) > cur.last_at) cur.last_at = row.created_at as string;
    leadsBySource.set(s, cur);
  }
  const leadsBySourceLast7d = Array.from(leadsBySource.entries())
    .map(([source, v]) => ({ source, count: v.count, last_at: v.last_at }))
    .sort((a, b) => b.count - a.count);

  // AI decisions last 24h grouped by execution_status
  const aiRes = await supabase
    .from('ai_decisions')
    .select('execution_status, created_at')
    .gte('created_at', since24h)
    .limit(2000);
  const byStatus = new Map<string, number>();
  for (const row of aiRes.data ?? []) {
    const s = (row.execution_status as string) || 'unknown';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const aiDecisionsLast24h = Array.from(byStatus.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const aiDecisionsTotal24h = aiRes.data?.length ?? 0;

  // Last inbound per conversation channel — proxies "is this intake source alive?"
  const convRes = await supabase
    .from('conversations')
    .select('channel, last_inbound_at')
    .not('last_inbound_at', 'is', null)
    .order('last_inbound_at', { ascending: false })
    .limit(500);
  const byChannel = new Map<string, string>();
  for (const row of convRes.data ?? []) {
    const c = (row.channel as string) || 'unknown';
    if (!byChannel.has(c) || (row.last_inbound_at as string) > (byChannel.get(c) ?? '')) {
      byChannel.set(c, row.last_inbound_at as string);
    }
  }
  const lastInboundPerChannel = Array.from(byChannel.entries())
    .map(([channel, last_at]) => ({ channel, last_at }))
    .sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));

  // SLA breach events last 24h — operator pulse
  const breachRes = await supabase
    .from('lead_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'sla_breach')
    .gte('created_at', since24h);
  const recentBreachCount24h = breachRes.count ?? 0;

  return {
    leadsLast7d: leadsRes.data?.length ?? 0,
    leadsBySourceLast7d,
    aiDecisionsLast24h,
    aiDecisionsTotal24h,
    lastInboundPerChannel,
    recentBreachCount24h,
  };
}

// === Outbound email drafts =============================================
//
// Goes straight through supabase-js (not an Edge Function) because RLS on
// outbound_email_drafts already gates writes to staff roles, and there's no
// per-row business logic the server needs to enforce — it's a notepad.

export interface OutboundEmailDraft {
  id: string;
  lead_id: string;
  created_by_user_id: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent' | 'archived';
  sent_at: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchEmailDraftsForLead(leadId: string): Promise<OutboundEmailDraft[]> {
  const { data, error } = await supabase
    .from('outbound_email_drafts')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as OutboundEmailDraft[];
}

export async function createEmailDraft(payload: { leadId: string; subject: string; body: string }): Promise<OutboundEmailDraft> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new ApiError(401, 'Not signed in');
  const { data, error } = await supabase
    .from('outbound_email_drafts')
    .insert({
      lead_id: payload.leadId,
      created_by_user_id: userId,
      subject: payload.subject,
      body: payload.body,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  return data as OutboundEmailDraft;
}

export async function archiveEmailDraft(id: string): Promise<void> {
  const { error } = await supabase
    .from('outbound_email_drafts')
    .update({ status: 'archived' })
    .eq('id', id);
  if (error) throw new ApiError(500, error.message);
}

// === Prompt-variant rating stats (from migration 022 view) ==============

export interface PromptVariantRatingStat {
  prompt_version: string;
  playbook_name: string;
  ratings_total: number;
  thumbs_up: number;
  thumbs_down: number;
  neutral_with_note: number;
  mean_rating: string | number | null;
  last_rated_at: string | null;
}

export async function fetchPromptVariantRatingStats(): Promise<PromptVariantRatingStat[]> {
  // View inherits RLS from base tables; staff users (incl viewer) can read.
  // Returns empty array if migration 022 isn't applied yet (graceful).
  const { data, error } = await supabase
    .from('v_prompt_variant_review_stats')
    .select('*');
  if (error) {
    // Don't throw — the variants page should still render without stats.
    console.warn('[api] fetchPromptVariantRatingStats:', error.message);
    return [];
  }
  return (data ?? []) as PromptVariantRatingStat[];
}

// === Objections (admin) =================================================
//
// All operations go through supabase-js direct: RLS on `objections` lets
// staff read, owner+admin write/update/delete. The Edge Function approach
// would add an unnecessary hop here.

export interface Objection {
  id: string;
  label: string;
  keywords: string[];
  canonical_response: string;
  applies_to_playbooks: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchObjections(): Promise<Objection[]> {
  const { data, error } = await supabase
    .from('objections')
    .select('*')
    .order('label', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as Objection[];
}

export async function createObjection(payload: Omit<Objection, 'id' | 'created_at' | 'updated_at'>): Promise<Objection> {
  const { data, error } = await supabase
    .from('objections')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  return data as Objection;
}

export async function updateObjection(id: string, patch: Partial<Omit<Objection, 'id' | 'created_at' | 'updated_at'>>): Promise<Objection> {
  const { data, error } = await supabase
    .from('objections')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  return data as Objection;
}

export async function deleteObjection(id: string): Promise<void> {
  const { error } = await supabase.from('objections').delete().eq('id', id);
  if (error) throw new ApiError(500, error.message);
}

// === Product info (crm_config row 'product') ===========================
//
// Same pattern — direct Supabase JS, RLS gates writes to owner+admin.

export interface ProductInfo {
  code: string;
  displayName: string;
  priceMinIls: number | null;
  priceTypicalIls: number | null;
  disclosePrice: boolean;
  priceRedirectMessage: string;
  elevatorPitch: string;
  whoIsItFor: string;
  outcome: string;
  boundaries: string[];
}

const PRODUCT_DEFAULT: ProductInfo = {
  code: 'derech_le_dira',
  displayName: 'הדרך לדירה',
  priceMinIls: null,
  priceTypicalIls: null,
  disclosePrice: false,
  priceRedirectMessage: 'המחיר משתנה לפי המסלול והצורך. אשמח שנציג יחזור אליך עם פרטים מדויקים והתאמה אישית.',
  elevatorPitch: '',
  whoIsItFor: '',
  outcome: '',
  boundaries: [],
};

export async function fetchProductInfo(): Promise<ProductInfo> {
  const { data, error } = await supabase
    .from('crm_config')
    .select('config_value')
    .eq('config_key', 'product')
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data?.config_value) return PRODUCT_DEFAULT;
  return { ...PRODUCT_DEFAULT, ...(data.config_value as Partial<ProductInfo>) };
}

export async function saveProductInfo(payload: ProductInfo): Promise<void> {
  const { error } = await supabase
    .from('crm_config')
    .upsert({
      config_key: 'product',
      config_value: payload,
    }, { onConflict: 'config_key' });
  if (error) throw new ApiError(500, error.message);
}

// === AI enabled channels (crm_config row 'ai_enabled_channels') =========

export const KNOWN_CHANNELS = ['whatsapp', 'instagram_dm', 'facebook_messenger', 'email'] as const;
export type AiChannel = typeof KNOWN_CHANNELS[number];

export async function fetchAiEnabledChannels(): Promise<string[]> {
  const { data, error } = await supabase
    .from('crm_config')
    .select('config_value')
    .eq('config_key', 'ai_enabled_channels')
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data?.config_value) return ['whatsapp']; // default mirrors config-service.ts
  return Array.isArray(data.config_value) ? data.config_value as string[] : ['whatsapp'];
}

export async function saveAiEnabledChannels(channels: string[]): Promise<void> {
  const { error } = await supabase
    .from('crm_config')
    .upsert({
      config_key: 'ai_enabled_channels',
      config_value: channels,
    }, { onConflict: 'config_key' });
  if (error) throw new ApiError(500, error.message);
}

// === Analytics ============================================================

export interface SourcePerformanceRow {
  source: string;
  leads_total: number;
  leads_engaged: number;
  leads_qualified: number;
  leads_checkout_pushed: number;
  leads_won: number;
  leads_lost: number;
  win_rate_pct: number;
}

export interface AgingBucket { count: number; avgMinutes: number; maxMinutes: number; }

export interface AiVsHumanRow { touch_pattern: string; lead_status: string; leads_count: number; }

export interface RecentActivityRow {
  id: string; lead_id: string; event_type: string; actor_type: string; created_at: string;
  full_name: string | null; phone: string | null; lead_status: string; lead_heat: string;
}

export interface PromptVariantOutcome {
  prompt_version: string;
  playbook_name: string;
  decisions_total: number;
  success_total: number;
  blocked_total: number;
  leads_touched: number;
  leads_won: number;
  leads_lost: number;
}

export interface LeadCohortRow {
  cohort_week: string;
  source: string;
  leads_total: number;
  responded: number;
  qualified: number;
  checkout_pushed: number;
  won: number;
  lost: number;
  win_rate_pct: number;
  avg_minutes_to_win: number;
}

export interface FirstResponseTimeRow {
  source: string;
  measured_leads: number;
  p50_minutes: number;
  p90_minutes: number;
  max_minutes: number;
  unanswered_leads: number;
}

export async function fetchAnalyticsSummary() {
  return getJson<{
    ok: true;
    sourcePerformance: SourcePerformanceRow[];
    aging: Record<string, AgingBucket>;
    recentActivity: RecentActivityRow[];
    aiVsHuman: AiVsHumanRow[];
    promptVariants: PromptVariantOutcome[];
    cohorts: LeadCohortRow[];
    firstResponseTimes: FirstResponseTimeRow[];
  }>('/analytics-summary');
}

// === Users management =====================================================

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'owner' | 'admin' | 'mia' | 'sales_rep' | 'viewer';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchUsersList() {
  const r = await getJson<{ ok: true; profiles: ProfileRow[] }>('/users-manage');
  return r.profiles;
}

export async function postCreateUser(payload: {
  email: string; password: string; role: ProfileRow['role']; fullName?: string | null;
}) {
  return postJson<{ ok: true; profile: ProfileRow }>('/users-manage', { action: 'create', ...payload });
}

export async function postUpdateUser(payload: {
  userId: string; role?: ProfileRow['role']; isActive?: boolean; fullName?: string | null;
}) {
  return postJson<{ ok: true; profile: ProfileRow }>('/users-manage', { action: 'update', ...payload });
}

export async function postResetUserPassword(userId: string, redirectTo?: string) {
  return postJson<{ ok: true; recoveryLink: string; email: string }>(
    '/users-manage',
    { action: 'reset_password', userId, redirectTo },
  );
}

export async function postInviteUser(payload: {
  email: string;
  role: ProfileRow['role'];
  fullName?: string | null;
  redirectTo?: string;
}) {
  return postJson<{ ok: true; inviteLink: string; email: string; profile: ProfileRow | null }>(
    '/users-manage',
    { action: 'invite', ...payload },
  );
}

// === Prompt variants =====================================================

export type PlaybookName =
  | 'first_contact_whatsapp_inbound' | 'first_contact_form_lead' | 'qualification'
  | 'price_objection' | 'free_advice_boundary' | 'checkout_push'
  | 'payment_pending_rescue' | 'phone_request' | 'opt_out';

export interface PromptVariantRow {
  id: string;
  playbook_name: PlaybookName;
  version: string;
  weight: number;
  prompt_overrides: { objective?: string; guidance?: string[]; [key: string]: unknown };
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

async function deleteJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  return postJson<T>(path, payload);
}

export async function fetchPromptVariants() {
  const r = await getJson<{ ok: true; variants: PromptVariantRow[] }>('/prompt-variants');
  return r.variants;
}

export async function postCreatePromptVariant(payload: {
  playbook_name: PlaybookName;
  version: string;
  weight: number;
  prompt_overrides?: PromptVariantRow['prompt_overrides'];
  is_active?: boolean;
  notes?: string | null;
}) {
  return postJson<{ ok: true; variant: PromptVariantRow }>('/prompt-variants', { action: 'create', ...payload });
}

export async function postUpdatePromptVariant(payload: {
  id: string;
  weight?: number;
  prompt_overrides?: PromptVariantRow['prompt_overrides'];
  is_active?: boolean;
  notes?: string | null;
}) {
  return postJson<{ ok: true; variant: PromptVariantRow }>('/prompt-variants', { action: 'update', ...payload });
}

export async function postDeletePromptVariant(id: string) {
  return deleteJson<{ ok: true }>('/prompt-variants', { action: 'delete', id });
}

// ── Prompt variant change-requests (mia → admin review flow) ──────────────
export type PromptVariantRequestKind =
  | 'tweak_objective' | 'tweak_guidance' | 'change_weight'
  | 'activate' | 'deactivate' | 'create_new' | 'remove';

export type PromptVariantRequestStatus = 'pending' | 'accepted' | 'declined' | 'superseded';

export interface PromptVariantChangeRequest {
  id: string;
  variant_id: string | null;
  playbook_name: PlaybookName;
  request_kind: PromptVariantRequestKind;
  rationale: string;
  proposed_change: Record<string, unknown>;
  status: PromptVariantRequestStatus;
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
}

export async function postRequestPromptVariantChange(payload: {
  variant_id?: string | null;
  playbook_name: PlaybookName;
  request_kind: PromptVariantRequestKind;
  rationale: string;
  proposed_change?: Record<string, unknown>;
}) {
  return postJson<{ ok: true; request: PromptVariantChangeRequest }>(
    '/prompt-variants',
    { action: 'request_change', ...payload },
  );
}

export async function fetchPromptVariantChangeRequests(status: PromptVariantRequestStatus = 'pending') {
  const r = await postJson<{ ok: true; requests: PromptVariantChangeRequest[] }>(
    '/prompt-variants',
    { action: 'list_requests', status },
  );
  return r.requests;
}

export async function postReviewPromptVariantChangeRequest(payload: {
  request_id: string;
  decision: 'accept' | 'decline';
  reviewer_note?: string | null;
}) {
  return postJson<{ ok: true; request: Pick<PromptVariantChangeRequest, 'id' | 'status' | 'reviewed_by' | 'reviewed_at' | 'reviewer_note'> }>(
    '/prompt-variants',
    { action: 'review_request', ...payload },
  );
}
