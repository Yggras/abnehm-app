import { createSystemClock } from '@abnehm/clock';
import { getCalendars } from 'expo-localization';

/** Die aktuelle IANA-Zone des Geräts; wird bei jedem Ablesen neu erfragt (Reisen). */
function deviceTimeZone(): string {
  return getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Produktionsuhr der App: Systemzeit und Gerätezone. */
export const deviceClock = createSystemClock({ timeZone: deviceTimeZone });
