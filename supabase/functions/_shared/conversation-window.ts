// WhatsApp 24-hour customer service window. While the lead has sent us a
// message in the last `windowHours`, freeform replies are allowed; otherwise
// the provider only accepts pre-approved templates.

export type SendMode = 'freeform' | 'template' | 'manual_only' | 'no_send';

export function isFreeformAllowed(lastInboundAt: string | null | undefined, windowHours = 24, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const ts = Date.parse(lastInboundAt);
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts <= windowHours * 60 * 60 * 1000;
}

export function resolveSendMode(
  desired: SendMode,
  lastInboundAt: string | null | undefined,
  windowHours = 24,
  now = new Date(),
): SendMode {
  if (desired === 'no_send' || desired === 'manual_only') return desired;
  if (desired === 'template') return 'template';
  return isFreeformAllowed(lastInboundAt, windowHours, now) ? 'freeform' : 'template';
}
