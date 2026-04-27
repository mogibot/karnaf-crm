interface TopNavProps {
  currentView: 'dashboard' | 'leads' | 'queue';
  onChange: (view: 'dashboard' | 'leads' | 'queue') => void;
}

export function TopNav({ currentView, onChange }: TopNavProps) {
  const views: Array<'dashboard' | 'leads' | 'queue'> = ['dashboard', 'leads', 'queue'];

  return (
    <nav style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {views.map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => onChange(view)}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #ddd',
            background: currentView === view ? '#111' : '#fff',
            color: currentView === view ? '#fff' : '#111',
            cursor: 'pointer',
          }}
        >
          {view}
        </button>
      ))}
    </nav>
  );
}
