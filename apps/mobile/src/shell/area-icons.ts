import type { AreaKey } from '@abnehm/contracts/base';

import type { IconName } from '../design';

/** Symbol je Gesundheitsbereich, gleich auf „Wir“, in „Partner & Freigaben“ und in den Benachrichtigungen. */
export const areaIcons: Readonly<Record<AreaKey, IconName>> = { ernaehrung: 'plate', wasser: 'drop', sport: 'sport', gewicht: 'scale' };
