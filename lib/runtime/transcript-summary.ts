// Pure summarisation helpers used by the runtime transcript-summary
// service. The Deno-side wrapper (`supabase/functions/_shared/transcript-summary.ts`)
// reads the messages from Postgres, hands them to these functions, and
// writes the result back. Keeping the pure logic here lets Vitest test
// the extraction without spinning up a DB.

const SUMMARY_MAX_CHARS = 1200;
const SNIPPET_MAX_CHARS = 80;
const PER_BUCKET_LIMIT = 5;

export interface SummariseRow {
  sender_type: string | null;
  direction: string | null;
  content_text: string | null;
  created_at: string | null;
}

export interface StructuredSummary {
  painPoints: string[];
  goals: string[];
  objections: { price: string[]; time: string[]; partner: string[]; deferred: string[] };
  commitments: string[];
  recentLeadSnippets: string[];
  recentAiSnippets: string[];
  recentHumanSnippets: string[];
}

const PAIN_KEYWORDS = ['קשה', 'מסובך', 'פחד', 'חשש', 'בעיה', 'מאתגר', 'מתלבט', 'תקוע', 'לא מצליח'];
const GOAL_KEYWORDS = ['רוצה', 'אשמח', 'המטרה', 'מטרה', 'להגיע', 'אני צריך', 'מחפש', 'חולם', 'מעוניין'];
const OBJ_PRICE = ['יקר', 'מחיר גבוה', 'מחיר', 'תקציב', 'אין לי כסף', 'גבוה מדי', 'הרבה כסף', 'עלות'];
const OBJ_TIME = ['אין לי זמן', 'זמן', 'עסוק', 'עכשיו לא', 'לחכות', 'בעתיד', 'בהמשך', 'תזמון'];
const OBJ_PARTNER = ['בן זוג', 'בת זוג', 'בעל', 'אישה', 'אשתי', 'בעלי', 'לבדוק עם', 'אדבר עם', 'משפחה'];
const OBJ_DEFERRED = ['לחשוב', 'אני אחזור', 'נדבר בהמשך', 'תן לי לחשוב', 'אבדוק', 'נראה', 'לא בטוח'];
const COMMITMENT_PATTERNS = [
  'אשלח לך',
  'אעדכן',
  'אחזור אליך',
  'נדבר',
  'אקפיץ',
  'אקבע',
  'נקבע',
  'אכין',
  'אשמור לך',
  'אזמין',
];

export function firstSentence(s: string): string {
  const m = s.match(/.{1,180}?(?:[.!?\n]|$)/);
  return (m ? m[0] : s).trim();
}

export function snippet(text: string, max = SNIPPET_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function containsAny(text: string, needles: string[]): string | null {
  const lower = text.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return null;
}

export function condense(items: string[]): string {
  const picks: string[] = [];
  for (let i = 0; i < items.length; i += 4) {
    const item = items[i];
    if (item) picks.push(firstSentence(item));
  }
  for (const tail of items.slice(-2)) picks.push(firstSentence(tail));
  return Array.from(new Set(picks)).join(' | ');
}

function dedupCap(arr: string[], cap: number): string[] {
  return Array.from(new Set(arr)).slice(0, cap);
}

export function extractStructured(rows: SummariseRow[]): StructuredSummary {
  const out: StructuredSummary = {
    painPoints: [],
    goals: [],
    objections: { price: [], time: [], partner: [], deferred: [] },
    commitments: [],
    recentLeadSnippets: [],
    recentAiSnippets: [],
    recentHumanSnippets: [],
  };

  for (const r of rows) {
    const text = (r.content_text ?? '').trim();
    if (!text) continue;
    const sender = r.sender_type ?? '';
    const isLead = sender === 'lead';
    const isAi = sender === 'ai';
    const isHuman = sender === 'mia' || sender === 'sales_rep' || sender === 'admin';
    const short = snippet(text);

    if (isLead) {
      out.recentLeadSnippets.push(short);
      if (containsAny(text, PAIN_KEYWORDS)) out.painPoints.push(short);
      if (containsAny(text, GOAL_KEYWORDS)) out.goals.push(short);
      if (containsAny(text, OBJ_PRICE)) out.objections.price.push(short);
      if (containsAny(text, OBJ_TIME)) out.objections.time.push(short);
      if (containsAny(text, OBJ_PARTNER)) out.objections.partner.push(short);
      if (containsAny(text, OBJ_DEFERRED)) out.objections.deferred.push(short);
    }
    if (isAi || isHuman) {
      if (isAi) out.recentAiSnippets.push(short);
      if (isHuman) out.recentHumanSnippets.push(short);
      if (containsAny(text, COMMITMENT_PATTERNS)) out.commitments.push(short);
    }
  }

  out.painPoints = dedupCap(out.painPoints, PER_BUCKET_LIMIT);
  out.goals = dedupCap(out.goals, PER_BUCKET_LIMIT);
  out.objections.price = dedupCap(out.objections.price, PER_BUCKET_LIMIT);
  out.objections.time = dedupCap(out.objections.time, PER_BUCKET_LIMIT);
  out.objections.partner = dedupCap(out.objections.partner, PER_BUCKET_LIMIT);
  out.objections.deferred = dedupCap(out.objections.deferred, PER_BUCKET_LIMIT);
  out.commitments = dedupCap(out.commitments, PER_BUCKET_LIMIT);
  out.recentLeadSnippets = out.recentLeadSnippets.slice(-3);
  out.recentAiSnippets = out.recentAiSnippets.slice(-3);
  out.recentHumanSnippets = out.recentHumanSnippets.slice(-3);
  return out;
}

export function formatStructuredSummary(s: StructuredSummary): string {
  const lines: string[] = [];
  if (s.goals.length) lines.push(`GOALS: ${s.goals.join(' | ')}`);
  if (s.painPoints.length) lines.push(`PAIN_POINTS: ${s.painPoints.join(' | ')}`);
  const objParts: string[] = [];
  if (s.objections.price.length) objParts.push(`price=${s.objections.price.join(',')}`);
  if (s.objections.time.length) objParts.push(`time=${s.objections.time.join(',')}`);
  if (s.objections.partner.length) objParts.push(`partner=${s.objections.partner.join(',')}`);
  if (s.objections.deferred.length) objParts.push(`deferred=${s.objections.deferred.join(',')}`);
  if (objParts.length) lines.push(`OBJECTIONS: ${objParts.join(' ; ')}`);
  if (s.commitments.length) lines.push(`COMMITMENTS: ${s.commitments.join(' | ')}`);
  if (s.recentLeadSnippets.length) lines.push(`LEAD: ${s.recentLeadSnippets.join(' | ')}`);
  if (s.recentAiSnippets.length) lines.push(`AI: ${s.recentAiSnippets.join(' | ')}`);
  if (s.recentHumanSnippets.length) lines.push(`HUMAN: ${s.recentHumanSnippets.join(' | ')}`);
  return lines.join('\n');
}

export function synthesise(rows: SummariseRow[], maxChars = SUMMARY_MAX_CHARS): string {
  const structured = extractStructured(rows);
  const structuredText = formatStructuredSummary(structured);
  if (structuredText) return structuredText.slice(0, maxChars);

  // Fallback: original sender-bucket condense when no signals matched.
  const buckets: Record<'lead' | 'ai' | 'human', string[]> = { lead: [], ai: [], human: [] };
  for (const r of rows) {
    const text = (r.content_text || '').trim();
    if (!text) continue;
    if (r.sender_type === 'lead') buckets.lead.push(text);
    else if (r.sender_type === 'ai') buckets.ai.push(text);
    else if (r.sender_type === 'mia' || r.sender_type === 'sales_rep' || r.sender_type === 'admin') buckets.human.push(text);
  }
  const sections: string[] = [];
  if (buckets.lead.length) sections.push('LEAD: ' + condense(buckets.lead));
  if (buckets.ai.length) sections.push('AI: ' + condense(buckets.ai));
  if (buckets.human.length) sections.push('HUMAN: ' + condense(buckets.human));
  return sections.join('\n').slice(0, maxChars);
}
