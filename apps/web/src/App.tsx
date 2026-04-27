import { useEffect, useState } from 'react';
import { fetchDashboardSummary, fetchLeadsList, fetchQueueList } from './api';
import type { DashboardSummaryResponse, LeadsListResponse, QueueListResponse } from './types';

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardSummaryResponse['summary'] | null>(null);
  const [leads, setLeads] = useState<LeadsListResponse['leads']>([]);
  const [queueItems, setQueueItems] = useState<QueueListResponse['queueItems']>([]);
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

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', padding: 24, direction: 'rtl' }}>
      <h1>Karnaf CRM Core</h1>
      <p>Starter operator shell</p>

      {error ? <p style={{ color: 'crimson' }}>שגיאה: {error}</p> : null}

      <section>
        <h2>Dashboard summary</h2>
        {dashboard ? (
          <ul>
            <li>לידים היום: {dashboard.leadsToday}</li>
            <li>ממתינים למענה: {dashboard.unansweredNow}</li>
            <li>לידים חמים: {dashboard.hotLeadsNow}</li>
            <li>ממתינים לתשלום: {dashboard.paymentPendingNow}</li>
            <li>סיכון SLA: {dashboard.slaRiskCount}</li>
          </ul>
        ) : (
          <p>טוען...</p>
        )}
      </section>

      <section>
        <h2>Leads</h2>
        <p>סה"כ כרגע: {leads.length}</p>
      </section>

      <section>
        <h2>Queue</h2>
        <p>פריטים פתוחים: {queueItems.length}</p>
      </section>
    </main>
  );
}
