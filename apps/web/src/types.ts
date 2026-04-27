export interface DashboardSummaryResponse {
  ok: boolean;
  summary: {
    leadsToday: number;
    unansweredNow: number;
    hotLeadsNow: number;
    paymentPendingNow: number;
    slaRiskCount: number;
    queueCounts: Record<string, number>;
  };
}

export interface LeadsListResponse {
  ok: boolean;
  leads: Array<Record<string, unknown>>;
}

export interface LeadDetailResponse {
  ok: boolean;
  lead: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  queueItems: Array<Record<string, unknown>>;
}

export interface QueueListResponse {
  ok: boolean;
  queueItems: Array<Record<string, unknown>>;
}

export interface AdminActionResponse {
  ok: boolean;
  action: string;
}
