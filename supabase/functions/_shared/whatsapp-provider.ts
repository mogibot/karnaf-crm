import { toWhatsAppPhone } from './phone.ts';
import type { NormalizedInboundMessage, OutboundSendResult } from './provider-types.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || '';
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') || '';
const WATI_TOKEN = Deno.env.get('WATI_TOKEN') || '';
const WATI_API_URL = Deno.env.get('WATI_API_URL') || 'https://live-mt-server.wati.io';

export const activeProviderName = WHATSAPP_TOKEN && WHATSAPP_PHONE_ID ? 'meta_cloud_api' : WATI_TOKEN ? 'wati' : 'none';

export function normalizeProviderInbound(payload: Record<string, unknown>): NormalizedInboundMessage | null {
  const now = new Date().toISOString();

  const entry = (payload.entry as Array<Record<string, unknown>> | undefined)?.[0];
  const changes = (entry?.changes as Array<Record<string, unknown>> | undefined)?.[0];
  const value = changes?.value as Record<string, unknown> | undefined;
  const messages = value?.messages as Array<Record<string, unknown>> | undefined;

  if (messages?.[0]) {
    const msg = messages[0];
    const contacts = value?.contacts as Array<Record<string, unknown>> | undefined;
    const contact = contacts?.[0];
    const profile = contact?.profile as Record<string, unknown> | undefined;
    const textObj = msg.text as Record<string, unknown> | undefined;

    return {
      provider: 'meta_cloud_api',
      providerMessageId: typeof msg.id === 'string' ? msg.id : null,
      phone: String(msg.from || ''),
      senderName: typeof profile?.name === 'string' ? profile.name : null,
      text: typeof textObj?.body === 'string' ? textObj.body : null,
      messageType: typeof msg.type === 'string' ? (msg.type === 'text' ? 'text' : 'media') : 'unknown',
      mediaType: typeof msg.type === 'string' ? msg.type : null,
      rawPayload: payload,
      receivedAt: now,
    };
  }

  if (typeof payload.waId === 'string' || typeof payload.senderPhone === 'string' || typeof payload.phone === 'string' || typeof payload.from === 'string') {
    return {
      provider: 'wati',
      providerMessageId: typeof payload.id === 'string' ? payload.id : null,
      phone: String(payload.waId || payload.senderPhone || payload.phone || payload.from || ''),
      senderName: typeof payload.senderName === 'string'
        ? payload.senderName
        : typeof payload.pushName === 'string'
          ? payload.pushName
          : typeof payload.name === 'string'
            ? payload.name
            : null,
      text: typeof payload.text === 'string'
        ? payload.text
        : typeof (payload.message as Record<string, unknown> | undefined)?.text === 'string'
          ? String((payload.message as Record<string, unknown>).text)
          : null,
      messageType: typeof payload.text === 'string' ? 'text' : 'unknown',
      rawPayload: payload,
      receivedAt: now,
    };
  }

  return null;
}

export async function sendWhatsAppText(phone: string, text: string): Promise<OutboundSendResult> {
  if (activeProviderName === 'meta_cloud_api') {
    return sendMetaText(phone, text);
  }
  if (activeProviderName === 'wati') {
    return sendWatiText(phone, text);
  }
  return { ok: false, error: 'No WhatsApp provider configured' };
}

async function sendMetaText(phone: string, text: string): Promise<OutboundSendResult> {
  const to = toWhatsAppPhone(phone);
  const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    return { ok: false, error: await res.text() };
  }

  const json = await res.json();
  const messageId = json.messages?.[0]?.id as string | undefined;
  return { ok: true, providerMessageId: messageId };
}

async function sendWatiText(phone: string, text: string): Promise<OutboundSendResult> {
  const to = toWhatsAppPhone(phone);
  const res = await fetch(`${WATI_API_URL}/api/v1/sendSessionMessage/${to}?messageText=${encodeURIComponent(text)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WATI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    return { ok: false, error: await res.text() };
  }

  return { ok: true };
}
