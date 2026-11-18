import type { PartnerDailyGoalStage } from '@abnehm/contracts/partner';

import { Text } from '../design';
import { partnerTexts, stageTexts } from './texts';

/**
 * Grober Tageszielstand des Partners auf „Wir“ und der Partner-Karte von „Heute“: sichtbar mit seinem
 * Bezug „Tagesziele“, die Stufe hervorgehoben. Sie ist die Antwort auf „Wie geht es ihr heute?“ und
 * steht deshalb kräftiger als die Zusammenfassungen (Impeccable-Kritik zu #121, beide P2).
 */
export function PartnerStage({ stage }: { stage: PartnerDailyGoalStage }) {
  return (
    <Text variant="bodyStrong">
      <Text variant="label" tone="inkMuted">
        {`${partnerTexts.stageLabel}: `}
      </Text>
      {stageTexts[stage]}
    </Text>
  );
}
