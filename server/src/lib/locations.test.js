import { describe, it, expect } from 'vitest';
import { parseLocation, locationsForScraper, userLocationFor } from './locations.js';

describe('parseLocation', () => {
  it('splits a US state code into country and state', () => {
    expect(parseLocation('US-CA')).toEqual({ country: 'US', state: 'CA' });
  });

  it('reads a bare country as country-only', () => {
    expect(parseLocation('DE')).toEqual({ country: 'DE', state: null });
  });

  it('normalizes case and surrounding space', () => {
    expect(parseLocation(' us-ca ')).toEqual({ country: 'US', state: 'CA' });
  });

  it('falls back to the country for sub-country codes we cannot target', () => {
    // Non-US sub-country targeting has no mechanism, and US-ZZ is not a state.
    expect(parseLocation('DE-BY')).toEqual({ country: 'DE', state: null });
    expect(parseLocation('US-ZZ')).toEqual({ country: 'US', state: null });
  });

  it('treats empty and malformed input as untargeted', () => {
    for (const value of ['', '   ', 'USA', 'U', null, undefined, 42]) {
      expect(parseLocation(value)).toEqual({ country: null, state: null });
    }
  });
});

describe('locationsForScraper', () => {
  it('keeps every location for state-capable engines', () => {
    expect(locationsForScraper(['US-CA', 'US-TX', 'DE'], 'chatgpt')).toEqual([
      'US-CA',
      'US-TX',
      'DE',
    ]);
  });

  it('collapses states to one country-wide run for Google engines', () => {
    // Two states of the same country would otherwise submit two identical
    // country-wide tasks — double spend, and two rows that differ only by a
    // state label neither run honoured.
    expect(locationsForScraper(['US-CA', 'US-TX', 'DE'], 'google-aio')).toEqual(['US', 'DE']);
    expect(locationsForScraper(['US-CA', 'US-TX'], 'google-aimode')).toEqual(['US']);
  });

  it('leaves country-only targeting untouched for Google engines', () => {
    expect(locationsForScraper(['US', 'DE'], 'google-aio')).toEqual(['US', 'DE']);
  });

  it('runs once with no targeting when the prompt has no locations', () => {
    expect(locationsForScraper([], 'chatgpt')).toEqual([null]);
    expect(locationsForScraper(undefined, 'google-aio')).toEqual([null]);
  });
});

describe('userLocationFor', () => {
  it('sends country only for a country location, exactly as before states', () => {
    expect(userLocationFor('DE')).toEqual({ type: 'approximate', country: 'DE' });
  });

  it('adds the full state name as the region for a state location', () => {
    expect(userLocationFor('US-CA')).toEqual({
      type: 'approximate',
      country: 'US',
      region: 'California',
    });
  });

  it('is null for untargeted runs so the tool config stays untouched', () => {
    expect(userLocationFor(null)).toBeNull();
    expect(userLocationFor('')).toBeNull();
  });
});
