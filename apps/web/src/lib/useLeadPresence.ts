// Multi-operator presence indicator for the LeadDetailPage.
//
// Uses Supabase Realtime's built-in presence channel (NOT Postgres
// listeners) — every subscriber broadcasts a small payload, every other
// subscriber to the same channel name receives `sync` events with the
// merged set. No DB table needed for the happy path.
//
// Closes the audit's "stale-data race on shared conversations" gotcha:
// without this, two operators clicking claim/reply on the same lead each
// think they own it until the next 30s poll surfaces the conflict.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface PresenceUser {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  joinedAt: string;
}

/**
 * Subscribe to a lead-scoped presence channel. Returns the OTHER
 * operators currently viewing this lead (excludes the caller). When the
 * realtime channel can't connect (network down, table not in publication),
 * returns an empty list — the rest of the page keeps polling.
 */
export function useLeadPresence(
  leadId: string,
  me: { userId: string; email: string | null; fullName: string | null; role: string | null } | null,
): PresenceUser[] {
  const [others, setOthers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!leadId || !me) {
      setOthers([]);
      return;
    }
    const channel = supabase.channel(`presence:lead:${leadId}`, {
      config: {
        presence: { key: me.userId },
      },
    });
    const myKey = me.userId;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>;
      const merged: PresenceUser[] = [];
      for (const [key, presences] of Object.entries(state)) {
        if (key === myKey) continue;
        const first = presences[0];
        if (!first) continue;
        merged.push({
          userId: key,
          email: (first.email as string | null) ?? null,
          fullName: (first.fullName as string | null) ?? null,
          role: (first.role as string | null) ?? null,
          joinedAt: (first.joinedAt as string | null) ?? new Date().toISOString(),
        });
      }
      setOthers(merged);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          email: me.email,
          fullName: me.fullName,
          role: me.role,
          joinedAt: new Date().toISOString(),
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Presence is best-effort; the page still works without it.
        console.warn(`[presence] lead:${leadId}: ${status}`);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, me?.userId, me?.email, me?.fullName, me?.role]);

  return others;
}
