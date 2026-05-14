// Floating cheatsheet for the global keyboard shortcuts. Triggered by
// pressing `?` anywhere (see useKeyboardShortcuts).

interface Props { open: boolean; onClose: () => void; }

const BINDINGS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl/Cmd + K', label: 'חיפוש מהיר' },
  { keys: 'Ctrl/Cmd + S', label: 'שמירה (היכן שזמין)' },
  { keys: 'J',            label: 'ליד הבא ברשימה' },
  { keys: 'K',            label: 'ליד קודם ברשימה' },
  { keys: '?',            label: 'הצג/הסתר עזרה זו' },
  { keys: 'Esc',          label: 'סגירת חלון / ביטול' },
];

export function ShortcutHelp({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog" aria-modal="true" aria-label="קיצורי מקלדת"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="kf-card max-w-md w-[calc(100%-2rem)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">קיצורי מקלדת</h2>
          <button type="button" className="text-slate-500 hover:text-slate-900" aria-label="סגירה" onClick={onClose}>×</button>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          {BINDINGS.map((b) => (
            <div key={b.keys} className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">{b.label}</dt>
              <dd>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono">{b.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          קיצורים מתעלמים משדות טקסט — אפשר להקליד תשובה בלי שיופעלו.
        </p>
      </div>
    </div>
  );
}
