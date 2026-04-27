import { useEffect, useState } from 'react';
import { fetchDashboardSummary, fetchLeadDetail, fetchLeadsList, fetchQueueList, postAdminAction } from './api';
import type { DashboardSummaryResponse, LeadDetailResponse, LeadsListResponse, QueueListResponse } from './types';
import { SummaryCard } from './components/SummaryCard';
import { LeadsTable } from './components/LeadsTable';
import { QueueList } from './components/QueueList';
import { LeadDetailPanel } from './components/LeadDetailPanel';
import { TopNav } from './components/TopNav';

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardSummaryResponse['summary'] | null>(null);
  const [leads, setLeads] = useState<LeadsListResponse['leads']>([]);
  const [queueItems, setQueueItems] = useState<QueueListResponse['queueItems']>([]);
  const [selectedLead, setSelectedLead] = useState<LeadDetailResponse['lead'] | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<LeadDetailResponse['messages']>([]);
  const [selectedQueueItems, setSelectedQueueItems] = useState<LeadDetailResponse['queueItems']>([]);
  const [currentView, setCurrentView] = useState<'dashboard' | 'leads' | 'queue'>('dashboard');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchDashboardSummary(),
      fetchLeadsList(),
      fetchQueueList(),
    ])
      .then(([dashboardRes, leadsRes, queueRes]) => {
        setDashboard(dashboardRes.summary);
        setLeads(leadsRes.leads);
        setQueueItems(queueRes.queueItems);
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, []);

  async function handleSelectLead(leadId: string) {
    try {
      const detail = await fetchLeadDetail(leadId);
      setSelectedLead(detail.lead);
      setSelectedMessages(detail.messages);
      setSelectedQueueItems(detail.queueItems);
      setCurrentView('leads');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runLeadAction(action: string) {
    if (!selectedLead?.id) return;
    try {
      await postAdminAction({
        action,
        leadId: selectedLead.id,
        conversationId: null,
      });
      await handleSelectLead(String(selectedLead.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', padding: 24, direction: 'rtl', display: 'grid', gap: 24 }}>
      <header>
        <h1>Karnaf CRM Core</h1>
        <p>Starter operator shell</p>
        <TopNav currentView={currentView} onChange={setCurrentView} />
      </header>

      {error ? <p style={{ color: 'crimson' }}>שגיאה: {error}</p> : null}

      {currentView === 'dashboard' ? (
        <section>
          <h2>Dashboard</h2>
          {dashboard ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <SummaryCard label="לידים היום" value={dashboard.leadsToday} />
              <SummaryCard label="ממתינים למענה" value={dashboard.unansweredNow} />
              <SummaryCard label="לידים חמים" value={dashboard.hotLeadsNow} />
              <SummaryCard label="ממתינים לתשלום" value={dashboard.paymentPendingNow} />
              <SummaryCard label="סיכון SLA" value={dashboard.slaRiskCount} />
            </div>
          ) : (
            <p>טוען...</p>
          )}
        </section>
      ) : null}

      {currentView === 'leads' ? (
        <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24 }}>
          <div>
            <h2>Leads</h2>
            <LeadsTable leads={leads} onSelectLead={handleSelectLead} />
          </div>

          <div>
            <h2>Lead detail</h2>
            <LeadDetailPanel
              lead={selectedLead}
              messages={selectedMessages}
              queueItems={selectedQueueItems}
              onAssignToMia={() => runLeadAction('assign_to_mia')}
              onReturnToAi={() => runLeadAction('return_to_ai')}
              onMarkPhoneEscalation={() => runLeadAction('mark_phone_escalation')}
              onMarkDnc={() => runLeadAction('mark_dnc')}
            />
          </div>
        </section>
      ) : null}

      {currentView === 'queue' ? (
        <section>
          <h2>Queue</h2>
          <QueueList queueItems={queueItems} />
        </section>
      ) : null}
    </main>
  );
}
