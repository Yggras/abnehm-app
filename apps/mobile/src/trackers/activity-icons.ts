import type { ActivityType } from '@abnehm/contracts/trackers';

import type { IconName } from '../design';

/** Symbol je Aktivitätsart (#38); Krafttraining ist die Hantel `sport`, Sonstiges der Puls `pulse`. */
export const activityIcons: Readonly<Record<ActivityType, IconName>> = {
  gehen: 'walk',
  laufen: 'run',
  radfahren: 'bike',
  schwimmen: 'swim',
  krafttraining: 'sport',
  yoga_dehnen: 'yoga',
  mannschaftssport: 'ball',
  sonstiges: 'pulse',
};
