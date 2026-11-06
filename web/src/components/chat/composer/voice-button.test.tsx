import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider } from '@/components/providers/role-provider';
import type { ChatMode } from '@/lib/chat/precedence';

/**
 * The composer's microphone (W4-04): the browser's speech recognition in
 * its language, "Listening…" with a red dot, the words in the box and never
 * sent, a line when the microphone isn't allowed, and no button where the
 * browser can't listen.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));

const { ChatComposer } = await import('./chat-composer');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** A fake of the browser's recognition: the test plays what it hears. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = true;
  interimResults = true;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
  hear(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

let container: HTMLDivElement;
let root: Root;
const onSend = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role="admin">
          <ChatComposer
            mode={'auto' as ChatMode}
            fullAutoOpen
            onSend={onSend}
            onModeChange={vi.fn()}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  // The button shows after the first render, once the browser is read.
  await act(async () => {});
}

const mic = () => container.querySelector<HTMLButtonElement>('[data-action="composer.voice"]');
const box = () => container.querySelector('textarea')!;

beforeEach(() => {
  onSend.mockReset();
  FakeRecognition.last = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('the microphone', () => {
  it('isn’t there where the browser can’t listen', async () => {
    await render();
    expect(mic()).toBeNull();
  });

  it('listens in the browser’s language, puts the words in the box and never sends them', async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('tr-TR');
    await render();
    expect(mic()?.getAttribute('aria-label')).toBe('Speak your message');

    await act(async () => mic()!.click());
    const rec = FakeRecognition.last!;
    expect(rec.start).toHaveBeenCalled();
    expect(rec.lang).toBe('tr-TR');
    expect(rec.continuous).toBe(false);
    expect(mic()?.textContent).toContain('Listening…');
    expect(mic()?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => rec.hear('Why did citations drop'));
    await act(async () => rec.onend?.());
    expect(box().value).toBe('Why did citations drop');
    expect(mic()?.textContent).not.toContain('Listening…');
    expect(onSend).not.toHaveBeenCalled();

    // A second go adds to what is there.
    await act(async () => mic()!.click());
    await act(async () => FakeRecognition.last!.hear('last week?'));
    expect(box().value).toBe('Why did citations drop last week?');
  });

  it('sits on the right of the box’s row, right before Send', async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
    await render();
    const send = container.querySelector('[data-action="composer.send"]');
    expect(mic()!.nextElementSibling).toBe(send);
    expect(mic()!.parentElement!.getAttribute('data-slot')).toBe('composer-send-group');
    // ＋ / @ stay on the left, before it.
    expect(mic()!.parentElement!.previousElementSibling?.getAttribute('data-action')).toBe(
      'composer.openRef',
    );
  });

  it('stops on a second click', async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
    await render();
    await act(async () => mic()!.click());
    await act(async () => mic()!.click());
    expect(FakeRecognition.last!.stop).toHaveBeenCalled();
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('asks for the microphone when it isn’t allowed', async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
    await render();
    await act(async () => mic()!.click());
    await act(async () => {
      FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
      FakeRecognition.last!.onend?.();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Allow microphone access to use voice.',
    );
  });
});
