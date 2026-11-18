import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { getReportFor } from '@/lib/mcp/data';
import { fileChatOutput } from './file-output';
import { PPTX_MIME } from './files';
import { presentationSlides, type PresentationReport } from './presentation';
import { renderPresentationPptx } from './presentation-pptx';
import type { ChatToolContext } from './registry/define-tool';

/**
 * A saved report as an editable .pptx deck (issue #2298), on the server:
 * the registry's make_presentation row calls this. The deck is built only
 * from the report's stored payload, filed in the workspace's Chat files
 * against its storage cap, and the tool answers with the filed file's id
 * so the engine shows the file card instead of filing anything itself.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.presentations' });

/** A request's refusal, in the person's words (the engine's typed failure). */
const refusal = (reason: string, message: string) => ({ ok: false as const, reason, message });

export interface PresentationRequestInput {
  report_id: string;
}

/** The saved report's deck, made and filed. */
export async function makeChatPresentation(ctx: ChatToolContext, input: PresentationRequestInput) {
  const organizationId = ctx.organizationId;
  if (!organizationId) return refusal('unavailable', t('unavailable'));

  const report = await getReportFor(ctx, input.report_id);
  if (!report) return refusal('not_found', t('notFound'));

  // The stored payload is immutable (lib/actions/reports); older reports
  // simply lack the fields shipped after them, and the mapping skips them.
  const slides = presentationSlides(report as unknown as PresentationReport);
  const body = await renderPresentationPptx(slides);

  const title = t('title', { title: report.title });
  const filed = await fileChatOutput({
    organizationId,
    createdBy: ctx.userId,
    brandId: report.brand_id,
    title,
    type: 'report',
    formats: ['pptx'],
    body: new Uint8Array(body),
    mimeType: PPTX_MIME,
    fileName: `report-presentation-${report.id}.pptx`,
    origin: 'chat',
    conversationId: ctx.chat?.conversationId ?? null,
    messageId: null,
    runId: ctx.chat?.runId ?? null,
    generatedAt: new Date().toISOString(),
    dataAsOf: report.created_at,
    timezone: ctx.timezone ?? null,
  });
  if (!filed.ok) {
    return refusal(
      filed.failure === 'storage_full' ? 'quota_exceeded' : 'unavailable',
      filed.failure === 'storage_full' ? t('storageFull') : t('notFiled'),
    );
  }
  return {
    ok: true as const,
    file_id: filed.id,
    title,
    report_id: report.id,
    slides: slides.length,
  };
}
