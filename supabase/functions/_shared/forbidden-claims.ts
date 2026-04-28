// Substring-based blocklist of phrases the AI must never produce. Loaded
// from crm_config.forbidden_claims and merged with the playbook's per-flow
// list before validation.

export function containsForbiddenClaim(reply: string, claims: string[]): string | null {
  if (!reply) return null;
  const lower = reply.toLowerCase();
  for (const c of claims) {
    if (!c) continue;
    if (lower.includes(c.toLowerCase())) return c;
  }
  return null;
}
