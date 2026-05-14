// Operator browser-notification surface.
//
// Three event types Mia cares about while she has another tab focused:
//   1. hot_lead_arrived       — a new lead with heat=hot landed.
//   2. sla_about_to_breach    — a lead is 15min away from first-response SLA.
//   3. ai_confused            — AI returned escalateToMia=true or
//                                confidence<0.4 on its last decision.
//
// Server-side: a Supabase Realtime broadcast channel keyed
// `notifications:operator:<userId>` carries events. The backend can either:
//   (a) push via Supabase Realtime broadcast (cheapest, fits the pattern),
//   (b) write to `operator_notifications` table that's in the realtime
//       publication (durable but heavier).
// This client subscribes to broadcast first; falls back silently when the
// channel isn't reachable. The parallel Telegram surface (notify-telegram
// shared helper, server-side) is the ground-truth alerting path.

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

export type OperatorNotificationKind =
  | 'hot_lead_arrived'
  | 'sla_about_to_breach'
  | 'ai_confused';

export interface OperatorNotification {
  kind: OperatorNotificationKind;
  title: string;
  body: string;
  /** Optional internal route to deep-link the operator to (e.g. `/leads/<id>`). */
  href?: string;
  /** Server-supplied lead id for grouping / dedupe. */
  leadId?: string;
  /** ISO timestamp the server emitted at. */
  emittedAt: string;
}

const STORAGE_KEY = 'kf:notifications:permission_asked';

/**
 * Ask the browser for Notification permission once. Idempotent across
 * page loads — we remember in localStorage that we already asked, so we
 * don't pester the operator on every visit.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  if (localStorage.getItem(STORAGE_KEY) === 'asked') {
    return 'default';
  }
  try {
    const result = await Notification.requestPermission();
    localStorage.setItem(STORAGE_KEY, 'asked');
    return result;
  } catch {
    return 'denied';
  }
}

function showBrowserNotification(n: OperatorNotification) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  // Re-use a tag per leadId so the same lead doesn't pop two notifications
  // (e.g. SLA-warn + AI-confused arrive in quick succession).
  const tag = n.leadId ? `${n.kind}:${n.leadId}` : `${n.kind}:${n.emittedAt}`;
  // `renotify` is in the spec but not in the lib.dom NotificationOptions
  // type as of TS 5.x. Cast the options bag so we can pass it through.
  const notif = new Notification(n.title, {
    body: n.body,
    tag,
    icon: '/favicon.ico',
    renotify: !!n.leadId,
  } as NotificationOptions & { renotify?: boolean });
  notif.onclick = () => {
    window.focus();
    if (n.href) window.location.assign(n.href);
    notif.close();
  };
}

/**
 * React hook: subscribe to the operator's broadcast channel and pop a
 * browser Notification per event. Pass the current userId; without it
 * this is a no-op. Callers should also call `ensureNotificationPermission`
 * on first interactive moment (e.g. the /queue page mount).
 */
export function useOperatorNotifications(userId: string | null): void {
  const lastSeenAt = useRef<string>('');

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications:operator:${userId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'notify' }, ({ payload }) => {
      const n = payload as OperatorNotification | undefined;
      if (!n || !n.emittedAt) return;
      // Cheap dedupe: ignore any event we've already shown by timestamp.
      if (n.emittedAt <= lastSeenAt.current) return;
      lastSeenAt.current = n.emittedAt;
      showBrowserNotification(n);
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[notifications] operator:${userId}: ${status}`);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
