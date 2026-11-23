import type { CommonStage } from '@abnehm/contracts/island';

import { spend, type Checker, type SpendingRefusal } from './building.ts';
import type { ArtKey, GameCatalog } from './catalog.ts';
import { assertWholeNumber } from './whole-number.ts';

// Gemeinschaftsprojekte und gemeinsame Stufe (Spezifikation 4, Abschnitt 8; Werte neu festgelegt,
// nicht belegt). Die Stufe gilt für Gemeinschaftsprojekt und Challenge gleichermaßen. Dazu Projektfolge,
// Einzahlen und Wahrzeichen (#208): dieselben Regeln auf Gerät und Server.

/** Eingezahlter Stand und festgeschriebener Bedarf eines Anteils. */
export type Share = Readonly<{ paid: number; need: number }>;

/** Bedarf je Anteil von Projekt Nummer n: `min(20 + 10 × (n − 1), 100)`; danach Ausbau mit 100. */
export function projectNeed(sequenceNumber: number): number {
  return Math.min(20 + 10 * (assertWholeNumber(sequenceNumber, 1, 'Projektnummer') - 1), 100);
}

/**
 * Gemeinsame Stufe aus `(min(a, A) + min(b, B)) / (A + B)`: unter 50 % `gestartet`, ab 50 %
 * `gut_unterwegs`, ab 80 % `fast_geschafft`; `geschafft` erst, wenn beide Anteile voll sind.
 */
export function commonStage(shares: readonly [Share, Share]): CommonStage {
  const [a, b] = shares;
  if (a.paid >= a.need && b.paid >= b.need) return 'geschafft';
  const paid = Math.min(a.paid, a.need) + Math.min(b.paid, b.need);
  const need = a.need + b.need;
  if (5 * paid >= 4 * need) return 'fast_geschafft';
  if (2 * paid >= need) return 'gut_unterwegs';
  return 'gestartet';
}

/** Anlassschlüssel des Projektabschlusses (Spezifikation 4, Abschnitt 2.2): `projekt:<insel>:<nr>`. */
export function projectOccasionKey(islandId: string, sequenceNumber: number): string {
  return `projekt:${islandId}:${assertWholeNumber(sequenceNumber, 1, 'Projektnummer')}`;
}

/** Gemeinschaftsprojekt Nummer n: aus der festen Reihenfolge oder, danach, ein Ausbau. */
export type ProjectSlot = Readonly<{
  sequenceNumber: number;
  kind: 'projekt' | 'ausbau';
  /** Katalogschlüssel des Projekts bzw. der Ausbau-Vorlage; Vorlagenschlüssel des gespeicherten Projekts. */
  templateKey: string;
  name: string;
  /** Schlüssel des Projekts, dessen Wahrzeichen entsteht bzw. wächst. */
  landmarkOf: string;
  /** Bedarf je Anteil (Bauen und Natur), festgeschrieben beim Start. */
  need: number;
}>;

/**
 * Projekt Nummer n (Spezifikation 4, Abschnitt 8): erst die Projekte in Katalogreihenfolge, danach die
 * Ausbau-Vorlagen der Reihe nach, immer wieder. Ohne Ausbau-Vorlage gibt es nach dem letzten Projekt keines;
 * das verhindert die Katalogprüfung (`ausbau`).
 */
export function projectAt(catalog: GameCatalog, sequenceNumber: number): ProjectSlot {
  const need = projectNeed(sequenceNumber);
  const project = catalog.projects[sequenceNumber - 1];
  if (project !== undefined) return { sequenceNumber, kind: 'projekt', templateKey: project.key, name: project.name, landmarkOf: project.key, need };
  const expansions = catalog.projectExpansions;
  if (expansions.length === 0) throw new Error('Der Spielkatalog hat keine Ausbau-Vorlage');
  const expansion = expansions[(sequenceNumber - catalog.projects.length - 1) % expansions.length]!;
  return { sequenceNumber, kind: 'ausbau', templateKey: expansion.key, name: expansion.name, landmarkOf: expansion.project, need };
}

export type ContributionRequest = Readonly<{
  /** Gewünschter Betrag, mindestens 1. */
  requested: number;
  /** Anteil der aktuellen eigenen Rolle: bisher eingezahlt und Bedarf. */
  share: Share;
  /** Energiebestand der Person vor dem Einzahlen: Summe aller Buchungen, auch negativ. */
  balance: number;
  checkedBy: Checker;
}>;

export type ContributionDecision =
  | Readonly<{ type: 'erlaubt'; amount: number }>
  | Readonly<{ type: 'verboten'; reason: 'anteil_voll' }>
  | SpendingRefusal;

/**
 * Einzahlen (Spezifikation 4, Abschnitt 8): höchstens bis zum Restbedarf des Anteils. Das Gerät zahlt nur
 * aus dem angezeigten Bestand ein, der Server lehnt erst unter der Schutzgrenze ab, beides mit dem gekürzten
 * Betrag. So kann ein zweites eigenes Gerät, das offline denselben Rest einzahlt, nie überzahlen.
 */
export function decideContribution({ requested, share, balance, checkedBy }: ContributionRequest): ContributionDecision {
  assertWholeNumber(requested, 1, 'Einzahlung');
  const rest = share.need - share.paid;
  if (rest <= 0) return { type: 'verboten', reason: 'anteil_voll' };
  const spending = spend(Math.min(requested, rest), balance, checkedBy);
  return spending.type === 'erlaubt' ? { type: 'erlaubt', amount: spending.price } : spending;
}

/** Ein Wahrzeichen auf seinem Bauplatz; `size` wächst mit jedem fertigen Ausbau ab 1. */
export type Landmark = Readonly<{ projectKey: string; site: string; art: ArtKey; size: number }>;

/** Die Wahrzeichen der fertigen Projekte (Nummern), in Katalogreihenfolge. */
export function landmarks(catalog: GameCatalog, completed: readonly number[]): Landmark[] {
  const sizes = new Map<string, number>();
  for (const slot of [...completed].sort((a, b) => a - b).map((n) => projectAt(catalog, n))) {
    if (slot.kind === 'projekt') sizes.set(slot.landmarkOf, 1);
    else if (sizes.has(slot.landmarkOf)) sizes.set(slot.landmarkOf, sizes.get(slot.landmarkOf)! + 1);
  }
  return catalog.projects.flatMap((project) => {
    const size = sizes.get(project.key);
    return size === undefined ? [] : [{ projectKey: project.key, site: project.site, art: project.landmark, size }];
  });
}
