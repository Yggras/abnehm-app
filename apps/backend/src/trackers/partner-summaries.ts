import { and, between, eq, inArray, lte, or } from 'drizzle-orm';

import type { PlanReader } from '@abnehm/contracts/ports';
import { countedWaterMl, dayWeights, weekMinutes, weightChange, weightTrend } from '@abnehm/contracts/tracker-rules';

import { sportEntry, waterEntry, weightEntry } from '../db/schema/index.ts';
import type { PartnerSummaryProjector, ReaderPort } from '../partner-projections/projector.ts';

// Partner-Zusammenfassungen der Tracker (Spezifikation 3, Abschnitt 7; Spezifikation 0, Abschnitt 5;
// #181). Die drei Projectors lesen nur die Tabellen von Wasser, Sport und Gewicht und bekommen den
// `PlanReader` injiziert; die Importgrenze dafür prüft `npm run lint`. Gezählt und gerechnet wird mit den Tracker-Regeln aus dem Vertragsmodul, also
// genau wie in der App. Der Inhalt enthält nur die Werte des Vertrags: nie Einträge, Mengen, Tages- oder
// Trendgewichte oder das Zielgewicht.

type Ports = Readonly<{ planReader: ReaderPort<PlanReader> }>;

const iso = (at: Date | null) => (at === null ? null : at.toISOString());

/**
 * Wasser: `round(100 × gezählte ml ÷ Wasserziel)`, bei 100 gedeckelt; ohne Einträge 0. Ohne gültige
 * Zielversion gibt es kein Wasserziel und damit noch nichts zu zeigen.
 */
function waterProjector({ planReader }: Ports): PartnerSummaryProjector<'wasser'> {
  return {
    area: 'wasser',
    async project(tx, { ownerPersonId, period }) {
      const plan = await planReader(tx).effectivePlan(ownerPersonId, period.localDate);
      if (plan.type === 'leer') return null;
      const rows = await tx
        .select({ amountMl: waterEntry.amountMl, localDate: waterEntry.localDate, deletedAt: waterEntry.deletedAt })
        .from(waterEntry)
        .where(and(eq(waterEntry.personId, ownerPersonId), eq(waterEntry.localDate, period.localDate)));
      const ml = countedWaterMl(rows.map((row) => ({ ...row, deletedAt: iso(row.deletedAt) })), period.localDate);
      return { progressPercent: Math.min(100, Math.round((100 * ml) / plan.goal.waterTargetMl)) };
    },
  };
}

/**
 * Sport: zählende Minuten der Woche von Montag bis Sonntag und das Sportwochenziel der Zielversion von
 * heute, wie im Sport-Mini-Tracker der App; ohne Zielversion noch nichts. Ob eine ersetzte Einheit wieder zählt, hängt am ersetzenden
 * Import; der kann im Nachbartag vor oder nach der Woche liegen und wird deshalb mitgelesen.
 */
function sportProjector({ planReader }: Ports): PartnerSummaryProjector<'sport'> {
  return {
    area: 'sport',
    async project(tx, { ownerPersonId, period, today }) {
      const own = eq(sportEntry.personId, ownerPersonId);
      const inWeek = between(sportEntry.localDate, period.from, period.to);
      // Dieselbe Auswahl wie die Sportwoche der App (`apps/mobile/src/trackers/sport-repository.ts`) über SQLite.
      const replacingImports = tx.select({ id: sportEntry.replacedByEntryId }).from(sportEntry).where(and(own, inWeek));
      const rows = await tx.select().from(sportEntry).where(and(own, or(inWeek, inArray(sportEntry.id, replacingImports))));
      const minutes = weekMinutes(
        rows.map((row) => ({ ...row, deletedAt: iso(row.deletedAt), hiddenAt: iso(row.hiddenAt), reactivatedAt: iso(row.reactivatedAt) })),
        period.from,
      );
      const plan = await planReader(tx).effectivePlan(ownerPersonId, today);
      // Ohne gültige Zielversion gibt es kein Sportwochenziel und damit noch nichts zu zeigen.
      if (plan.type === 'leer') return null;
      return { countedMinutes: minutes, weeklyTargetMinutes: plan.goal.weeklySportTargetMinutes };
    },
  };
}

/**
 * Gewicht: `changeKg` und Richtung über die 14 Tage bis heute nach den Tracker-Regeln. Der Trend braucht
 * alle Tagesgewichte bis zum Ende des Zeitraums, auch die vor seinem Beginn.
 */
function weightProjector(): PartnerSummaryProjector<'gewicht'> {
  return {
    area: 'gewicht',
    async project(tx, { ownerPersonId, period }) {
      const rows = await tx
        .select({ weightG: weightEntry.weightG, measuredAt: weightEntry.measuredAt, localDate: weightEntry.localDate, deletedAt: weightEntry.deletedAt, hiddenAt: weightEntry.hiddenAt })
        .from(weightEntry)
        .where(and(eq(weightEntry.personId, ownerPersonId), lte(weightEntry.localDate, period.to)));
      const facts = rows.map((row) => ({ ...row, measuredAt: row.measuredAt.toISOString(), deletedAt: iso(row.deletedAt), hiddenAt: iso(row.hiddenAt) }));
      const { changeKg, direction } = weightChange(weightTrend(dayWeights(facts)), period.to);
      return changeKg === null ? { changeKg, direction: 'noch_nicht_verfuegbar' } : { changeKg, direction };
    },
  };
}

/** Je Tracker-Bereich sein Projector, nach Bereich getypt. */
export type TrackerPartnerSummaryProjectors = { readonly [A in 'wasser' | 'sport' | 'gewicht']: PartnerSummaryProjector<A> };

/** Die Projectors der Bereiche `wasser`, `sport` und `gewicht`, je Bereich genau einer. */
export function trackerPartnerSummaryProjectors(ports: Ports): TrackerPartnerSummaryProjectors {
  return { wasser: waterProjector(ports), sport: sportProjector(ports), gewicht: weightProjector() };
}
