import { inflateRawSync } from 'node:zlib';

// Liest ZIP-Archive und die erste Tabelle einer .xlsx-Datei nur mit Node-Bordmitteln. Das Build-Skript
// braucht davon wenig: gespeicherte oder per Deflate komprimierte Einträge (ZIP-Spezifikation,
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT, Abschnitte 4.3.7, 4.3.12 und 4.3.16)
// und Zellen mit Zahlen oder Texten aus der Tabelle gemeinsamer Zeichenfolgen (Office Open XML,
// ECMA-376 Teil 1, Abschnitte 18.3.1.4 und 18.4.8). Alles andere bricht laut ab, statt still falsche
// Werte zu liefern.

const endOfCentralDirectory = 0x06054b50;
const centralDirectoryHeader = 0x02014b50;
const localFileHeader = 0x04034b50;

/** Alle Dateien eines ZIP-Archivs, entpackt, nach ihrem Pfad. */
export function readZip(archive: Buffer): Map<string, Buffer> {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== centralDirectoryHeader) throw new Error('ZIP: Zentralverzeichnis beschädigt');
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new Error(`ZIP64 wird nicht unterstützt: ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    if (archive.readUInt32LE(localOffset) !== localFileHeader) throw new Error(`ZIP: Kopf von ${name} beschädigt`);
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (content === null) throw new Error(`ZIP: Kompressionsverfahren ${method} von ${name} wird nicht unterstützt`);
    if (content.length !== size) throw new Error(`ZIP: ${name} hat ${content.length} statt ${size} Bytes`);
    entries.set(name, content);
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // Der Datensatz steht am Ende, nach höchstens 65.535 Bytes Kommentar.
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 22 - 0xffff); offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfCentralDirectory) return offset;
  }
  throw new Error('Keine ZIP-Datei: Ende des Zentralverzeichnisses fehlt');
}

/** Zeilen der einzigen Tabelle einer .xlsx-Datei; jede Zeile bildet Spaltenbuchstaben auf Zellwerte ab. */
export function readSingleSheet(workbook: Buffer): Map<string, string | number>[] {
  const files = readZip(workbook);
  const sheets = [...files.keys()].filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  if (sheets.length !== 1) throw new Error(`Erwartet genau eine Tabelle, gefunden: ${sheets.join(', ') || 'keine'}`);
  const sharedStringsXml = files.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? readSharedStrings(sharedStringsXml.toString('utf8')) : [];
  return readRows(files.get(sheets[0] as string)!.toString('utf8'), sharedStrings);
}

function readSharedStrings(xml: string): string[] {
  // Ein Eintrag ist reiner Text oder formatierter Text aus mehreren Läufen; gezählt wird nur `<t>`,
  // nicht die phonetischen Lesehilfen in `<rPh>`.
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map(([, item]) =>
    [...(item ?? '').replace(/<rPh\b.*?<\/rPh>/gs, '').matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>|<t(?:\s[^>]*)?\/>/gs)]
      .map(([, text]) => decodeXml(text ?? ''))
      .join(''),
  );
}

function readRows(xml: string, sharedStrings: readonly string[]): Map<string, string | number>[] {
  const rows: Map<string, string | number>[] = [];
  for (const [, rowNumber, body] of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>(.*?)<\/row>)/gs)) {
    if (Number(rowNumber) !== rows.length + 1) throw new Error(`Zeile ${rowNumber} folgt nicht lückenlos`);
    const cells = new Map<string, string | number>();
    for (const [, column, attributes, content] of (body ?? '').matchAll(/<c\b[^>]*?\br="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const value = cellValue(attributes ?? '', content ?? '', sharedStrings);
      if (value !== null) cells.set(column as string, value);
    }
    rows.push(cells);
  }
  return rows;
}

function cellValue(attributes: string, content: string, sharedStrings: readonly string[]): string | number | null {
  const type = /\bt="([a-zA-Z]+)"/.exec(attributes)?.[1] ?? 'n';
  if (type === 'inlineStr') return decodeXml([...content.matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)].map(([, text]) => text).join(''));
  const raw = /<v>(.*?)<\/v>/s.exec(content)?.[1];
  if (raw === undefined) return null;
  switch (type) {
    case 'n': {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`Keine Zahl in der Zelle: ${raw}`);
      return number;
    }
    case 's': {
      const text = sharedStrings[Number(raw)];
      if (text === undefined) throw new Error(`Unbekannte gemeinsame Zeichenfolge ${raw}`);
      return text;
    }
    case 'str':
      return decodeXml(raw);
    default:
      throw new Error(`Zelltyp ${type} wird nicht unterstützt`);
  }
}

function decodeXml(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (_, hex, decimal, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number(decimal));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name as 'amp'];
  });
}
