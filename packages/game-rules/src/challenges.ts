import { Instant, localDateAfter, type LocalDate } from '@abnehm/contracts/base';
import type { EffectivePlan } from '@abnehm/contracts/ports';

import type { ChallengeTemplate } from './catalog.ts';

// Gemeinsame Challenges (Spezifikation 4, Abschnitt 10; #19, #210): Fristen und der Challenge-Anteil, den
// die Annahme je Person festschreibt. Grundlage sind die sieben lokalen Tage ab dem Starttag der Person und
// ihr dann gültiger Wochenplan, den App und Server über den `PlanReader` lesen. Die Werte sind Designwerte
// aus #19; die anteilige Regel für nicht tägliche Pläne ist neu festgelegt (nicht belegt).

const hourMs = 60 * 60 * 1000;

/** Ein offener Vorschlag verfällt nach 48 Stunden. */
export const challengeProposalLifetimeMs = 48 * hourMs;

/** Eine Challenge läuft ab der Annahme höchstens sieben mal 24 Stunden. */
export const challengeDurationMs = 7 * 24 * hourMs;

/** Zahl der lokalen Tage, deren Wochenplan den Anteil bestimmt. */
export const challengeDayCount = 7;

const after = (at: Instant, ms: number): Instant => Instant.parse(new Date(Date.parse(at) + ms).toISOString());

/** Verfall eines Vorschlags: 48 Stunden nach dem Vorschlagen. */
export function challengeProposalExpiresAt(proposedAt: Instant): Instant {
  return after(proposedAt, challengeProposalLifetimeMs);
}

/** Ob ein Vorschlag zum Zeitpunkt `now` noch offen sein kann: bis zu seiner Frist, ausschließlich. */
export function proposalOpen(expiresAt: Instant, now: Instant): boolean {
  return Date.parse(now) < Date.parse(expiresAt);
}

/** Ende einer Challenge: Start (Annahme beim Server) plus 7 × 24 Stunden, unabhängig von Zeitumstellungen. */
export function challengeEndsAt(startedAt: Instant): Instant {
  return after(startedAt, challengeDurationMs);
}

/** Die sieben lokalen Tage ab dem Starttag einer Person. */
export function challengeDays(startDate: LocalDate): LocalDate[] {
  return Array.from({ length: challengeDayCount }, (_, index) => localDateAfter(startDate, index));
}

/**
 * Festgeschriebener Anteil einer Person samt der geplanten Tage, auf denen er beruht, oder `passt_nicht`,
 * wenn die Vorlage für sie an keinem Tag geplant ist.
 */
export type ChallengeShare = Readonly<{ type: 'passt'; required: number; planned: number }> | Readonly<{ type: 'passt_nicht' }>;

/** Geplante Tage der Vorlage in der Woche: Tage mit gültigem Plan bzw. mit dem gezählten Baustein. */
export function plannedCount(template: ChallengeTemplate, week: readonly EffectivePlan[]): number {
  assertWeek(week);
  const { measure } = template;
  return week.filter(
    (plan) => plan.type === 'gueltig' && (measure.type === 'tagesziele' || plan.weeklyPlanDay.bausteine.includes(measure.baustein)),
  ).length;
}

/**
 * Challenge-Anteil einer Person aus ihrer Woche (`challengeDays` ab ihrem Starttag):
 *
 * - „Gemeinsam dranbleiben“ (`tagesziele`): die feste Zahl erfüllter Tagesziele;
 * - Baustein-Vorlagen: `ceil(Zähler / Nenner × geplante Tage)`, für „Ernährung im Blick“ und „Gut
 *   getrunken“ also 6 bei sieben geplanten Tagen, für „Aktive Woche“ `ceil(0,8 × geplante Sporteinheiten)`.
 *
 * Ohne geplanten Tag passt die Vorlage nicht; sie lässt sich dann weder vorschlagen noch annehmen.
 */
export function challengeShare(template: ChallengeTemplate, week: readonly EffectivePlan[]): ChallengeShare {
  const planned = plannedCount(template, week);
  if (planned === 0) return { type: 'passt_nicht' };
  return { type: 'passt', required: requiredFor(template, planned), planned };
}

/**
 * Anteil bei vollem Plan, also an allen sieben Tagen geplant: 17 Tagesziele bzw. 6 für „Ernährung im Blick“,
 * „Gut getrunken“ und „Aktive Woche“. Ein Richtwert, wo der eigene Plan die Vorlage gerade nicht trägt.
 */
export function fullPlanRequired(template: ChallengeTemplate): number {
  return requiredFor(template, challengeDayCount);
}

function requiredFor({ measure }: ChallengeTemplate, planned: number): number {
  if (measure.type === 'tagesziele') return measure.required;
  // Ganzzahlig gerechnet, damit kein Rundungsfehler das Aufrunden verschiebt.
  return Math.ceil((measure.numerator * planned) / measure.denominator);
}

function assertWeek(week: readonly EffectivePlan[]) {
  const first = week[0];
  const consecutive = first !== undefined && week.every((plan, index) => plan.localDate === localDateAfter(first.localDate, index));
  if (week.length !== challengeDayCount || !consecutive) {
    throw new RangeError(`Eine Challenge-Woche sind ${challengeDayCount} aufeinanderfolgende lokale Tage`);
  }
}
