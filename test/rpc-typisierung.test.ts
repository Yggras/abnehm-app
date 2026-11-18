import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Nachweis für #93: Eine inkompatible Änderung am Status-Endpunkt des Backends lässt die
// Typprüfung der App scheitern. Die geänderte Backend-Datei existiert nur im Speicher.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const backendStatus = path.join(repoRoot, 'apps/backend/src/status.ts');
const appStatus = path.join(repoRoot, 'apps/mobile/src/backend/status.ts');
const originalBackendStatus = readFileSync(backendStatus, 'utf8');

const parsedAppConfig = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'apps/mobile/tsconfig.json'), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  },
});
if (parsedAppConfig === undefined) throw new Error('tsconfig der App nicht lesbar');
const appConfig = parsedAppConfig;

// Nur der RPC-Client der App samt seinen Importen (darunter der Typ der Backend-Routen) und die
// globalen Deklarationen aus dem tsconfig der App. Die ganze App dreimal zu typprüfen sprengte mit
// wachsender App das Heap-Limit der CI-Worker; der Nachweis betrifft nur diese Datei.
const appRootNames = [...appConfig.fileNames.filter((fileName) => fileName.endsWith('.d.ts')), appStatus];

let previousProgram: ts.Program | undefined;

/** Typprüfung des RPC-Clients der App, wobei `apps/backend/src/status.ts` den angegebenen Inhalt hat. */
function appDiagnosticsWithBackendStatus(source: string): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost(appConfig.options);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(fileName) === backendStatus
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({
    rootNames: appRootNames,
    options: appConfig.options,
    host,
    oldProgram: previousProgram,
  });
  previousProgram = program;
  return ts.getPreEmitDiagnostics(program);
}

function backendStatusWith(search: string, replacement: string) {
  if (!originalBackendStatus.includes(search)) throw new Error(`Stelle im Backend nicht gefunden: ${search}`);
  return originalBackendStatus.replace(search, replacement);
}

const okResponse = "c.json({ type: 'ok', databaseTime } satisfies Ok, 200)";
const inApp = (diagnostics: readonly ts.Diagnostic[]) =>
  diagnostics.filter((diagnostic) => diagnostic.file !== undefined && path.resolve(diagnostic.file.fileName) === appStatus);

describe('Hono RPC verbindet die Typprüfung von App und Backend', () => {
  it('unverändert typt die App fehlerfrei', () => {
    expect(appDiagnosticsWithBackendStatus(originalBackendStatus)).toEqual([]);
  }, 120_000);

  it('ein umbenanntes Feld im Backend lässt die Typprüfung der App scheitern', () => {
    const changed = backendStatusWith(okResponse, "c.json({ type: 'ok', dbTime: databaseTime }, 200)");

    expect(inApp(appDiagnosticsWithBackendStatus(changed))).not.toEqual([]);
  }, 120_000);

  it('ein zusätzliches Feld im Backend lässt die Typprüfung der App scheitern', () => {
    const changed = backendStatusWith(okResponse, "c.json({ type: 'ok', databaseTime, version: 2 }, 200)");

    expect(inApp(appDiagnosticsWithBackendStatus(changed))).not.toEqual([]);
  }, 120_000);
});
