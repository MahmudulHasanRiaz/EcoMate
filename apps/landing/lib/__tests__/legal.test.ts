import { describe, expect, it } from 'vitest';
import {
  formatLegalUpdatedAt,
  parseLegalBody,
  parseLegalInline,
} from '../legal';

describe('parseLegalInline', () => {
  it('splits **bold** spans out of a line', () => {
    expect(parseLegalInline('plain **bold** plain')).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' plain' },
    ]);
  });

  it('keeps a line with no bold as one text segment', () => {
    expect(parseLegalInline('No bold here.')).toEqual([
      { type: 'text', text: 'No bold here.' },
    ]);
  });

  it('handles a bold lead-in (the privacy §1 list style)', () => {
    expect(
      parseLegalInline('**Account data:** store name and phone.'),
    ).toEqual([
      { type: 'bold', text: 'Account data:' },
      { type: 'text', text: ' store name and phone.' },
    ]);
  });

  it('leaves unmatched asterisks as text', () => {
    expect(parseLegalInline('a **broken span')).toEqual([
      { type: 'text', text: 'a **broken span' },
    ]);
  });
});

describe('parseLegalBody', () => {
  it('parses paragraphs separated by blank lines', () => {
    const blocks = parseLegalBody('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      segments: [{ type: 'text', text: 'First paragraph.' }],
    });
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      segments: [{ type: 'text', text: 'Second paragraph.' }],
    });
  });

  it('joins wrapped lines inside one paragraph with spaces', () => {
    const blocks = parseLegalBody('Line one\nline two\nline three.');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        segments: [{ type: 'text', text: 'Line one line two line three.' }],
      },
    ]);
  });

  it('groups consecutive "- " lines into one list', () => {
    const blocks = parseLegalBody(
      'Intro:\n\n- **One:** first item\n- Second item\n\nTrailing paragraph.',
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1]).toEqual({
      type: 'list',
      items: [
        [
          { type: 'bold', text: 'One:' },
          { type: 'text', text: ' first item' },
        ],
        [{ type: 'text', text: 'Second item' }],
      ],
    });
    expect(blocks[2].type).toBe('paragraph');
  });

  it('returns no blocks for an empty or whitespace-only body', () => {
    expect(parseLegalBody('')).toEqual([]);
    expect(parseLegalBody('   \n\n  ')).toEqual([]);
  });

  it('parses the seeded privacy §1 body exactly', () => {
    const body =
      'We collect only what the service needs to run:\n\n' +
      '- **Account data:** store name, store address (subdomain), owner email and phone, and a hashed password. Passwords are never stored in plain text.\n' +
      '- **Workspace data:** the products, orders, customers, media, and settings you create inside your workspace.';
    const blocks = parseLegalBody(body);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('list');
    if (blocks[1].type === 'list') {
      expect(blocks[1].items).toHaveLength(2);
      expect(blocks[1].items[0][0]).toEqual({
        type: 'bold',
        text: 'Account data:',
      });
    }
  });
});

describe('formatLegalUpdatedAt', () => {
  it('formats an ISO timestamp as "19 November 2026"', () => {
    expect(formatLegalUpdatedAt('2026-11-19T09:30:00.000Z')).toBe(
      '19 November 2026',
    );
  });

  it('returns null for null or unparseable input', () => {
    expect(formatLegalUpdatedAt(null)).toBeNull();
    expect(formatLegalUpdatedAt('not-a-date')).toBeNull();
    expect(formatLegalUpdatedAt('')).toBeNull();
  });
});
