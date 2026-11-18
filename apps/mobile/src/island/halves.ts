import type { IslandProgress } from '@abnehm/contracts/island';

// Eigene und Partner-Hälfte aus dem Inselfortschritt, aus Sicht der betrachtenden Person (Spezifikation 4,
// Abschnitt 7: eigene Hälfte `self`, Partner `partner`). Genutzt von HUD und `momo.character`.

type Member = IslandProgress['members'][number];

export function halvesFor(progress: IslandProgress, viewerPersonId: string): Readonly<{ own: Member; partner: Member }> {
  const own = progress.members.find((member) => member.personId === viewerPersonId);
  const partner = progress.members.find((member) => member.personId !== viewerPersonId);
  if (own === undefined || partner === undefined) throw new Error('Inselfortschritt ohne die betrachtende Person');
  return { own, partner };
}
