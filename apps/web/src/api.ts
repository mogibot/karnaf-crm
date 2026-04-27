import type {
  DashboardSummaryResponse,
  LeadDetailResponse,
  LeadsListResponse,
  QueueListResponse,
} from './types';

const baseUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_BASE_URL || '';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboardSummary() {
  return fetchJson<DashboardSummaryResponse>('/dashboard-summary');
}

export function fetchLeadsList() {
  return fetchJson<LeadsListResponse>('/leads-list');
}

export function fetchQueueList() {
  return fetchJson<QueueListResponse>('/queue-list');
}

export function fetchLeadDetail(leadId: string) {
  return fetchJson<LeadDetailResponse>(`/lead-detail?leadId=${encodeURIComponent(leadId)}`);
}
