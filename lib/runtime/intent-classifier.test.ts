import { describe, expect, it } from 'vitest';
import { classifyInbound } from './intent-classifier';

describe('classifyInbound', () => {
  it('returns unclear neutral on empty', () => {
    expect(classifyInbound(null).intent).toBe('unclear');
    expect(classifyInbound('').sentiment).toBe('neutral');
    expect(classifyInbound('   ').confidence).toBe('low');
  });

  it('detects DNC request with high confidence', () => {
    const r = classifyInbound('תסיר אותי בבקשה מהרשימה');
    expect(r.intent).toBe('dnc_request');
    expect(r.confidence).toBe('high');
    expect(r.sentiment).toBe('frustrated');
  });

  it('detects escalation request for human agent', () => {
    const r = classifyInbound('אפשר לדבר עם בנאדם?');
    expect(r.intent).toBe('escalation_request');
  });

  it('detects buy signal', () => {
    const r = classifyInbound('אני רוצה להירשם, איך משלמים?');
    expect(r.intent).toBe('buy_signal');
  });

  it('detects price objection', () => {
    const r = classifyInbound('זה נשמע מאוד יקר לי');
    expect(r.intent).toBe('objection');
  });

  it('detects question by ? mark', () => {
    const r = classifyInbound('כמה זמן זה לוקח?');
    expect(r.intent).toBe('question');
  });

  it('detects question by Hebrew interrogative leader', () => {
    const r = classifyInbound('מה כולל התוכן בפועל');
    expect(r.intent).toBe('question');
  });

  it('detects chit chat for short greeting', () => {
    const r = classifyInbound('שלום');
    expect(r.intent).toBe('chit_chat');
  });

  it('positive sentiment with question intent', () => {
    const r = classifyInbound('תודה רבה! איך מתחילים?');
    expect(r.sentiment).toBe('positive');
    expect(['buy_signal', 'question']).toContain(r.intent);
  });

  it('frustrated sentiment with unclear text', () => {
    const r = classifyInbound('נמאס לי מההודעות האלה');
    expect(r.sentiment).toBe('frustrated');
  });

  it('confused sentiment', () => {
    const r = classifyInbound('לא הבנתי מה ההצעה');
    expect(r.sentiment).toBe('confused');
  });

  it('DNC outranks other signals', () => {
    const r = classifyInbound('יקר לי, תסירו אותי מהרשימה');
    expect(r.intent).toBe('dnc_request');
  });

  it('returns matched keywords for traceability', () => {
    const r = classifyInbound('תסיר אותי');
    expect(r.matchedKeywords.some((k) => k.startsWith('dnc:'))).toBe(true);
  });

  it('English remove me also matches dnc', () => {
    const r = classifyInbound('please remove me from list');
    expect(r.intent).toBe('dnc_request');
  });
});
