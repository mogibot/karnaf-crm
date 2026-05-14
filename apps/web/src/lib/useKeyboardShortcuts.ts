// Global keyboard shortcuts for power-operator workflows. Uses physical
// key codes (`event.code`) rather than `event.key` so Hebrew + English
// layouts behave identically — a Mia hitting `J` on a Hebrew keyboard
// fires `KeyJ` the same as on US-English.
//
// Bindings shipped:
//   * Ctrl/Cmd+K        — open global search modal (state surface left to
//                          caller; this hook only fires the callback).
//   * Ctrl/Cmd+S        — save (caller decides what "save" means in context).
//   * J / K             — next / previous lead in list (LeadsPage callback).
//   * ?  (Shift+/)      — toggle cheatsheet.
//
// All bindings are skipped when focus is inside an editable element
// (input, textarea, contenteditable) so typing in a reply box doesn't
// trigger navigation.

import { useEffect, useState } from 'react';

export interface ShortcutHandlers {
  onSearch?: () => void;
  onSave?: () => void;
  onNextLead?: () => void;
  onPrevLead?: () => void;
  onToggleHelp?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement | null);
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const editable = isEditableTarget(e.target);
      const mod = e.ctrlKey || e.metaKey;

      // Cmd/Ctrl+K — always available, even in inputs (it's "global search").
      if (mod && e.code === 'KeyK') {
        e.preventDefault();
        handlers.onSearch?.();
        return;
      }

      // Cmd/Ctrl+S — handler decides. Don't preempt the browser's "save
      // page" if no handler is wired.
      if (mod && e.code === 'KeyS' && handlers.onSave) {
        e.preventDefault();
        handlers.onSave();
        return;
      }

      if (editable) return;

      if (e.code === 'KeyJ' && handlers.onNextLead) {
        e.preventDefault();
        handlers.onNextLead();
        return;
      }
      if (e.code === 'KeyK' && handlers.onPrevLead) {
        e.preventDefault();
        handlers.onPrevLead();
        return;
      }

      // `?` — physically Shift + Slash on US, Shift + 9 on IL — accept both.
      if ((e.code === 'Slash' && e.shiftKey)
          || (e.code === 'Digit9' && e.shiftKey)) {
        e.preventDefault();
        handlers.onToggleHelp?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers.onSearch, handlers.onSave, handlers.onNextLead, handlers.onPrevLead, handlers.onToggleHelp]);
}

// ── Cheatsheet state + provider hook ────────────────────────────────────
export function useShortcutHelp() {
  const [open, setOpen] = useState(false);
  useKeyboardShortcuts({ onToggleHelp: () => setOpen((v) => !v) });
  return { open, close: () => setOpen(false) };
}
