import type { AreaKey } from '@abnehm/contracts/base';
import { StyleSheet, View } from 'react-native';

import { Button, Card, color, Icon, Notice, radius, size, Skeleton, space, Text, useLargeTextLayout, type IconName } from '../design';
import { openTarget } from '../navigation';
import { MomoFigure } from '../shell/MomoFigure';
import { ScreenFrame } from '../shell/ScreenFrame';
import { usePartner, useWirPartner } from './app-partner';
import type { CoupledPartner, WirPartner } from './partner-view';
import { areaNames, partnerTexts, stageTexts, standText, summaryText, type Spoken } from './texts';

// Tab „Wir“ (Spezifikation 5, Abschnitt 2; #121): ohne Kopplung der Leerzustand „Momo wartet im Ei“,
// gekoppelt die Partnerübersicht und die Anfeuern-Karte. Antwortbedürftige Vorgänge, Challenge,
// Gemeinschaftsprojekt und „Neu bei euch“ (#124), Fotos von heute (#122) und erhaltene Anfeuerungen
// samt „Danke“ (#126) ergänzen ihre Tickets. Partnerinhalte tragen die Partnerfarbe und stehen nie neben
// eigenen Werten.

const areaIcons: Readonly<Record<AreaKey, IconName>> = { ernaehrung: 'plate', wasser: 'drop', sport: 'sport', gewicht: 'scale' };

export function WirScreen() {
  const partner = usePartner();
  const state = useWirPartner(partner);
  return (
    <ScreenFrame title={partnerTexts.title} presentation="tab" onRefresh={partner?.refresh}>
      <WirContent state={state} />
    </ScreenFrame>
  );
}

function WirContent({ state }: { state: WirPartner }) {
  switch (state.type) {
    case 'loading':
      return (
        <View accessible accessibilityLabel={partnerTexts.loading} style={styles.group}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={96} />
        </View>
      );
    case 'solo':
      return <Solo />;
    case 'coupled':
      return <Coupled partner={state} />;
  }
}

/** Leerzustand „ohne Partner“: Momo in der Laichkugel, Tracker allein vollständig, zwei Wege zur Kopplung. */
function Solo() {
  return (
    <Card variant="empty">
      <View testID="wir-solo" style={styles.solo}>
        <MomoFigure mood="neugierig" size={size.momoToday} />
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {partnerTexts.soloTitle}
        </Text>
        <Text style={styles.center}>{partnerTexts.soloBody}</Text>
        <View style={styles.actions}>
          <Button block label={partnerTexts.invite} onPress={() => openTarget({ type: 'partner.invite' })} />
          <Button block variant="text" label={partnerTexts.redeem} onPress={() => openTarget({ type: 'partner.redeem' })} />
        </View>
      </View>
    </Card>
  );
}

function Coupled({ partner }: { partner: Readonly<{ type: 'coupled' } & CoupledPartner> }) {
  const stand = partner.age === null ? null : standText(partner.age, partner.stale);
  return (
    <>
      {partner.stale && stand !== null ? <Notice tone="neutral" icon="offline" text={stand.shown} /> : null}
      <Overview partner={partner} stand={stand} />
      <Card>
        <View testID="wir-anfeuern" style={styles.group}>
          <Text variant="headline" accessibilityRole="header">
            {partnerTexts.encourageTitle}
          </Text>
          <Text>{partnerTexts.encourageBody(partner.displayName)}</Text>
          <Button label={partnerTexts.encourage} onPress={() => openTarget({ type: 'partner.encourage' })} />
        </View>
      </Card>
    </>
  );
}

/** Partnerübersicht: Avatar, Name, grober Tageszielstand und je freigegebenem Bereich eine Zeile. */
function Overview({ partner, stand }: { partner: CoupledPartner; stand: Spoken | null }) {
  const singleColumn = useLargeTextLayout();
  const name = partner.displayName;
  const stage = partner.dailyGoal === null ? partnerTexts.noStatusYet : stageTexts[partner.dailyGoal.stage];
  const spokenStand = stand === null ? '' : `, ${stand.spoken}`;
  return (
    <Card>
      <View testID="wir-partneruebersicht" style={styles.group}>
        <View accessible accessibilityRole="header" accessibilityLabel={`${name}, Tagesziele: ${stage}${spokenStand}`} style={styles.person}>
          <View style={styles.avatar}>
            <Text variant="title" tone="onPrimary">
              {[...name][0]!.toLocaleUpperCase('de-DE')}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text variant="headline">{name}</Text>
            <Text tone="inkMuted">{stage}</Text>
          </View>
        </View>
        {partner.summaries.map((summary) => {
          const value = summaryText(summary);
          const area = areaNames[summary.type];
          return (
            <View
              key={summary.type}
              testID={`wir-bereich-${summary.type}`}
              accessible
              accessibilityLabel={`${name}, ${area}: ${value.spoken}${spokenStand}`}
              style={[styles.row, singleColumn && styles.stacked]}
            >
              <View style={styles.rowLabel}>
                <Icon name={areaIcons[summary.type]} tone="partner" />
                <Text variant="label" tone="inkMuted">
                  {area}
                </Text>
              </View>
              <Text variant="bodyStrong" style={!singleColumn && styles.value}>
                {value.shown}
              </Text>
            </View>
          );
        })}
        {stand !== null && !partner.stale ? (
          <Text variant="caption" tone="inkMuted">
            {stand.shown}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[3] },
  solo: { alignItems: 'center', gap: space[3] },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space[2] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  // Weiß auf `partner` nur als großer, fetter Text (research/design-system.md, Kontrasttabelle).
  avatar: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: radius.pill,
    backgroundColor: color.partner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.touchMin, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[2] },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: space[1] },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
  value: { flex: 1, textAlign: 'right' },
});
