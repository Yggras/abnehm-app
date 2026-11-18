import type { EntityId } from '@abnehm/contracts/base';
import { LatestWeight, WeightTrendSeries, type WeightTrendReader } from '@abnehm/contracts/ports';
import { dayWeights, showsTrend, weightTrend, type TrendPoint } from '@abnehm/contracts/tracker-rules';
import type { z } from 'zod';

import { PortContractError, type ReadAccess } from '../area-ports';
import type { ReadContext } from '../local-db';
import { weightEntriesOf } from './weight-repository';

// Lesender Port `WeightTrendReader` (Spezifikation 0, Abschnitt 3; Spezifikation 3, Abschnitt 7): Über ihn
// berechnet *Ziele & Onboarding* Budgetvorschlag und „Zielgewicht erreicht“. Er liest nur SQLite, in einer
// Lesetransaktion, und rechnet mit denselben Tracker-Regeln wie Detailbildschirm und Mini-Tracker. Jede
// Rückgabe prüft er gegen ihr Vertragsschema und meldet einen Verstoß wie die Port-Prüfung des Composition
// Root als `PortContractError`; so gilt die Prüfung auch, solange er einzeln übergeben wird.

/** Gewichtstrend der Person nach jedem Tagesgewicht, aufsteigend; zählende Einträge, auch importierte. */
export function trendPointsOf(tx: ReadContext, personId: EntityId): TrendPoint[] {
  return weightTrend(dayWeights(weightEntriesOf(tx, personId)));
}

export function createWeightTrendReader(db: ReadAccess): WeightTrendReader {
  return {
    async series(personId, from, to) {
      const points = db.read((tx) => trendPointsOf(tx, personId));
      return checked('series', WeightTrendSeries, points.filter((point) => point.localDate >= from && point.localDate <= to));
    },
    async latest(personId) {
      const points = db.read((tx) => trendPointsOf(tx, personId));
      const last = points.at(-1);
      return checked('latest', LatestWeight, {
        lastDayWeight: last === undefined ? null : { localDate: last.localDate, dayWeightG: last.dayWeightG },
        dayWeightCount: points.length,
        trend: last !== undefined && showsTrend(points.length) ? { type: 'verfuegbar', trendG: last.trendG } : { type: 'noch_nicht_verfuegbar' },
      });
    },
  };
}

function checked<S extends z.ZodType>(method: string, schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PortContractError('weightTrendReader', method, parsed.error.issues);
  return parsed.data;
}
