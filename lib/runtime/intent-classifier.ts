// Cheap pre-model classifier that tags an inbound lead message with a
// sentiment + intent label. Pure heuristic (Hebrew + English keyword
// matching) so it runs without an extra LLM call and stays
// deterministic in tests. The orchestrator passes the result into the
// AI prompt + playbook selector so the model knows what kind of turn
// it is responding to.
//
// Mirrored by supabase/functions/_shared/intent-classifier.ts.

export type InferredSentiment = 'positive' | 'neutral' | 'frustrated' | 'confused';
export type InferredIntent =
  | 'question'
  | 'objection'
  | 'buy_signal'
  | 'escalation_request'
  | 'chit_chat'
  | 'dnc_request'
  | 'unclear';

export interface IntentSignal {
  sentiment: InferredSentiment;
  intent: InferredIntent;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
}

const POSITIVE_HINTS = ['תודה', 'מצוין', 'אהבתי', 'וואו', 'מעניין', 'אשמח', 'נשמע מעולה', 'כיף', 'מגניב'];
const FRUSTRATED_HINTS = ['כועס', 'לא טוב', 'אכזב', 'מתסכל', 'די כבר', 'די לא', 'מספיק', 'נמאס', 'מעצבן', 'גרוע'];
const CONFUSED_HINTS = ['לא הבנתי', 'לא ברור', 'מה זאת אומרת', 'מבולבל', 'לא קולט'];

const DNC_HINTS = [
  'תסיר אותי', 'תסירו אותי', 'להסיר', 'תוריד אותי', 'תורידו אותי', 'להוריד אותי',
  'אל תפנו', 'אל תפנה', 'אל תכתבו', 'אל תשלח', 'do not contact', 'remove me', 'unsubscribe',
];
const ESCALATION_HINTS = [
  'לדבר עם בנאדם', 'לדבר עם אדם', 'יועץ', 'מנהל', 'נציג אנושי', 'אנושי',
  'להתקשר', 'תתקשרו', 'תתקשר אלי', 'שיחת טלפון', 'בטלפון', 'phone call',
];
const BUY_SIGNAL_HINTS = [
  'רוצה לקנות', 'רוצה לרכוש', 'רוצה להירשם', 'רוצה להתחיל', 'מוכן/ה', 'מוכן להמשיך',
  'איך משלמים', 'איפה משלמים', 'תשלום', 'לרכוש', 'להירשם', 'איפה לחתום', 'איפה נרשמים',
  'איך נרשמים', 'איך מתחילים',
];
const OBJECTION_HINTS = [
  'יקר', 'מחיר גבוה', 'תקציב', 'אין לי כסף', 'אין לי זמן', 'עסוק',
  'צריך לחשוב', 'אבדוק', 'אחזור אליך', 'נדבר בהמשך', 'בן זוג', 'בת זוג',
  'לבדוק עם', 'לא בטוח', 'אבל',
];
const CHIT_CHAT_HINTS = ['שלום', 'היי', 'הי', 'מה נשמע', 'מה קורה', 'בוקר טוב', 'ערב טוב', 'לילה טוב'];

const QUESTION_LEAD_WORDS = ['האם', 'כמה', 'מתי', 'איפה', 'למה', 'מה', 'איך', 'מי', 'איזה', 'איזו'];

export function classifyInbound(text: string | null | undefined): IntentSignal {
  const raw = (text ?? '').trim();
  if (!raw) {
    return { sentiment: 'neutral', intent: 'unclear', matchedKeywords: [], confidence: 'low' };
  }
  const lower = raw.toLowerCase();
  const matched: string[] = [];

  const dncHit = firstMatch(lower, DNC_HINTS);
  if (dncHit) {
    matched.push(`dnc:${dncHit}`);
    return { sentiment: 'frustrated', intent: 'dnc_request', matchedKeywords: matched, confidence: 'high' };
  }

  const escalationHit = firstMatch(lower, ESCALATION_HINTS);
  if (escalationHit) matched.push(`escalation:${escalationHit}`);
  const buyHit = firstMatch(lower, BUY_SIGNAL_HINTS);
  if (buyHit) matched.push(`buy:${buyHit}`);
  const objectionHit = firstMatch(lower, OBJECTION_HINTS);
  if (objectionHit) matched.push(`objection:${objectionHit}`);
  const positiveHit = firstMatch(lower, POSITIVE_HINTS);
  if (positiveHit) matched.push(`positive:${positiveHit}`);
  const frustratedHit = firstMatch(lower, FRUSTRATED_HINTS);
  if (frustratedHit) matched.push(`frustrated:${frustratedHit}`);
  const confusedHit = firstMatch(lower, CONFUSED_HINTS);
  if (confusedHit) matched.push(`confused:${confusedHit}`);

  const isQuestion = looksLikeQuestion(raw);
  if (isQuestion) matched.push('question:syntax');

  let intent: InferredIntent;
  let confidence: IntentSignal['confidence'] = 'medium';
  if (escalationHit) intent = 'escalation_request';
  else if (buyHit) intent = 'buy_signal';
  else if (objectionHit) intent = 'objection';
  else if (isQuestion) intent = 'question';
  else if (firstMatch(lower, CHIT_CHAT_HINTS) && raw.length < 30) {
    intent = 'chit_chat';
    confidence = 'low';
  } else {
    intent = 'unclear';
    confidence = 'low';
  }

  let sentiment: InferredSentiment = 'neutral';
  if (frustratedHit) sentiment = 'frustrated';
  else if (confusedHit) sentiment = 'confused';
  else if (positiveHit) sentiment = 'positive';

  if (matched.length >= 2 && intent !== 'unclear') confidence = 'high';

  return { sentiment, intent, matchedKeywords: matched, confidence };
}

function firstMatch(lower: string, needles: string[]): string | null {
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return null;
}

function looksLikeQuestion(text: string): boolean {
  if (text.includes('?')) return true;
  const firstToken = text.trim().split(/\s+/u)[0]?.toLowerCase();
  return !!firstToken && QUESTION_LEAD_WORDS.includes(firstToken);
}
