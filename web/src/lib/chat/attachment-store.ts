import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PDF_PAGES,
  attachmentKind,
  fitTexts,
  pdfPages,
  readsKind,
  type ModelReads,
  type RunAttachment,
} from './attachments';
import { wordText, workbookText } from './office-text';
import { guardData } from './untrusted';
import { CHAT_UPLOAD_BUCKET, isUploadType, type ChatUploadType } from './uploads';

/**
 * The files a chat's messages were sent with (00409), read for a run: the
 * rows, then the question's files from the private bucket with the service
 * role, as the upload's own check reads them (chat-uploads.ts). What reaches
 * the model of each is attachments.ts'. Server only.
 */

/** A sent attachment, as a run reads it. */
export interface SentUpload {
  id: string;
  messageId: string;
  name: string;
  mimeType: ChatUploadType;
  sizeBytes: number;
  storagePath: string;
}

/**
 * The chat's sent attachments by message, in the order they were attached:
 * ready ones of the run's workspace only. Throws when they can't be read.
 */
export async function readSentUploads(
  conversationId: string,
  organizationId: string,
): Promise<Map<string, SentUpload[]>> {
  const { data, error } = await supabaseAdmin
    .from('chat_uploads')
    .select('id, message_id, name, mime_type, size_bytes, storage_path, created_at')
    .eq('conversation_id', conversationId)
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Chat could not read the attachments: ${error.message}`);
  const byMessage = new Map<string, SentUpload[]>();
  for (const row of (data ?? []) as {
    id: string;
    message_id: string | null;
    name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
  }[]) {
    if (!row.message_id || !isUploadType(row.mime_type)) continue;
    byMessage.set(row.message_id, [
      ...(byMessage.get(row.message_id) ?? []),
      {
        id: row.id,
        messageId: row.message_id,
        name: row.name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        storagePath: row.storage_path,
      },
    ]);
  }
  return byMessage;
}

/** A file's bytes from the bucket; null when it can't be read. */
async function download(path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(CHAT_UPLOAD_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** A text file's words: UTF-8, or UTF-16 with its byte order mark (the upload's check lets both in). */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * A file's words for the model: a text type as it is; a Word file as
 * Markdown and an Excel workbook's first sheets as CSV (office-text.ts).
 */
export async function textOfFile(type: ChatUploadType, bytes: Uint8Array): Promise<string> {
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return wordText(bytes);
  }
  if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return workbookText(bytes);
  }
  return decodeText(bytes);
}

/**
 * The question's files as the run's models get them (attachments.ts), in
 * the order they were attached. A text file is read and its hidden text
 * stripped (untrusted.ts), and `injection` says whether one tried to
 * instruct an AI. An image or a PDF is read only when a model of the run
 * reads its kind, within MAX_IMAGE_BYTES, MAX_FILE_BYTES together and
 * MAX_PDF_PAGES; else, and when a file can't be read, it says why.
 */
export async function loadRunAttachments(
  uploads: readonly SentUpload[],
  reads: ModelReads,
): Promise<{ files: RunAttachment[]; injection: boolean }> {
  let injection = false;
  let sent = 0;
  const files: RunAttachment[] = [];
  for (const upload of uploads) {
    const file: RunAttachment = {
      name: upload.name,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
    };
    const kind = attachmentKind(upload.mimeType);
    if (!readsKind(reads, kind)) {
      files.push({ ...file, missing: 'model' });
      continue;
    }
    if (kind !== 'text') {
      const fits =
        (kind !== 'image' || upload.sizeBytes <= MAX_IMAGE_BYTES) &&
        sent + upload.sizeBytes <= MAX_FILE_BYTES;
      if (!fits) {
        files.push({ ...file, missing: 'too_large' });
        continue;
      }
    }
    const bytes = await download(upload.storagePath);
    if (!bytes) {
      files.push({ ...file, missing: 'unreadable' });
      continue;
    }
    if (kind === 'text') {
      try {
        const guarded = guardData(await textOfFile(upload.mimeType, bytes));
        injection ||= guarded.injection;
        files.push({ ...file, text: String(guarded.value) });
      } catch (error) {
        console.error('[chat/attachments] could not read a file as text:', error);
        files.push({ ...file, missing: 'unreadable' });
      }
      continue;
    }
    const pages = kind === 'pdf' ? pdfPages(bytes) : null;
    if (pages !== null && pages > MAX_PDF_PAGES) {
      files.push({ ...file, missing: 'too_many_pages' });
      continue;
    }
    sent += bytes.length;
    files.push({ ...file, data: bytes, ...(pages !== null ? { pages } : {}) });
  }
  return { files: fitTexts(files), injection };
}
