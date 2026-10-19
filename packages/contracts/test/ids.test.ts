import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { uuidV5 } from '../src/ids.ts';

// Nachweis für #105: deterministische IDs nach RFC 9562, Abschnitt 5.5 (UUIDv5, SHA-1).

const dnsNamespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Unabhängige Referenz über node:crypto. */
function referenceV5(namespace: string, name: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('uuidV5', () => {
  it('ergibt das Beispiel der Python-Doku (uuid5(NAMESPACE_DNS, "python.org"))', () => {
    // https://docs.python.org/3/library/uuid.html#example
    expect(uuidV5(dnsNamespace, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it.each([
    '',
    'tagesziel:0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01:2026-10-14:2',
    'Grüße, Möwe 🐟 und Lagune',
    'x'.repeat(55),
    'y'.repeat(56),
    'z'.repeat(64),
    'lang '.repeat(100),
  ])('stimmt mit SHA-1 aus node:crypto überein: %j', (name) => {
    expect(uuidV5(dnsNamespace, name)).toBe(referenceV5(dnsNamespace, name));
  });

  it('lehnt einen ungültigen Namensraum ab', () => {
    expect(() => uuidV5('kein-namensraum', 'x')).toThrow();
  });
});
