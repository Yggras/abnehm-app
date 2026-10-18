import type { RouteName, RouteTarget } from '@abnehm/contracts/routes';
import type { ReactNode } from 'react';

import { Notice, Text } from '../design';
import { routeCatalog, routeScreen, type TargetOf } from '../navigation';
import { ScreenFrame } from './ScreenFrame';
import { ownerNameOf, shellTexts, titleOf } from './texts';

/** Ein Bildschirm zeigt im Release noch einen Platzhalter: Sein Bereich fehlt in diesem Build. */
export class MissingContributionError extends Error {
  constructor(target: RouteTarget) {
    super(`Integrationsfehler: Für die Route ${target.type} fehlt der Beitrag „${titleOf(target)}“.`);
    this.name = 'MissingContributionError';
  }
}

/**
 * Deutscher Platzhalter für einen Bildschirm, den ein Bereich noch nicht liefert. Nur Development
 * Builds zeigen ihn; in einem Release ist ein fehlender Beitrag ein Integrationsfehler
 * (Spezifikation 0, Abschnitt 6).
 */
export function Placeholder({ target, children }: { target: RouteTarget; children?: ReactNode }) {
  if (!__DEV__) throw new MissingContributionError(target);
  return (
    <ScreenFrame title={titleOf(target)} presentation={routeCatalog[target.type].presentation}>
      <Notice tone="neutral" icon="hammer" text={shellTexts.placeholder} />
      <Text variant="caption" tone="inkMuted">
        {shellTexts.placeholderOwner(ownerNameOf(target))}
      </Text>
      {children}
    </ScreenFrame>
  );
}

/** Routendatei, deren Bildschirm noch fehlt: `export default placeholderRoute('log')`. */
export function placeholderRoute<N extends RouteName>(name: N, fixed?: Omit<TargetOf<N>, 'type'>) {
  return routeScreen(name, Placeholder, fixed);
}
