import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { weekdayOf } from '@abnehm/contracts/base';
import { EffectivePlan, type PlanReader } from '@abnehm/contracts/ports';

import { goalVersion, weeklyPlanDay, weeklyPlanVersion } from '../db/schema/index.ts';
import type { ReaderPort } from '../partner-projections/projector.ts';

/**
 * `PlanReader` über Postgres (Spezifikation 0, Abschnitt 3), in der Transaktion des Aufrufers. Er
 * liefert je Tag die Zielversion und die Wochenplanversion mit dem größten `valid_from` ≤ Tag, von dieser
 * den Wochentag des Tags, oder ausdrücklich `leer`, solange eine der beiden fehlt. Serverseitig lesen
 * nur die Projectors aus Spezifikation 3 und der Challenge-Dienst aus Spezifikation 4 darüber.
 */
export const postgresPlanReader: ReaderPort<PlanReader> = (tx) => ({
  async effectivePlan(personId, localDate) {
    const [goal] = await tx
      .select()
      .from(goalVersion)
      .where(and(eq(goalVersion.personId, personId), lte(goalVersion.validFrom, localDate), isNull(goalVersion.deletedAt)))
      .orderBy(desc(goalVersion.validFrom))
      .limit(1);
    const [plan] = await tx
      .select({ id: weeklyPlanVersion.id, validFrom: weeklyPlanVersion.validFrom })
      .from(weeklyPlanVersion)
      .where(and(eq(weeklyPlanVersion.personId, personId), lte(weeklyPlanVersion.validFrom, localDate), isNull(weeklyPlanVersion.deletedAt)))
      .orderBy(desc(weeklyPlanVersion.validFrom))
      .limit(1);
    if (goal === undefined || plan === undefined) return EffectivePlan.parse({ type: 'leer', localDate });
    const [day] = await tx
      .select()
      .from(weeklyPlanDay)
      .where(and(eq(weeklyPlanDay.weeklyPlanVersionId, plan.id), eq(weeklyPlanDay.weekday, weekdayOf(localDate))));
    return EffectivePlan.parse({
      type: 'gueltig',
      localDate,
      goal: {
        id: goal.id,
        validFrom: goal.validFrom,
        calorieBudgetMilliKcal: goal.calorieBudgetMilliKcal,
        lowerBoundMilliKcal: goal.lowerBoundMilliKcal,
        maintenanceReason: goal.maintenanceReason,
        pace: goal.pace,
        goalWeightG: goal.goalWeightG,
        waterTargetMl: goal.waterTargetMl,
        weeklySportTargetMinutes: goal.weeklySportTargetMinutes,
      },
      weeklyPlanDay: {
        weeklyPlanVersionId: plan.id,
        validFrom: plan.validFrom,
        bausteine: day === undefined ? undefined : [day.baustein1, day.baustein2, day.baustein3],
      },
    });
  },
});
