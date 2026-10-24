/**
 * @jest-environment node
 */
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { runDeviceSuite, type DeviceSuiteFiles } from './suite';

// Nachweis für #114: Die On-Device-Suite besteht mit better-sqlite3 und denselben gebündelten
// Migrationen; auf dem Gerät läuft sie unverändert mit expo-sqlite. Die Gegenproben zeigen, dass sie
// einen fehlenden Neustart erkennt.

let sqlite: ReturnType<typeof createBetterSqliteFiles>;
let files: DeviceSuiteFiles;

beforeEach(() => {
  sqlite = createBetterSqliteFiles();
  files = { openSqlite: sqlite.openSqlite, remove: sqlite.removeFile };
});

afterEach(() => sqlite.remove());

const failures = (report: Awaited<ReturnType<typeof runDeviceSuite>>) => report.results.filter((result) => result.error !== null);

it('besteht vor und nach einem Neustart und räumt ihre Dateien auf', async () => {
  const before = await runDeviceSuite('vor_neustart', files, 'prozess-1');
  expect(failures(before)).toEqual([]);
  expect(before.results.map((result) => result.key)).toEqual(['migration_frisch', 'migration_update', 'rollback', 'pull_seite_cursor', 'neustart_vorbereiten']);

  const after = await runDeviceSuite('nach_neustart', files, 'prozess-2');
  expect(failures(after)).toEqual([]);
  // Danach gibt es den Stand nicht mehr; ein zweiter Lauf verlangt wieder die erste Phase.
  expect(failures(await runDeviceSuite('nach_neustart', files, 'prozess-3'))).toEqual([
    expect.objectContaining({ key: 'neustart_pruefen', error: expect.stringContaining('zuerst die Phase vor_neustart') }),
  ]);
});

it('erkennt, wenn die App zwischen den Phasen nicht neu gestartet wurde', async () => {
  await runDeviceSuite('vor_neustart', files, 'prozess-1');
  expect(failures(await runDeviceSuite('nach_neustart', files, 'prozess-1'))).toEqual([
    expect.objectContaining({ key: 'neustart_pruefen', error: 'Die App wurde seit der Phase vor_neustart nicht neu gestartet' }),
  ]);
});

it('beginnt mit leeren Dateien, auch wenn ein abgebrochener Lauf Reste hinterlassen hat', async () => {
  await runDeviceSuite('vor_neustart', files, 'prozess-1');
  expect(failures(await runDeviceSuite('vor_neustart', files, 'prozess-1'))).toEqual([]);
});
