import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { useServerErrorText } from './use-server-error';

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
