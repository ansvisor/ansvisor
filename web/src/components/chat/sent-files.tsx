'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CHAT_UPLOAD_TYPES, isImageUpload, sentImageSrc, type SentFile } from '@/lib/chat/uploads';

/**
 * The files a question was sent with, above its words (00409): an image as a
 * thumbnail that opens it whole in a new tab, any other file as a chip with
 * its type and name. An image that can't be read any more (kept 90 days)
 * shows as a chip.
 */
export function SentFiles({ files }: { files: readonly SentFile[] }) {
  const t = useTranslations('chatPage.sentFiles');
  return (
    <ul
      aria-label={t('label')}
      data-slot="sent-files"
      className="m-0 flex max-w-[80%] list-none flex-wrap justify-end gap-2 p-0"
    >
      {files.map((file) => (
        <SentFileItem key={file.id} file={file} />
      ))}
    </ul>
  );
}

function SentFileItem({ file }: { file: SentFile }) {
  const t = useTranslations('chatPage.sentFiles');
  const [broken, setBroken] = useState(false);
  if (isImageUpload(file.mimeType) && !broken) {
    const src = sentImageSrc(file.id);
    return (
      <li data-kind="image">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          title={file.name}
          aria-label={t('open', { name: file.name })}
          className="block overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file, read through its route */}
          <img
            src={src}
            alt={file.name}
            loading="lazy"
            onError={() => setBroken(true)}
            className="block h-28 w-auto max-w-[220px] object-cover"
          />
        </a>
      </li>
    );
  }
  return (
    <li
      data-kind="file"
      title={file.name}
      className="inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs text-foreground/80"
    >
      <b className="shrink-0 text-[10px] font-semibold text-muted-foreground">
        {CHAT_UPLOAD_TYPES[file.mimeType]?.tag ?? ''}
      </b>
      <span className="truncate">{file.name}</span>
    </li>
  );
}
