import type { MomoAppearance } from '@abnehm/contracts/island';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, color, EnergySymbol, space, Text } from '../design';
import { openTarget } from '../navigation';
import { MomoAppearanceProvider, MomoFigure } from '../shell/MomoFigure';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useTabBarOverlap } from '../shell/tab-bar-overlap';
import { eggTexts, islandTexts } from './texts';

// Laichkugel im Tab „Momo“ (Spezifikation 4, Abschnitte 6 und 7; #180): Ohne Kopplung und bis zum
// Schlüpfen wartet Momo im Ei. Die Tab-Leiste liegt auf dem Tab „Momo“ über dem Inhalt, deshalb hält
// der Rahmen unten ihre Höhe frei.

const laichkugel: MomoAppearance = { stage: 'laichkugel', formKey: null, moodKey: null, accessories: { kopf: null, hals: null } };
/** Größe von Momo in Leerzuständen (80–96 dp, Spezifikation 4, Abschnitt 6). */
const eggSize = 96;

/** Rahmen von Laichkugel und Rollenwahl: Momo im Ei, eine Überschrift und der Inhalt darunter. */
export function EggFrame({ headline, children }: { headline: string; children: ReactNode }) {
  const bottomInset = useTabBarOverlap();
  return (
    <ScreenFrame title={islandTexts.momo} presentation="tab">
      <View style={styles.stage}>
        <View style={styles.egg}>
          <MomoAppearanceProvider appearance={laichkugel}>
            <MomoFigure mood="zufrieden" size={eggSize} />
          </MomoAppearanceProvider>
        </View>
        <Text variant="title" accessibilityRole="header" style={styles.centered}>
          {headline}
        </Text>
      </View>
      {children}
      <View style={{ height: bottomInset }} />
    </ScreenFrame>
  );
}

/** Ohne aktive Kopplung: Momo wartet im Ei, die gesammelte Energie bleibt, Partner einladen oder Code eingeben. */
export function LaichkugelScreen({ energy }: { energy: number }) {
  return (
    <EggFrame headline={eggTexts.waiting}>
      <Text style={styles.centered}>{eggTexts.solo}</Text>
      {energy > 0 ? (
        <View style={styles.energy} accessible accessibilityLabel={eggTexts.energy(energy)}>
          <EnergySymbol />
          <Text variant="label">{eggTexts.energy(energy)}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button block icon="invite" label={eggTexts.invite} onPress={() => openTarget({ type: 'partner.invite' })} />
        <Button block variant="text" label={eggTexts.redeem} onPress={() => openTarget({ type: 'partner.redeem' })} />
      </View>
    </EggFrame>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', gap: space[3], paddingTop: space[4] },
  egg: { backgroundColor: color.momoStage, borderRadius: eggSize, padding: space[3] },
  centered: { textAlign: 'center' },
  energy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  actions: { gap: space[2] },
});
