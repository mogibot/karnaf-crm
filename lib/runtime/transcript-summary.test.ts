import { describe, expect, it } from 'vitest';
import {
  condense,
  firstSentence,
  synthesise,
  extractStructured,
  formatStructuredSummary,
} from './transcript-summary';

describe('firstSentence', () => {
  it('returns the original string when no sentence break is present', () => {
    expect(firstSentence('שלום עולם')).toBe('שלום עולם');
  });

  it('cuts at the first sentence terminator', () => {
    expect(firstSentence('שלום. נשמח לעזור.')).toBe('שלום.');
  });

  it('caps length to 180 chars', () => {
    const long = 'א'.repeat(400);
    expect(firstSentence(long).length).toBeLessThanOrEqual(180);
  });
});

describe('condense', () => {
  it('returns empty string for empty input', () => {
    expect(condense([])).toBe('');
  });

  it('keeps every fourth message and the final two', () => {
    const items = ['a.', 'b.', 'c.', 'd.', 'e.', 'f.', 'g.', 'h.'];
    const result = condense(items);
    // Picks index 0 ("a.") and 4 ("e."); plus tail two (g., h.).
    expect(result).toContain('a.');
    expect(result).toContain('e.');
    expect(result).toContain('g.');
    expect(result).toContain('h.');
    expect(result).not.toContain('d.');
  });

  it('deduplicates picks', () => {
    const items = ['x.', 'x.', 'x.'];
    expect(condense(items).split('|').length).toBeLessThanOrEqual(2);
  });
});

describe('synthesise', () => {
  const rows = [
    { sender_type: 'lead', direction: 'inbound', content_text: 'שלום, אני מתעניין', created_at: '2026-04-27T10:00Z' },
    { sender_type: 'ai', direction: 'outbound', content_text: 'בשמחה, על מה תרצה לדעת?', created_at: '2026-04-27T10:01Z' },
    { sender_type: 'mia', direction: 'outbound', content_text: 'מצטרפת לשיחה', created_at: '2026-04-27T10:02Z' },
    { sender_type: 'system', direction: 'internal', content_text: 'ownership=mia_active', created_at: '2026-04-27T10:03Z' },
  ];

  it('groups by sender bucket and labels each section', () => {
    const out = synthesise(rows);
    expect(out).toMatch(/^LEAD:/m);
    expect(out).toMatch(/^AI:/m);
    expect(out).toMatch(/^HUMAN:/m);
    // System messages are intentionally dropped from the output sections.
    expect(out).not.toContain('ownership=mia_active');
  });

  it('skips empty content', () => {
    const out = synthesise([
      { sender_type: 'lead', direction: 'inbound', content_text: '   ', created_at: '2026-04-27T10:00Z' },
      { sender_type: 'ai', direction: 'outbound', content_text: 'תשובה', created_at: '2026-04-27T10:01Z' },
    ]);
    expect(out).toContain('AI:');
    expect(out).not.toContain('LEAD:');
  });

  it('caps total output length', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({
      sender_type: 'lead', direction: 'inbound',
      content_text: 'שורה ארוכה '.repeat(20) + i,
      created_at: '2026-04-27T10:00Z',
    }));
    expect(synthesise(big, 200).length).toBeLessThanOrEqual(200);
  });

  it('handles all-empty input', () => {
    expect(synthesise([])).toBe('');
  });
});

describe('extractStructured', () => {
  it('detects price objection from lead message', () => {
    const out = extractStructured([
      { sender_type: 'lead', direction: 'inbound', content_text: 'המחיר נשמע יקר לי', created_at: null },
    ]);
    expect(out.objections.price.length).toBe(1);
    expect(out.objections.time.length).toBe(0);
  });

  it('detects partner-involved objection', () => {
    const out = extractStructured([
      { sender_type: 'lead', direction: 'inbound', content_text: 'אני צריך לדבר עם בן זוג שלי קודם', created_at: null },
    ]);
    expect(out.objections.partner.length).toBe(1);
  });

  it('detects commitment from AI message', () => {
    const out = extractStructured([
      { sender_type: 'ai', direction: 'outbound', content_text: 'אשלח לך עכשיו את המסמך', created_at: null },
    ]);
    expect(out.commitments.length).toBe(1);
  });

  it('separates lead/ai/human recent snippets', () => {
    const out = extractStructured([
      { sender_type: 'lead', direction: 'inbound', content_text: 'היי', created_at: null },
      { sender_type: 'ai', direction: 'outbound', content_text: 'שלום', created_at: null },
      { sender_type: 'mia', direction: 'outbound', content_text: 'בוקר טוב', created_at: null },
    ]);
    expect(out.recentLeadSnippets).toEqual(['היי']);
    expect(out.recentAiSnippets).toEqual(['שלום']);
    expect(out.recentHumanSnippets).toEqual(['בוקר טוב']);
  });

  it('detects pain points and goals together', () => {
    const out = extractStructured([
      { sender_type: 'lead', direction: 'inbound', content_text: 'אני רוצה לקנות דירה ראשונה', created_at: null },
      { sender_type: 'lead', direction: 'inbound', content_text: 'אבל קשה לי להבין מאיפה מתחילים', created_at: null },
    ]);
    expect(out.goals.length).toBeGreaterThanOrEqual(1);
    expect(out.painPoints.length).toBeGreaterThanOrEqual(1);
  });

  it('caps per-bucket entries', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      sender_type: 'lead' as const,
      direction: 'inbound' as const,
      content_text: `המחיר ${i} גבוה מדי`,
      created_at: null as string | null,
    }));
    const out = extractStructured(rows);
    expect(out.objections.price.length).toBeLessThanOrEqual(5);
  });
});

describe('formatStructuredSummary', () => {
  it('produces multi-line summary with category prefixes', () => {
    const text = formatStructuredSummary({
      painPoints: ['קשה לי'],
      goals: ['רוצה דירה'],
      objections: { price: ['יקר'], time: [], partner: [], deferred: [] },
      commitments: ['אשלח חומר'],
      recentLeadSnippets: ['היי'],
      recentAiSnippets: ['שלום'],
      recentHumanSnippets: [],
    });
    expect(text).toMatch(/GOALS:/);
    expect(text).toMatch(/PAIN_POINTS:/);
    expect(text).toMatch(/OBJECTIONS:.*price=/);
    expect(text).toMatch(/COMMITMENTS:/);
    expect(text).toMatch(/^LEAD: היי$/m);
    expect(text).toMatch(/^AI: שלום$/m);
  });

  it('emits empty string when nothing populated', () => {
    expect(
      formatStructuredSummary({
        painPoints: [],
        goals: [],
        objections: { price: [], time: [], partner: [], deferred: [] },
        commitments: [],
        recentLeadSnippets: [],
        recentAiSnippets: [],
        recentHumanSnippets: [],
      }),
    ).toBe('');
  });
});
