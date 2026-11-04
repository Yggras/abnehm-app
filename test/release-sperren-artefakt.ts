// Release-Sperren gegen genau die freizugebenden Artefakte (Produktiv-Gate #115). `release-sperren.test.ts`
// prüft einen eigenen `expo export` und die COPY-Anweisungen des Dockerfiles. Dieses Kommando prüft dieselbe
// Registry an den Artefakten, die die Release-Checkliste freigibt:
//
//   node test/release-sperren-artefakt.ts bundle <main.jsbundle | index.android.bundle>
//   node test/release-sperren-artefakt.ts image <image-id | name>
//
// Bundle: Kein Marker einer Testfähigkeit steht im JS-Bundle des Binarys (Hermes-Bytecode legt Zeichenketten
// im Klartext ab). Image: Keine Datei unter einem Modul einer Testfähigkeit liegt in /app, und kein Marker
// steht in den Quellen dort (ohne node_modules). Exit 1 bei einem Fund; Gegenprobe am E2E-Bundle.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { testCapabilities, testCapabilityRoots } from './test-capabilities.ts';

const [kind, target] = process.argv.slice(2);
const findings: string[] = [];

if (kind === 'bundle' && target !== undefined) {
  const content = readFileSync(target).toString('latin1');
  for (const { key, markers } of testCapabilities) {
    for (const marker of markers) if (content.includes(marker)) findings.push(`${key}: Marker „${marker}“ im Bundle`);
  }
} else if (kind === 'image' && target !== undefined) {
  const inImage = (script: string) =>
    execFileSync('docker', ['run', '--rm', '--entrypoint', 'sh', target, '-c', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = inImage("cd /app && find . -path ./node_modules -prune -o -type f -print | sed 's|^\\./||'").split('\n').filter(Boolean);
  const modules = [...testCapabilityRoots, ...testCapabilities.flatMap(({ modules: paths }) => paths)];
  for (const file of files) {
    const module = modules.find((path) => (path.endsWith('/') ? file.startsWith(path) : file === path));
    if (module !== undefined) findings.push(`Datei ${file} gehört zur Testfähigkeit (${module})`);
  }
  const sources = inImage('cd /app && find . -path ./node_modules -prune -o -type f -print0 | xargs -0 cat');
  for (const { key, markers } of testCapabilities) {
    for (const marker of markers) if (sources.includes(marker)) findings.push(`${key}: Marker „${marker}“ im Image`);
  }
} else {
  console.error('Aufruf: node test/release-sperren-artefakt.ts bundle <datei> | image <image>');
  process.exit(2);
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`FEHLER: ${finding}`);
  process.exit(1);
}
const markerCount = testCapabilities.reduce((sum, { markers }) => sum + markers.length, 0);
console.log(`ok: keine Testfähigkeit im ${kind === 'bundle' ? 'Bundle' : 'Image'} ${target} (${testCapabilities.length} Fähigkeiten, ${markerCount} Marker)`);
