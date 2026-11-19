import type { IslandEventKind, IslandRole } from '@abnehm/contracts/island';
import type { IslandObjectOrigin, VisitorEventDetails, VisitorReward } from '@abnehm/contracts/island-records';

import type { GameCatalog } from './catalog.ts';
import { basePrice } from './prices.ts';
import { pick, seededRandom, shuffled, type Random } from './random.ts';

// Ereignistakt und Besucher mit Wunsch (Spezifikation 4, Abschnitt 9). Die Erzeugung läuft nur auf dem
// Server, deterministisch mit Anlassschlüsseln und einem aus der Insel-ID abgeleiteten Zufall. Die
// Bedingung eines Wunschs und die Belohnung beim Abholen rechnen Gerät und Server mit denselben Regeln:
// Das Gerät holt offline vorläufig ab, der Server bestätigt kanonisch.
//
// Inselwetter (#207) und Momos Wunsch (#206) belegen Plätze des Tagesdeckels vor den Besuchern; sie kommen
// mit ihren Tickets. Entdeckungen (#204) zählen nicht zum Deckel.

/** Höchstens so viele sonstige Ereignisse je Insel und Inseltag (#28; Designwert, nicht belegt). */
export const dailyEventCap = 2;

/** Höchstens so viele offene personenbezogene Ereignisse je Person (neu festgelegt in #83; nicht belegt). */
export const openPersonalEventLimit = 4;

/** Höchstens so viele neue personenbezogene Ereignisse je Person und Tag (neu festgelegt in #83). */
export const personalEventsPerDay = 1;

/** Arten, die zum Tagesdeckel zählen; Entdeckungen nicht. */
export const cappedEventKinds: readonly IslandEventKind[] = ['besuch', 'momos_wunsch', 'inselwetter'];

/** Arten mit genau einer zuständigen Person. */
export const personalEventKinds: readonly IslandEventKind[] = ['besuch', 'momos_wunsch'];

/** Freie Plätze des Tagesdeckels bei so vielen deckelnden Ereignissen heute. */
export function freeEventSlots(cappedToday: number): number {
  return Math.max(0, dailyEventCap - cappedToday);
}

/** Stand einer Person am Inseltag: neue personenbezogene Ereignisse heute und offene insgesamt. */
export type PersonEventDay = Readonly<{ personalToday: number; openPersonal: number }>;

/** Ob die Person heute noch ein neues personenbezogenes Ereignis bekommen darf. In Pausen wächst so kein Stapel. */
export function personalEventAllowed({ personalToday, openPersonal }: PersonEventDay): boolean {
  return personalToday < personalEventsPerDay && openPersonal < openPersonalEventLimit;
}

/** Anlassschlüssel eines Besuchers: `tag:‹datum›:‹n›`, eindeutig je Insel (Spezifikation 0, Abschnitt 8). */
export function visitorOccasionKey(date: string, n: number): string {
  return `tag:${date}:${n}`;
}

/** `n` eines Anlassschlüssels `tag:‹datum›:‹n›` an diesem Tag; `null` bei jedem anderen Schlüssel. */
export function visitorSlotOf(occasionKey: string, date: string): number | null {
  const prefix = `tag:${date}:`;
  if (!occasionKey.startsWith(prefix)) return null;
  const n = Number(occasionKey.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Was offene Besuche für die Planung neuer bedeuten: welche Besucher gerade auf der Insel sind und welche
 * Baupläne ihnen versprochen sind (`openTemplates` und `promisedBlueprints` von `planVisitors`).
 */
export function openVisitFacts(
  openVisits: readonly Readonly<{ templateKey: string; details: VisitorEventDetails }>[],
): Pick<VisitorDayInput, 'openTemplates' | 'promisedBlueprints'> {
  return {
    openTemplates: new Set(openVisits.map((visit) => visit.templateKey)),
    promisedBlueprints: new Set(openVisits.flatMap(({ details: { reward } }) => (reward.type === 'bauplan' ? [reward.key] : []))),
  };
}

/**
 * Preisgrenze des gewünschten Bauplans: der Preis des neuesten freigeschalteten Level-Bauplans der Rolle.
 * Ohne einen gilt der teuerste Start-Bauplan der Rolle (Nutzerentscheidung in #202).
 */
export function wishPriceCap(catalog: GameCatalog, role: IslandRole, unlockedBlueprints: ReadonlySet<string>): number {
  const newest = catalog.levelUnlocks
    .filter((unlock) => unlock.role === role && unlockedBlueprints.has(unlock.blueprint))
    .reduce<{ level: number; blueprint: string } | undefined>((best, unlock) => (best === undefined || unlock.level > best.level ? unlock : best), undefined);
  const priced = (key: string) => catalog.blueprints.find((blueprint) => blueprint.key === key);
  const newestBlueprint = newest && priced(newest.blueprint);
  if (newestBlueprint !== undefined) return basePrice(newestBlueprint);
  return Math.max(0, ...catalog.blueprints.filter((b) => b.origin === 'start' && b.role === role).map(basePrice));
}

/**
 * Der gewünschte Bauplan: ein freigeschalteter Bauplan der aktuellen eigenen Rolle (Nutzerentscheidung in
 * #202) bis zur Preisgrenze, bevorzugt einer, den die Person noch nicht gebaut hat.
 */
export function chooseWish(
  catalog: GameCatalog,
  { role, unlockedBlueprints, builtBlueprints, random }: Readonly<{ role: IslandRole; unlockedBlueprints: ReadonlySet<string>; builtBlueprints: ReadonlySet<string>; random: Random }>,
): string | undefined {
  const cap = wishPriceCap(catalog, role, unlockedBlueprints);
  const candidates = catalog.blueprints.filter((b) => b.role === role && unlockedBlueprints.has(b.key) && basePrice(b) <= cap).map((b) => b.key);
  const fresh = candidates.filter((key) => !builtBlueprints.has(key));
  return pick(random, fresh.length > 0 ? fresh : candidates);
}

/**
 * Belohnung eines Besuchers: ein noch nicht freigeschalteter Besucher-Bauplan der Rolle, bevorzugt aus dem
 * Pool des Besuchers; ist keiner mehr übrig, Deko aus seinem Pool. `unavailable` sind Baupläne, die schon
 * einem offenen Besuch versprochen sind.
 */
export function visitorReward(
  catalog: GameCatalog,
  {
    templateKey,
    role,
    unlockedBlueprints,
    unavailable = new Set(),
    random,
  }: Readonly<{ templateKey: string; role: IslandRole; unlockedBlueprints: ReadonlySet<string>; unavailable?: ReadonlySet<string>; random: Random }>,
): VisitorReward {
  const template = catalog.visitorTemplates.find((entry) => entry.key === templateKey);
  if (template === undefined) throw new RangeError(`Unbekannte Besuchervorlage ${templateKey}`);
  const open = catalog.blueprints
    .filter((b) => b.origin === 'besucher' && b.role === role && !unlockedBlueprints.has(b.key) && !unavailable.has(b.key))
    .map((b) => b.key);
  const pooled = open.filter((key) => template.rewards.blueprints.includes(key));
  const blueprint = pick(random, pooled.length > 0 ? pooled : open);
  if (blueprint !== undefined) return { type: 'bauplan', key: blueprint };
  const deko = pick(random, template.rewards.deko);
  if (deko === undefined) throw new RangeError(`Besuchervorlage ${templateKey} ohne Deko`);
  return { type: 'deko', key: deko };
}

/**
 * Die Belohnung beim Abholen: die geplante, solange sie noch gilt. Ist der geplante Bauplan inzwischen
 * freigeschaltet oder passt er nach einem Rollentausch nicht mehr zur Rolle, wird sie mit einem aus der
 * Ereignis-ID abgeleiteten Zufall neu bestimmt, auf Gerät und Server gleich. Geplante Deko gilt nur, solange
 * kein Besucher-Bauplan der Rolle mehr frei ist; beim Planen war er womöglich nur einem anderen offenen
 * Besuch versprochen („wenn keiner mehr übrig ist“, Spezifikation 4, Abschnitt 9).
 */
export function resolveClaimedReward(
  catalog: GameCatalog,
  {
    eventId,
    templateKey,
    planned,
    role,
    unlockedBlueprints,
  }: Readonly<{ eventId: string; templateKey: string; planned: VisitorReward; role: IslandRole; unlockedBlueprints: ReadonlySet<string> }>,
): VisitorReward {
  const stillValid =
    planned.type === 'deko'
      ? !catalog.blueprints.some((b) => b.origin === 'besucher' && b.role === role && !unlockedBlueprints.has(b.key))
      : catalog.blueprints.find((b) => b.key === planned.key)?.role === role && !unlockedBlueprints.has(planned.key);
  if (stillValid) return planned;
  return visitorReward(catalog, { templateKey, role, unlockedBlueprints, random: seededRandom(`${eventId}:belohnung`) });
}

/** Ein Inselobjekt, wie die Bedingung es sieht. */
export type WishObject = Readonly<{ ownerPersonId: string; catalogKey: string; origin: IslandObjectOrigin; createdAt: string }>;

/**
 * Bedingung eines Besuchers: Die zuständige Person hat den gewünschten Bauplan nach dem Erzeugen des
 * Ereignisses gebaut. Es zählen nur Handlungen danach (Spezifikation 4, Abschnitt 9).
 */
export function isWishFulfilled(
  event: Readonly<{ wish: Readonly<{ blueprintKey: string }>; responsiblePersonId: string; occurredAt: string }>,
  objects: readonly WishObject[],
): boolean {
  const after = Date.parse(event.occurredAt);
  return objects.some(
    (object) =>
      object.origin === 'gebaut' &&
      object.ownerPersonId === event.responsiblePersonId &&
      object.catalogKey === event.wish.blueprintKey &&
      Date.parse(object.createdAt) > after,
  );
}

/** Eine Person am Inseltag samt Rolle und den Bauplänen, die sie schon gebaut hat. */
export type VisitorPerson = PersonEventDay & Readonly<{ personId: string; role: IslandRole; builtBlueprints: ReadonlySet<string> }>;

/** Was die Erzeugung der Besucher eines Inseltags über die Insel weiß. */
export type VisitorDayInput = Readonly<{
  islandId: string;
  /** Aktueller Inseltag in der Zeitzone der Insel. */
  date: string;
  /** Ereignisse dieses Inseltags, die zum Deckel zählen. */
  cappedToday: number;
  /** Schon vergebene `n` der Anlassschlüssel `tag:‹datum›:‹n›`. */
  visitorSlotsUsed: ReadonlySet<number>;
  unlockedBlueprints: ReadonlySet<string>;
  /** Besuchervorlagen, die gerade mit einem offenen Wunsch auf der Insel sind. */
  openTemplates: ReadonlySet<string>;
  /** Baupläne, die offenen Besuchen schon als Belohnung versprochen sind. */
  promisedBlueprints: ReadonlySet<string>;
  persons: readonly VisitorPerson[];
}>;

export type PlannedVisitor = Readonly<{
  occasionKey: string;
  responsiblePersonId: string;
  templateKey: string;
  details: VisitorEventDetails;
}>;

/**
 * Besucher füllen den Tagesdeckel auf (Schritt 5 in Abschnitt 9): je freiem Platz einer an eine Person, die
 * heute noch eines bekommen darf, in einer aus Insel und Tag abgeleiteten Reihenfolge. Je Besuch leitet sich
 * der Zufall aus Insel und Anlassschlüssel ab; dieselben Fakten ergeben dieselben Besucher.
 */
export function planVisitors(catalog: GameCatalog, input: VisitorDayInput): PlannedVisitor[] {
  const free = freeEventSlots(input.cappedToday);
  if (free === 0 || catalog.visitorTemplates.length === 0) return [];
  const eligible = shuffled(seededRandom(`${input.islandId}:${input.date}`), input.persons.filter(personalEventAllowed));
  const usedSlots = new Set(input.visitorSlotsUsed);
  const openTemplates = new Set(input.openTemplates);
  const promised = new Set(input.promisedBlueprints);
  const visitors: PlannedVisitor[] = [];

  for (const person of eligible) {
    if (visitors.length === free) break;
    let n = 1;
    while (usedSlots.has(n)) n += 1;
    const occasionKey = visitorOccasionKey(input.date, n);
    const random = seededRandom(`${input.islandId}:${occasionKey}`);
    const wish = chooseWish(catalog, { role: person.role, unlockedBlueprints: input.unlockedBlueprints, builtBlueprints: person.builtBlueprints, random });
    if (wish === undefined) continue;
    const away = catalog.visitorTemplates.filter((template) => !openTemplates.has(template.key));
    const template = pick(random, away.length > 0 ? away : catalog.visitorTemplates)!;
    const reward = visitorReward(catalog, { templateKey: template.key, role: person.role, unlockedBlueprints: input.unlockedBlueprints, unavailable: promised, random });
    usedSlots.add(n);
    openTemplates.add(template.key);
    if (reward.type === 'bauplan') promised.add(reward.key);
    visitors.push({
      occasionKey,
      responsiblePersonId: person.personId,
      templateKey: template.key,
      details: { wish: { type: 'bauplan_bauen', blueprintKey: wish }, reward },
    });
  }
  return visitors;
}
