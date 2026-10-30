/**
 * Chat's attachments (CHAT-02 items 18–22, 00409): what a message may carry.
 * The types and the size are the bucket's (chat-uploads) and the table's
 * checks; the browser, the server action and the database say the same.
 */

/** The bucket attachments go to: {organization_id}/{upload id}. */
export const CHAT_UPLOAD_BUCKET = 'chat-uploads';

/** 10 MB a file (owner decision, 2026-10-18). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 5 files a message (00409's trigger). */
export const MAX_UPLOADS = 5;

/** Each type an attachment may be, and its tag on the chip. */
export const CHAT_UPLOAD_TYPES = {
  'application/pdf': { tag: 'PDF', ext: ['pdf'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    tag: 'DOCX',
    ext: ['docx'],
  },
  'text/plain': { tag: 'TXT', ext: ['txt'] },
  'text/markdown': { tag: 'MD', ext: ['md', 'markdown'] },
  'text/csv': { tag: 'CSV', ext: ['csv'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    tag: 'XLSX',
    ext: ['xlsx'],
  },
  'application/json': { tag: 'JSON', ext: ['json'] },
  'text/html': { tag: 'HTML', ext: ['html', 'htm'] },
  'image/png': { tag: 'PNG', ext: ['png'] },
  'image/jpeg': { tag: 'JPG', ext: ['jpg', 'jpeg'] },
  'image/webp': { tag: 'WEBP', ext: ['webp'] },
} as const;
export type ChatUploadType = keyof typeof CHAT_UPLOAD_TYPES;

/** The file picker's accept list. */
export const UPLOAD_ACCEPT = Object.entries(CHAT_UPLOAD_TYPES)
  .flatMap(([type, { ext }]) => [type, ...ext.map((e) => `.${e}`)])
  .join(',');

export const isUploadType = (type: string): type is ChatUploadType =>
  Object.prototype.hasOwnProperty.call(CHAT_UPLOAD_TYPES, type);

/**
 * A file's type as attachments know it: the browser's, or from its name's
 * extension when the browser gives none (a .md file often has no type).
 * Null for a type an attachment can't be.
 */
export function uploadTypeOf(file: { name: string; type: string }): ChatUploadType | null {
  if (isUploadType(file.type)) return file.type;
  if (file.type && file.type !== 'application/octet-stream') return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const found = Object.entries(CHAT_UPLOAD_TYPES).find(([, t]) =>
    (t.ext as readonly string[]).includes(ext),
  );
  return found ? (found[0] as ChatUploadType) : null;
}

/** Why a file can't be attached (item 21), or null when it can. */
export type UploadProblem = 'type' | 'size' | 'count';

/**
 * The first problem with attaching `file` beside `attached` others: its
 * type, its size, or one too many.
 */
export function uploadProblem(
  file: { name: string; type: string; size: number },
  attached: number,
): UploadProblem | null {
  if (attached >= MAX_UPLOADS) return 'count';
  if (!uploadTypeOf(file)) return 'type';
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}
