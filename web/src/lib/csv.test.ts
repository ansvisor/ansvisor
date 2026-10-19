import { expect, test } from 'vitest';
import { toCsv } from './csv.js';

test('plain values pass through unquoted', () => {
  const result = toCsv([{ name: 'hello', value: 'world' }], ['name', 'value']);
  expect(result).toBe('name,value\nhello,world');
});

test('comma in a value triggers quoting', () => {
  const result = toCsv([{ name: 'a,b' }], ['name']);
  expect(result).toBe('name\n\"a,b\"');
});

test('double quote in a value is doubled and the field is quoted', () => {
  const result = toCsv([{ text: 'she said "hi"' }], ['text']);
  expect(result).toBe('text\n"she said ""hi"""');
});

test('newline in a value triggers quoting', () => {
  const result = toCsv([{ text: 'line1\nline2' }], ['text']);
  expect(result).toBe('text\n\"line1\nline2\"');
});

test('lone carriage return in a value triggers quoting', () => {
  const result = toCsv([{ text: 'line1\rline2' }], ['text']);
  expect(result).toBe('text\n\"line1\rline2\"');
});

test('CRLF in a value remains quoted', () => {
  const result = toCsv([{ text: 'line1\r\nline2' }], ['text']);
  expect(result).toBe('text\n\"line1\r\nline2\"');
});

test('null and undefined become empty strings', () => {
  const result = toCsv([{ a: null, b: undefined, c: 'value' }], ['a', 'b', 'c']);
  expect(result).toBe('a,b,c\n,,value');
});

test('header row is emitted first, joined by commas', () => {
  const result = toCsv([{ foo: 'bar' }], ['foo', 'bar', 'baz']);
  expect(result).toBe('foo,bar,baz\nbar,,');
});

test('column order follows the headers array', () => {
  const result = toCsv([{ b: '2', a: '1' }], ['a', 'b']);
  expect(result).toBe('a,b\n1,2');
});

test('missing key in a row produces an empty field', () => {
  const result = toCsv([{ a: '1' }], ['a', 'b']);
  expect(result).toBe('a,b\n1,');
});

test('multiple rows are joined by newline', () => {
  const result = toCsv(
    [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ],
    ['a', 'b'],
  );
  expect(result).toBe('a,b\n1,2\n3,4');
});
