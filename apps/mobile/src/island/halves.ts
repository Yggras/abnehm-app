import type { IslandProgress } from '@abnehm/contracts/island';
import { memberHalf, type MemberHalf } from '@abnehm/game-rules/progress';

// Levelbalken aus Sicht der betrachtenden Person (Spezifikation 4, Abschnitte 7 und 11): eigene Hälfte
// `self`, Partner `partner`. Level und Partnerhälfte kommen aus dem Inselfortschritt des Servers. Die
// eigene Hälfte ist lokal sofort wirksam: Sie folgt aus den eigenen Buchungen, auch offline, auf dem
// Level der Projektion. Einen Levelaufstieg gibt es deshalb erst über den Sync. Genutzt von HUD und
// `momo.character`.

export type IslandHalves = Readonly<{
  level: number;
  own: MemberHalf;
  partner: MemberHalf;
  /**
   * „Deine Hälfte ist voll – Momo wartet auf ‹Name›“: Die eigene Hälfte ist voll, das Level in der
   * Projektion aber noch nicht erreicht, weil die Partnerhälfte noch nicht voll ist. Sind lokal beide
   * voll, steht nur der Sync aus, und niemand wartet auf den Partner.
   */
  waitingForPartner: boolean;
}>;

/** `ownSpent` ist die eigene verbaute Energie dieser Insel (`spentOnIsland`) aus den lokalen Buchungen. */
export function halvesFor(progress: IslandProgress, viewerPersonId: string, ownSpent: number): IslandHalves {
  const partner = progress.members.find((member) => member.personId !== viewerPersonId);
  if (partner === undefined || !progress.members.some((member) => member.personId === viewerPersonId)) {
    throw new Error('Inselfortschritt ohne die betrachtende Person');
  }
  const own = memberHalf(ownSpent, progress.level);
  const partnerHalf = { halfPercent: partner.halfPercent, halfFull: partner.halfFull };
  return { level: progress.level, own, partner: partnerHalf, waitingForPartner: own.halfFull && !partnerHalf.halfFull };
}
