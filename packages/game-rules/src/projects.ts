import type { CommonStage, IslandRole } from '@abnehm/contracts/island';

import type { ArtKey, GameCatalog } from './catalog.ts';
import { availableOnDevice, spend, type Checker, type SpendingRefusal } from './spending.ts';
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

/** Ein neues Wahrzeichen (`projekt`) oder der Ausbau eines vorhandenen (`ausbau`). */
export type ProjectKind = 'projekt' | 'ausbau';

/** Was ein gespeichertes Projekt ist: ein neues Wahrzeichen oder der Ausbau eines vorhandenen, mit dessen Bauplatz und Grafik. */
export type ProjectTemplateFacts = Readonly<{
  kind: ProjectKind;
  /** Katalogschlüssel des Projekts bzw. der Ausbau-Vorlage; Vorlagenschlüssel des gespeicherten Projekts. */
  templateKey: string;
  name: string;
  /** Schlüssel des Projekts, dessen Wahrzeichen entsteht bzw. wächst. */
  landmarkOf: string;
  /** Bauplatz dieses Wahrzeichens am Gemeinschaftsplatz. */
  site: string;
  /** Grafik dieses Wahrzeichens. */
  landmark: ArtKey;
}>;

/** Gemeinschaftsprojekt Nummer n samt seinem beim Start festgeschriebenen Bedarf je Anteil. */
export type ProjectSlot = ProjectTemplateFacts & Readonly<{ sequenceNumber: number; need: number }>;

/**
 * Ein Projekt über seinen gespeicherten Vorlagenschlüssel; `null`, wenn der Katalog ihn nicht kennt. Bestehende Inseln
 * bleiben so gültig, auch wenn ein späterer Katalog vor den Ausbau-Vorlagen weitere Projekte einfügt (Spezifikation 4,
 * Abschnitt 4: Schlüssel werden nie umgewidmet).
 */
export function projectTemplate(catalog: GameCatalog, templateKey: string): ProjectTemplateFacts | null {
  const facts = (kind: ProjectKind, name: string, landmarkOf: string): ProjectTemplateFacts | null => {
    const landmark = catalog.projects.find((project) => project.key === landmarkOf);
    return landmark === undefined ? null : { kind, templateKey, name, landmarkOf, site: landmark.site, landmark: landmark.landmark };
  };
  const project = catalog.projects.find((candidate) => candidate.key === templateKey);
  if (project !== undefined) return facts('projekt', project.name, project.key);
  const expansion = catalog.projectExpansions.find((candidate) => candidate.key === templateKey);
  return expansion === undefined ? null : facts('ausbau', expansion.name, expansion.project);
}

/**
 * Projekt Nummer n (Spezifikation 4, Abschnitt 8), das der Server beim Start festschreibt: erst die Projekte in
 * Katalogreihenfolge, danach die Ausbau-Vorlagen der Reihe nach, immer wieder. Ohne Ausbau-Vorlage gibt es nach dem
 * letzten Projekt keines; das verhindert die Katalogprüfung (`ausbau`).
 */
export function projectAt(catalog: GameCatalog, sequenceNumber: number): ProjectSlot {
  const need = projectNeed(sequenceNumber);
  const expansions = catalog.projectExpansions;
  const template =
    catalog.projects[sequenceNumber - 1]?.key ??
    (expansions.length === 0 ? undefined : expansions[(sequenceNumber - catalog.projects.length - 1) % expansions.length]!.key);
  const facts = template === undefined ? null : projectTemplate(catalog, template);
  if (facts === null) throw new Error(`Der Spielkatalog hat kein Projekt Nummer ${sequenceNumber}`);
  return { ...facts, sequenceNumber, need };
}

/** Bedarf des Anteils einer Rolle, wie beim Start des Projekts festgeschrieben. */
export function shareNeed(project: Readonly<{ buildNeed: number; natureNeed: number }>, role: IslandRole): number {
  return role === 'bauen' ? project.buildNeed : project.natureNeed;
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

/** Was das Gerät zum Einzahlen anbietet: ein voller Anteil, keine Energie oder Beträge von 1 bis `max`. */
export type ContributionOption = Readonly<{ type: 'voll' }> | Readonly<{ type: 'keine_energie' }> | Readonly<{ type: 'moeglich'; max: number }>;

/** Höchstens der Restbedarf und der angezeigte Bestand, nach derselben Regel wie `decideContribution` auf dem Gerät. */
export function contributionOption(share: Share, balance: number): ContributionOption {
  const rest = share.need - share.paid;
  if (rest <= 0) return { type: 'voll' };
  const max = Math.min(rest, availableOnDevice(balance));
  return max === 0 ? { type: 'keine_energie' } : { type: 'moeglich', max };
}

/** Ein Wahrzeichen auf seinem Bauplatz; `size` wächst mit jedem fertigen Ausbau ab 1. */
export type Landmark = Readonly<{ projectKey: string; site: string; art: ArtKey; size: number }>;

/**
 * Die Wahrzeichen der fertigen Projekte (Vorlagenschlüssel in Projektreihenfolge), in Katalogreihenfolge. Ein Ausbau
 * vergrößert sein Wahrzeichen, wenn es schon steht; unbekannte Schlüssel zählen nicht.
 */
export function landmarks(catalog: GameCatalog, completed: readonly string[]): Landmark[] {
  const sizes = new Map<string, number>();
  for (const facts of completed.map((templateKey) => projectTemplate(catalog, templateKey))) {
    if (facts === null) continue;
    if (facts.kind === 'projekt') sizes.set(facts.landmarkOf, 1);
    else if (sizes.has(facts.landmarkOf)) sizes.set(facts.landmarkOf, sizes.get(facts.landmarkOf)! + 1);
  }
  return catalog.projects.flatMap((project) => {
    const size = sizes.get(project.key);
    return size === undefined ? [] : [{ projectKey: project.key, site: project.site, art: project.landmark, size }];
  });
}
