import { describe, expect, it } from 'vitest';
import { checkRecords, readRecordFile } from '../../src/domain/import';

const encode = (text: string) => new TextEncoder().encode(text);
describe('complete record intake', () => {
  it('preserves exact multiline Unicode source text and separate record types', () => {
    const docs = [
      { label: 'Agreement', kind: 'agreement', text: '  £1,000\r\nApproved? 😀\n' },
      { label: 'Reply', kind: 'message', text: 'Not yet.\n' },
    ];
    expect(readRecordFile('records.json', encode(JSON.stringify(docs)))).toEqual(docs);
    expect(readRecordFile('reply.txt', encode(docs[0].text))[0].text).toBe(docs[0].text);
  });
  it('rejects invalid UTF-8 rather than inserting replacement characters', () => {
    expect(() => readRecordFile('reply.txt', new Uint8Array([0xc3, 0x28]))).toThrow('UTF-8');
  });
  it('rejects unknown fields, malformed JSON and unsupported formats without partial results', () => {
    expect(() => readRecordFile('records.json', encode('[{}'))).toThrow('JSON');
    expect(() =>
      readRecordFile(
        'records.json',
        encode(
          JSON.stringify([
            { label: 'Good', kind: 'message', text: 'Complete' },
            { label: 'Bad', kind: 'note', text: 'Complete', execute: true },
          ]),
        ),
      ),
    ).toThrow('Record 2');
    expect(() => readRecordFile('page.html', encode('<p>hello</p>'))).toThrow('.txt or .json');
  });
  it('rejects whitespace-only records and overlong content without truncation', () => {
    for (const text of [' \n\t', 'a'.repeat(16001)]) {
      expect(() => checkRecords([{ label: 'Reply', kind: 'message', text }])).toThrow('Record 1');
    }
  });
  it('checks UTF-8 bytes in addition to character count', () => {
    expect(() =>
      checkRecords([{ label: 'Reply', kind: 'message', text: '界'.repeat(11000) }]),
    ).toThrow('32,000');
    expect(() => readRecordFile('records.json', new Uint8Array(64001))).toThrow('64,000');
  });
  it('rejects a thirteenth record', () => {
    expect(() =>
      checkRecords(
        Array.from({ length: 13 }, () => ({ label: 'Reply', kind: 'message', text: 'Yes' })),
      ),
    ).toThrow('1–12');
  });
});
