import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import type { GameCatalog } from '../src/catalog.ts';
import { commonStage, contributionOption, decideContribution, landmarks, projectAt, projectNeed, projectTemplate, shareNeed } from '../src/projects.ts';

// Nachweis für #179: Projektbedarf und gemeinsame Stufe nach Abschnitt 8 von #83.

describe('Projektbedarf je Anteil', () => {
  it.each([
    [1, 20],
    [2, 30],
    [8, 90], // knapp unter dem Deckel
    [9, 100], // exakt am Deckel
    [10, 100], // Ausbau nach Projekt 9
    [25, 100],
  ])('Projekt %i braucht %i', (sequenceNumber, need) => {
    expect(projectNeed(sequenceNumber)).toBe(need);
  });

  it('lehnt Nummern unter 1 ab', () => {
    expect(() => projectNeed(0)).toThrow(RangeError);
  });
});

const shares = (a: number, b: number, need = 50) => [{ paid: a, need }, { paid: b, need }] as const;

describe('gemeinsame Stufe', () => {
  it.each([
    [0, 0, 'gestartet'],
    [49, 0, 'gestartet'], // 49 %
    [50, 0, 'gut_unterwegs'], // 50 %
    [30, 20, 'gut_unterwegs'],
    [50, 29, 'gut_unterwegs'], // 79 %
    [50, 30, 'fast_geschafft'], // 80 %
    [49, 50, 'fast_geschafft'], // 99 %
    [50, 50, 'geschafft'],
  ] as const)('%i + %i von 50 + 50 → %s', (a, b, stage) => {
    expect(commonStage(shares(a, b))).toBe(stage);
  });

  it('zählt Überzahlung nur bis zum Bedarf und ist erst bei beiden vollen Anteilen geschafft', () => {
    expect(commonStage(shares(200, 0))).toBe('gut_unterwegs');
    expect(commonStage(shares(200, 49))).toBe('fast_geschafft');
    expect(commonStage(shares(200, 50))).toBe('geschafft');
  });

  it('rechnet mit ungleichen Anteilen über die Summe', () => {
    // 17 + 6 = 23: 50 % = 11,5, 80 % = 18,4
    const challenge = (a: number, b: number) => [{ paid: a, need: 17 }, { paid: b, need: 6 }] as const;
    expect(commonStage(challenge(11, 0))).toBe('gestartet');
    expect(commonStage(challenge(12, 0))).toBe('gut_unterwegs');
    expect(commonStage(challenge(12, 6))).toBe('gut_unterwegs');
    expect(commonStage(challenge(13, 6))).toBe('fast_geschafft');
    expect(commonStage(challenge(17, 6))).toBe('geschafft');
  });
});

// Nachweis für #208: Projektfolge, Ausbau nach dem letzten Projekt, Einzahlen und Wahrzeichen (Abschnitt 8 von #83).

const withProjects = (): GameCatalog => ({
  ...testCatalog(),
  projects: [
    { key: 't_huette', name: 'Hütte', landmark: 't_huette', site: 'grundinsel:7:2' },
    { key: 't_turm', name: 'Turm', landmark: 't_turm', site: 'grundinsel:8:2' },
  ],
  projectExpansions: [
    { key: 't_huette_ausbau', name: 'Hütten-Ausbau', project: 't_huette' },
    { key: 't_turm_ausbau', name: 'Turm-Ausbau', project: 't_turm' },
  ],
});

describe('Projektfolge', () => {
  it('folgt der Katalogreihenfolge mit dem Bedarf der Nummer', () => {
    expect(projectAt(withProjects(), 1)).toEqual({
      sequenceNumber: 1, kind: 'projekt', templateKey: 't_huette', name: 'Hütte', landmarkOf: 't_huette', site: 'grundinsel:7:2', landmark: 't_huette', need: 20,
    });
    expect(projectAt(withProjects(), 2)).toMatchObject({ sequenceNumber: 2, kind: 'projekt', templateKey: 't_turm', name: 'Turm', site: 'grundinsel:8:2', need: 30 });
  });

  it('wiederholt nach dem letzten Projekt die Ausbau-Vorlagen der Reihe nach', () => {
    // Ein Ausbau steht auf dem Bauplatz seines Wahrzeichens und braucht keinen eigenen.
    expect(projectAt(withProjects(), 3)).toEqual({
      sequenceNumber: 3, kind: 'ausbau', templateKey: 't_huette_ausbau', name: 'Hütten-Ausbau', landmarkOf: 't_huette', site: 'grundinsel:7:2', landmark: 't_huette', need: 40,
    });
    expect(projectAt(withProjects(), 4)).toMatchObject({ kind: 'ausbau', templateKey: 't_turm_ausbau', landmarkOf: 't_turm' });
    expect(projectAt(withProjects(), 5)).toMatchObject({ kind: 'ausbau', templateKey: 't_huette_ausbau' });
    // Ab Projekt 9 ist der Bedarf gedeckelt; Ausbauten nach Projekt 9 brauchen 100.
    expect(projectAt(withProjects(), 12)).toMatchObject({ kind: 'ausbau', templateKey: 't_turm_ausbau', need: 100 });
  });

  it('kennt kein Projekt ohne Ausbau-Vorlagen nach dem Katalogende', () => {
    expect(() => projectAt({ ...withProjects(), projectExpansions: [] }, 3)).toThrow();
  });

  it('erkennt ein gespeichertes Projekt am Vorlagenschlüssel, auch wenn ein späterer Katalog davor Projekte einfügt', () => {
    // Projekt 2 einer Insel war der Ausbau; ein neuerer Katalog setzt den Turm an Stelle 2.
    const older: GameCatalog = { ...withProjects(), projects: withProjects().projects.slice(0, 1) };
    expect(projectAt(older, 2).templateKey).toBe('t_huette_ausbau');
    expect(projectTemplate(withProjects(), 't_huette_ausbau')).toMatchObject({ kind: 'ausbau', name: 'Hütten-Ausbau', site: 'grundinsel:7:2' });
    expect(projectTemplate(withProjects(), 't_unbekannt')).toBeNull();
  });

  it('nennt den Bedarf des Anteils einer Rolle', () => {
    expect(shareNeed({ buildNeed: 20, natureNeed: 30 }, 'bauen')).toBe(20);
    expect(shareNeed({ buildNeed: 20, natureNeed: 30 }, 'natur')).toBe(30);
  });
});

describe('Einzahlen', () => {
  const contribute = (request: Partial<Parameters<typeof decideContribution>[0]>) =>
    decideContribution({ requested: 5, share: { paid: 10, need: 30 }, balance: 20, checkedBy: 'geraet', ...request });

  it('zahlt den gewünschten Betrag ein, höchstens bis zum Restbedarf des Anteils', () => {
    expect(contribute({})).toEqual({ type: 'erlaubt', amount: 5 });
    expect(contribute({ requested: 25 })).toEqual({ type: 'erlaubt', amount: 20 });
    expect(contribute({ requested: 20 })).toEqual({ type: 'erlaubt', amount: 20 });
  });

  it('lehnt einen vollen Anteil ab, auch einen überzahlten', () => {
    expect(contribute({ share: { paid: 30, need: 30 } })).toEqual({ type: 'verboten', reason: 'anteil_voll' });
    expect(contribute({ share: { paid: 31, need: 30 } })).toEqual({ type: 'verboten', reason: 'anteil_voll' });
  });

  it('erlaubt auf dem Gerät nur den angezeigten Bestand; ein negativer Bestand zählt als 0', () => {
    expect(contribute({ balance: 4 })).toEqual({ type: 'verboten', reason: 'zu_wenig_energie', price: 5, missing: 1 });
    expect(contribute({ balance: 5 })).toEqual({ type: 'erlaubt', amount: 5 });
    expect(contribute({ balance: -3, requested: 1 })).toEqual({ type: 'verboten', reason: 'zu_wenig_energie', price: 1, missing: 1 });
  });

  it('lehnt auf dem Server erst unterhalb der Schutzgrenze −30 ab', () => {
    expect(contribute({ checkedBy: 'server', balance: -25 })).toEqual({ type: 'erlaubt', amount: 5 });
    expect(contribute({ checkedBy: 'server', balance: -26 })).toEqual({ type: 'verboten', reason: 'schutzgrenze' });
  });

  it('prüft die Schutzgrenze mit dem auf den Restbedarf gekürzten Betrag', () => {
    expect(contribute({ checkedBy: 'server', balance: -28, requested: 10, share: { paid: 28, need: 30 } })).toEqual({ type: 'erlaubt', amount: 2 });
  });

  it('lehnt einen Betrag unter 1 ab', () => {
    expect(() => contribute({ requested: 0 })).toThrow(RangeError);
  });

  it('bietet auf dem Gerät höchstens Restbedarf und angezeigten Bestand an', () => {
    expect(contributionOption({ paid: 10, need: 30 }, 25)).toEqual({ type: 'moeglich', max: 20 });
    expect(contributionOption({ paid: 10, need: 30 }, 7)).toEqual({ type: 'moeglich', max: 7 });
    expect(contributionOption({ paid: 10, need: 30 }, 0)).toEqual({ type: 'keine_energie' });
    expect(contributionOption({ paid: 10, need: 30 }, -4)).toEqual({ type: 'keine_energie' });
    expect(contributionOption({ paid: 30, need: 30 }, 25)).toEqual({ type: 'voll' });
  });
});

describe('Wahrzeichen', () => {
  it('steht für jedes fertige Projekt auf seinem Bauplatz und wächst mit jedem fertigen Ausbau', () => {
    expect(landmarks(withProjects(), ['t_huette'])).toEqual([{ projectKey: 't_huette', site: 'grundinsel:7:2', art: 't_huette', size: 1 }]);
    expect(landmarks(withProjects(), ['t_huette', 't_turm', 't_huette_ausbau', 't_huette_ausbau'])).toEqual([
      { projectKey: 't_huette', site: 'grundinsel:7:2', art: 't_huette', size: 3 },
      { projectKey: 't_turm', site: 'grundinsel:8:2', art: 't_turm', size: 1 },
    ]);
  });

  it('gibt es ohne fertiges Projekt nicht; unbekannte Schlüssel zählen nicht', () => {
    expect(landmarks(withProjects(), [])).toEqual([]);
    expect(landmarks(withProjects(), ['t_unbekannt'])).toEqual([]);
  });
});
