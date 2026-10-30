import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, uploadProblem, uploadTypeOf } from './uploads';

/** What a message may carry (CHAT-02 items 19–21, 00409). */

describe('uploadTypeOf', () => {
  it('takes a listed type, or the extension when the browser gives none', () => {
    expect(uploadTypeOf({ name: 'brief.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(uploadTypeOf({ name: 'notes.md', type: '' })).toBe('text/markdown');
    expect(uploadTypeOf({ name: 'Report.XLSX', type: 'application/octet-stream' })).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(uploadTypeOf({ name: 'setup.exe', type: 'application/x-msdownload' })).toBeNull();
    expect(uploadTypeOf({ name: 'setup.exe', type: '' })).toBeNull();
  });
});

describe('uploadProblem', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });
  it('refuses an unlisted type, over 10 MB, and a sixth file', () => {
    expect(uploadProblem(file('a.pdf', 'application/pdf', 1000), 0)).toBeNull();
    expect(uploadProblem(file('a.exe', '', 1000), 0)).toBe('type');
    expect(uploadProblem(file('a.pdf', 'application/pdf', 12 * 1024 * 1024), 0)).toBe('size');
    expect(uploadProblem(file('a.pdf', 'application/pdf', MAX_UPLOAD_BYTES), 0)).toBeNull();
    expect(uploadProblem(file('a.pdf', 'application/pdf', 1000), 5)).toBe('count');
  });
});
