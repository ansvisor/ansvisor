// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { chooseLocale } from './resolve-locale';
import { formatUiLocaleCookie, parseUiLocaleCookie } from './ui-locale-cookie';
// These tests cover a customer meeting a language that isn't offered yet, so the
// customer list is pinned to English here (in the app every language is offered).
vi.mock('@/i18n/locales', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/locales')>()),
  TRANSLATED_LOCALES: ['en'],
}));

const staff = () => Promise.resolve(true);
const nobody = () => Promise.resolve(false);

describe('the interface language of a request', () => {
  it('is English with no pick and no browser language we have', async () => {
    expect(await chooseLocale({ picked: null, acceptLanguage: null, canPreview: nobody })).toBe(
      'en',
    );
    expect(await chooseLocale({ picked: null, acceptLanguage: 'de,fr', canPreview: nobody })).toBe(
      'en',
    );
  });

  it('follows the pick when its messages file exists', async () => {
    expect(await chooseLocale({ picked: 'en', acceptLanguage: 'de', canPreview: nobody })).toBe(
      'en',
    );
  });

  it('gives a customer English for a language with no file, and never asks staff for it', async () => {
    const canPreview = vi.fn(nobody);
    expect(await chooseLocale({ picked: 'de', acceptLanguage: null, canPreview })).toBe('en');
    expect(await chooseLocale({ picked: 'en-XA', acceptLanguage: null, canPreview })).toBe('en');
    // Asked for these two only.
    expect(canPreview).toHaveBeenCalledTimes(2);
  });

  it('gives staff and previews the language with no file, and the test language', async () => {
    expect(await chooseLocale({ picked: 'de', acceptLanguage: null, canPreview: staff })).toBe(
      'de',
    );
    expect(await chooseLocale({ picked: 'en-XA', acceptLanguage: null, canPreview: staff })).toBe(
      'en-XA',
    );
  });

  it('does not ask whether to preview for a language it has', async () => {
    const canPreview = vi.fn(staff);
    await chooseLocale({ picked: 'en', acceptLanguage: null, canPreview });
    await chooseLocale({ picked: null, acceptLanguage: 'tr', canPreview });
    expect(canPreview).not.toHaveBeenCalled();
  });

  it('falls back to English when the staff check fails', async () => {
    const broken = () => Promise.reject(new Error('down'));
    expect(await chooseLocale({ picked: 'en-XA', acceptLanguage: null, canPreview: broken })).toBe(
      'en',
    );
  });
});

describe('the language cookie', () => {
  it('holds the pick and whose it is', () => {
    expect(formatUiLocaleCookie('pt-BR', 'u1')).toBe('pt-BR:u1');
    expect(formatUiLocaleCookie(null, 'u1')).toBe('auto:u1');
    expect(parseUiLocaleCookie('pt-BR:u1')).toEqual({ locale: 'pt-BR', userId: 'u1' });
    expect(parseUiLocaleCookie('auto:u1')).toEqual({ locale: null, userId: 'u1' });
    expect(parseUiLocaleCookie('en-xa')).toEqual({ locale: 'en-XA', userId: null });
  });

  it('is ignored when it is missing or not ours', () => {
    expect(parseUiLocaleCookie(undefined)).toBeNull();
    expect(parseUiLocaleCookie('')).toBeNull();
    expect(parseUiLocaleCookie('klingon:u1')).toBeNull();
  });
});
