import type { ReactElement } from 'react';

import type { ActivityLevel } from '@abnehm/contracts/person';
import type { Pace } from '@abnehm/contracts/ports';

import { ListRow } from '../design';
import { activityLevelNames, goalTexts as texts, kcalText, rowLabel } from './texts';

// Herleitung des Kalorienbudgets (Spezifikation 1, Abschnitt 3: Grundumsatz × Aktivitätsstufe − Defizit,
// nie unter der Untergrenze), gemeinsam für die Seite „Ziele“ und Onboarding-Schritt 7 „Ergebnis“.

/** Eine Zeile mit Wert; ihr zugänglicher Name nennt Titel, Wert und Unterzeile. */
export function ValueRow({ title, value, subtitle, label }: { title: string; value: string; subtitle?: string; label?: string }) {
  return <ListRow title={title} value={value} subtitle={subtitle} accessibilityLabel={label ?? rowLabel(title, value, subtitle)} />;
}

/** Zwischenwerte der Rechnung in ganzen kcal. */
export type BudgetDerivationValues = Readonly<{
  basalKcal: number;
  activityLevel: ActivityLevel;
  /** PAL der Aktivitätsstufe; `null`, wenn er sich nicht nachrechnen lässt. */
  activityFactor: number | null;
  totalKcal: number;
  /** Im Haltemodus `null`. */
  deficit: Readonly<{ pace: Pace; kcal: number }> | null;
  lowerBoundKcal: number;
}>;

/** Die Zeilen der Herleitung für eine `ListGroup`, als Liste, damit die Gruppe sie trennt. */
export function budgetDerivationRows({ basalKcal, activityLevel, activityFactor, totalKcal, deficit, lowerBoundKcal }: BudgetDerivationValues): ReactElement[] {
  return [
    <ValueRow key="basal" title={texts.basal} value={kcalText(basalKcal)} />,
    ...(activityFactor === null
      ? []
      : [
          <ValueRow
            key="activity"
            title={texts.activity}
            subtitle={activityLevelNames[activityLevel]}
            value={texts.activityFactor(activityFactor)}
            label={rowLabel(`${texts.activity} ${activityLevelNames[activityLevel]}`, texts.activityFactorSpoken(activityFactor))}
          />,
        ]),
    <ValueRow key="total" title={texts.total} value={kcalText(totalKcal)} />,
    ...(deficit === null
      ? []
      : [
          <ValueRow
            key="deficit"
            title={texts.deficit(deficit.pace)}
            value={texts.deficitValue(deficit.kcal)}
            label={rowLabel(texts.deficit(deficit.pace), texts.deficitSpoken(deficit.kcal))}
          />,
        ]),
    <ValueRow
      key="lower-bound"
      title={texts.lowerBound}
      value={kcalText(lowerBoundKcal)}
      subtitle={texts.lowerBoundHint}
      label={rowLabel(texts.lowerBound, kcalText(lowerBoundKcal))}
    />,
  ];
}
