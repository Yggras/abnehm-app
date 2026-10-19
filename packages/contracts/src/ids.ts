// Deterministische IDs (Spezifikation 0, Abschnitt 10): Logisch eindeutige Entitäten erhalten auf
// jedem Gerät und auf dem Server dieselbe UUID, abgeleitet aus ihrem fachlichen Schlüssel. Verfahren
// ist UUIDv5 nach RFC 9562, Abschnitt 5.5 (https://www.rfc-editor.org/rfc/rfc9562#section-5.5).
// Das Vertragsmodul kennt keine Plattform-APIs; SHA-1 und UTF-8 stehen deshalb hier selbst.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** UUIDv5 des Namens im Namensraum; dieselben Eingaben ergeben überall dieselbe kleingeschriebene UUID. */
export function uuidV5(namespace: string, name: string): string {
  if (!uuidPattern.test(namespace)) throw new TypeError(`Ungültiger UUID-Namensraum: ${namespace}`);
  const namespaceBytes = namespace
    .replaceAll('-', '')
    .match(/../g)!
    .map((pair) => parseInt(pair, 16));
  const hash = sha1([...namespaceBytes, ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

/** SHA-1 nach RFC 3174 (https://www.rfc-editor.org/rfc/rfc3174); nur für IDs, nicht für Sicherheit. */
function sha1(message: readonly number[]): number[] {
  const bitLength = message.length * 8;
  const padded = [...message, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  // Länge als 64-Bit-Zahl; Nachrichten hier sind weit kürzer als 2^32 Bit.
  padded.push(0, 0, 0, 0, (bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  const rotl = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) {
      const i = block + t * 4;
      w[t] = (padded[i]! << 24) | (padded[i + 1]! << 16) | (padded[i + 2]! << 8) | padded[i + 3]!;
    }
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const [f, k] =
        t < 20 ? [(b & c) | (~b & d), 0x5a827999] : t < 40 ? [b ^ c ^ d, 0x6ed9eba1] : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a, 5) + f + e + k + w[t]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  return h.flatMap((word) => [(word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff]);
}
