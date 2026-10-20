/**
 * Ob dieses Artefakt ein Test-Artefakt ist: Development Build oder E2E-Build (#114, siehe
 * `build-capabilities.ts`). Nur dort zeigen fehlende Beiträge der Bereiche einen deutschen
 * Platzhalter; im Produktionsbuild sind sie ein Integrationsfehler. Der E2E-Build braucht die
 * Platzhalter, solange Bereiche fehlen, sonst könnte Maestro Tabs und ＋ nicht bedienen.
 *
 * Eine Funktion ohne Importe: Tests schalten `__DEV__` zur Laufzeit um, und die Shell-Module, die sie
 * nutzen, dürfen die Testfähigkeiten nicht laden.
 */
export function isTestArtifact(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_E2E_BUILD === 'true';
}
