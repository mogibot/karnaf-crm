// Instagram DM outbound adapter. Counterpart to whatsapp-provider.ts —
// same shape, different endpoint. Used by send-reply when the conversation
// channel is `instagram`. Until this existed, the orchestrator only
// supported WhatsApp outbound; IG inbounds got queued as human_handoff
// with no in-app reply path (Mia had to alt-tab to the Instagram app).
//
// Meta Graph endpoint:
//   POST https://graph.facebook.com/v23.0/me/messages
//   ?access_token=<IG_PAGE_ACCESS_TOKEN>
//   { "recipient": { "id": "<ig_user_psid>" }, "message": { "text": "..." } }
//
// Identity:
//   The `recipient.id` is the IG-scoped sender id (PSID) that the IG
//   webhook surfaced on inbound, NOT the lead's phone. We look it up
//   via `leads.external_id` where `leads.external_source = 'instagram'`.

import { env } from './env.ts';
import { log } from './logger.ts';
import type { OutboundSendResult } from './provider-types.ts';

const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 400;

export function instagramConfigured(): boolean {
  return !!(env.facebookPageAccessToken() && env.metaGraphVersion());
}

async function withRetry<T>(label: string, fn: () => Promise<T>, retries = DEFAULT_RETRIES): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const jitter = Math.floor(Math.random() * 100);
      const delay = DEFAULT_BACKOFF_MS * Math.pow(2, attempt) + jitter;
      log.warn('instagram_retry', { fn: label, attempt, delay, err: String(err) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Send an Instagram DM by IG-scoped sender id (PSID).
 * The caller is responsible for resolving the PSID — usually
 * leads.external_id where external_source = 'instagram'.
 */
export async function sendInstagramText(recipientId: string, text: string): Promise<OutboundSendResult> {
  if (!instagramConfigured()) {
    return { ok: false, error: 'Instagram adapter not configured (FACEBOOK_PAGE_ACCESS_TOKEN missing)' };
  }
  return withRetry('ig_text', async () => {
    const url = `https://graph.facebook.com/${env.metaGraphVersion()}/me/messages?access_token=${encodeURIComponent(env.facebookPageAccessToken())}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        // 'RESPONSE' tag works inside Meta's 24h messaging window. Outside
        // the window Meta requires a HUMAN_AGENT tag; we keep the simple
        // shape here and surface non-2xx upstream so send-reply can queue
        // a human_handoff if Meta rejects.
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status >= 500) throw new Error(`ig_5xx:${res.status}:${errText.slice(0, 120)}`);
      return { ok: false, error: errText };
    }
    const json = await res.json();
    // Graph returns { recipient_id, message_id }.
    return { ok: true, providerMessageId: json.message_id as string | undefined };
  });
}
