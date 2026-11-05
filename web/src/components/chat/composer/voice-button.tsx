'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The browser's speech recognition, as Chrome, Edge and Safari name it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's speech recognition, or null where it has none (Firefox). */
export function speechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether the browser can listen doesn't change while the page is open. */
const noChange = () => () => {};

/** The errors that mean the person (or the browser) didn't allow the microphone. */
const DENIED = new Set(['not-allowed', 'service-not-allowed']);

/**
 * The composer's microphone (CHAT-16, W4-04; Wave 4 decision 5 A): the
 * browser's own speech recognition turns what is said into text, in the
 * browser's language. While it listens, "Listening…" and a red dot show; a
 * second click, or a pause, stops it. The words go into the box and are
 * never sent by themselves. Ansvisor keeps no audio, and nothing is drawn
 * from the AI limit; the browser's own service hears it (Chrome's and
 * Edge's send the audio to Google or Microsoft). Hidden where the browser
 * has no speech recognition.
 */
export function VoiceButton({
  onText,
  onDeniedChange,
  disabled = false,
}: {
  /** The words heard, to add to the box. */
  onText: (text: string) => void;
  /** The microphone wasn't allowed (true), or a new try starts (false): the composer says so under the box. */
  onDeniedChange?: (denied: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('chatComposer.voice');
  // Read in the browser only: the server renders no button.
  const supported = useSyncExternalStore(
    noChange,
    () => speechRecognition() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Stops listening when the composer goes.
  useEffect(() => () => recognition.current?.abort(), []);

  if (!supported) return null;

  function start() {
    const Recognition = speechRecognition();
    if (!Recognition) return;
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    // A pause ends it: one go, then the words are in the box.
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let heard = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) heard += result[0].transcript;
      }
      const text = heard.trim();
      if (text) onText(text);
    };
    rec.onerror = (event) => {
      if (DENIED.has(event.error)) onDeniedChange?.(true);
    };
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = rec;
    onDeniedChange?.(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      // Already listening in another tab or not allowed here: nothing starts.
      recognition.current = null;
    }
  }

  return (
    <button
      type="button"
      data-action="composer.voice"
      aria-label={listening ? t('stop') : t('start')}
      title={listening ? t('stop') : t('start')}
      aria-pressed={listening}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (listening ? recognition.current?.stop() : start())}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
        listening && 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      )}
    >
      {listening ? (
        <>
          <i aria-hidden className="block size-2 animate-pulse rounded-full bg-red-600" />
          <span className="text-xs">{t('listening')}</span>
        </>
      ) : (
        <Mic className="size-4" aria-hidden />
      )}
    </button>
  );
}
