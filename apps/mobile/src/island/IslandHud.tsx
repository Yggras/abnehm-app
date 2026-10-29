import type { IslandProgress } from '@abnehm/contracts/island';
import type { Season } from '@abnehm/game-rules/catalog';
import { StyleSheet, View } from 'react-native';

import { boxShadow, color, EnergySymbol, Icon, IconButton, LevelBar, radius, space, Text, useLargeTextLayout } from '../design';
import type { Daytime } from './scene-model';
import { islandTexts } from './texts';

export type IslandHudProps = {
  season: Season;
  daytime: Daytime;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  progress: IslandProgress;
  viewerPersonId: string;
  partnerName: string;
  /** Bereichsansicht eingeschaltet. */
  areas: boolean;
  onToggleAreas: () => void;
};

/**
 * HUD oben auf der Insel (Spezifikation 4, Abschnitt 7): Jahreszeit mit Tageszeit, eigene Energie,
 * Schalter „Bereiche“ und der Levelbalken. Jahreszeit und Energie sind Anzeigen ohne Sockelkante,
 * damit sie nicht wie Buttons aussehen (Impeccable-Prüfung, B19). Ab Schriftfaktor 1,3 bricht die
 * obere Zeile um (B12).
 */
export function IslandHud({ season, daytime, energy, progress, viewerPersonId, partnerName, areas, onToggleAreas }: IslandHudProps) {
  const large = useLargeTextLayout();
  const own = progress.members.find((member) => member.personId === viewerPersonId);
  const partner = progress.members.find((member) => member.personId !== viewerPersonId);
  return (
    <View style={styles.hud}>
      <View style={[styles.row, large && styles.wrap]}>
        <View style={styles.label}>
          <Icon name={daytime === 'abend' ? 'moon' : 'sun'} size="sm" tone="inkMuted" />
          <Text variant="label">{`${islandTexts.season[season]} · ${islandTexts.daytime[daytime]}`}</Text>
        </View>
        <View style={styles.spacer} />
        <View accessible accessibilityLabel={islandTexts.energy(energy)} style={styles.label}>
          <EnergySymbol size="sm" />
          <Text variant="bodyStrong">{String(energy)}</Text>
        </View>
        <IconButton icon="layers" accessibilityLabel={islandTexts.areas} checked={areas} onPress={onToggleAreas} />
      </View>
      <View style={styles.card}>
        <LevelBar
          level={progress.level}
          ownPercent={own?.halfPercent ?? 0}
          partnerPercent={partner?.halfPercent ?? 0}
          partnerName={partnerName}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  wrap: { flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.surfaceCard,
  },
  card: { padding: space[3], borderRadius: radius.md, backgroundColor: color.surfaceCard, boxShadow: boxShadow.card },
});
