import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { refusalError } from '@/lib/server-error';
import { useCaughtErrorText, useServerErrorText } from './use-server-error';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** What the hook says for a body, rendered in the given language's messages. */
function say(body: unknown, fallback: string, status?: number, over: object = messages) {
  function Probe() {
    const text = useServerErrorText()(body, fallback, status);
    return <p>{text}</p>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={over}>
        <Probe />
      </NextIntlClientProvider>,
    ),
  );
  const out = host.textContent ?? '';
  act(() => root.unmount());
  return out;
}

describe('useServerErrorText (LOC-008)', () => {
  it('says a coded refusal from the UI’s own messages, never the server’s English', () => {
    expect(say({ code: 'invalid', error: 'Invalid request' }, 'fallback', 400)).toBe(
      "That didn't go through: something in it isn't valid. Check it and try again.",
    );
    expect(say({ error: 'plan_limit', message: 'Your plan…' }, 'fallback', 403)).toBe(
      "Your plan doesn't include this. Upgrade to use it.",
    );
  });

  it('says the translation when the language has one', () => {
    const german = {
      ...messages,
      serverErrors: { ...messages.serverErrors, invalid: 'Das war ungültig.' },
    };
    expect(say({ code: 'invalid' }, 'fallback', 400, german)).toBe('Das war ungültig.');
  });

  it('keeps the caller’s text for an answer it does not map', () => {
    expect(say({ error: 'Draft not found' }, 'Draft not found')).toBe('Draft not found');
  });
});

/** What useCaughtErrorText says for a caught error. */
function sayCaught(err: unknown, fallback: string) {
  function Probe() {
    return <p>{useCaughtErrorText()(err, fallback)}</p>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    ),
  );
  const out = host.textContent ?? '';
  act(() => root.unmount());
  return out;
}

describe('useCaughtErrorText (LOC-008)', () => {
  it('says a mapped refusal, kept on a thrown refusal or a server action’s digest', () => {
    expect(sayCaught(refusalError({ error: 'plan_limit' }, 'x', 429), 'fallback')).toBe(
      messages.apiFailure.limit,
    );
    expect(
      sayCaught(Object.assign(new Error('masked'), { digest: 'plan_limit' }), 'fallback'),
    ).toBe(messages.apiFailure.plan);
  });

  it('keeps a browser error’s own message, and the fallback for a masked one', () => {
    expect(sayCaught(new TypeError('Failed to fetch'), 'fallback')).toBe('Failed to fetch');
    expect(sayCaught(Object.assign(new Error('masked'), { digest: '42' }), 'fallback')).toBe(
      'fallback',
    );
  });
});
