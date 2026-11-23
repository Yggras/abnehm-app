import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, color, Icon, Notice, size, Skeleton, space, Text, useLargeTextLayout } from '../design';
import { openTarget } from '../navigation';
import { MomoFigure } from '../momo';
import { areaIcons } from '../shell/area-icons';
import { ScreenFrame } from '../shell/ScreenFrame';
import { usePartner, useWirPartner, useWirShared } from './app-partner';
import type { Partner } from './partner';
import type { PartnerPhotos } from './partner-photos';
import { PartnerAvatar } from './PartnerAvatar';
import { PartnerStage } from './PartnerStage';
import { partnerActions, type CoupledPartner, type WirPartner } from './partner-view';
import { areaNames, partnerHeadline, partnerTexts, standText, summaryText, type Spoken } from './texts';
import type { WirShared } from './wir-shared';
import { PhotosRow, useTodayPhotos, type TodayPhotos } from './WirPhotos';
import { Responses, SharedSections } from './WirShared';

// Tab „Wir“ (Spezifikation 5, Abschnitt 2; #121, #124): ohne Kopplung der Leerzustand „Momo wartet im Ei“,
// gekoppelt antwortbedürftige Vorgänge, Partnerübersicht, Anfeuern-Karte, Challenge, Gemeinschaftsprojekt und
// „Neu bei euch“. „Fotos von heute“ (#122) steht beim Bereich Ernährung; erhaltene Anfeuerungen samt „Danke“
// (#126) ergänzt ihr Ticket.
// Partnerinhalte tragen die Partnerfarbe und stehen nie neben eigenen Werten.


export function WirScreen() {
  const partner = usePartner();
  const state = useWirPartner(partner);
  const shared = useWirShared(partner);
  const photos = useTodayPhotos(partner?.photos ?? null, state.type === 'coupled' && state.online);
  // Pull-to-Refresh startet den Sync und lädt „Fotos von heute“ neu (Spezifikation 5, Abschnitt 2).
  const refresh = partner === null ? undefined : () => Promise.all([partner.refresh(), photos.reload()]);
  return (
    <ScreenFrame title={partnerTexts.title} presentation="tab" onRefresh={refresh}>
      <WirContent partner={partner} state={state} shared={shared} photos={photos} />
    </ScreenFrame>
  );
}

function WirContent({ partner, state, shared, photos }: { partner: Partner | null; state: WirPartner; shared: WirShared; photos: TodayPhotos }) {
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
      return <Coupled partner={state} shared={shared} photos={partner === null ? null : { source: partner.photos, photos: photos.photos }} />;
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
          <Button block label={partnerTexts.invite} onPress={() => openTarget(partnerActions.invite.target)} />
          <Button block variant="text" label={partnerTexts.redeem} onPress={() => openTarget(partnerActions.redeem.target)} />
        </View>
      </View>
    </Card>
  );
}

/**
 * Feste Reihenfolge nach Spezifikation 5, Abschnitt 2: antwortbedürftige Vorgänge, Partnerübersicht (mit dem
 * neutralen Offline-Hinweis darüber), Anfeuern, Challenge, Gemeinschaftsprojekt, „Neu bei euch“.
 */
function Coupled({ partner, shared, photos }: { partner: Readonly<{ type: 'coupled' } & CoupledPartner>; shared: WirShared; photos: OverviewPhotos }) {
  const stand = partner.age === null ? null : standText(partner.age, partner.stale);
  return (
    <>
      <Responses shared={shared} partnerName={partner.displayName} />
      {partner.stale ? <Notice tone="neutral" icon="offline" text={stand?.shown ?? partnerTexts.offline} /> : null}
      <Overview partner={partner} stand={stand} photos={photos} />
      <Card>
        <View testID="wir-anfeuern" style={styles.group}>
          <Text variant="headline" accessibilityRole="header">
            {partnerTexts.encourage}
          </Text>
          <Text>{partnerTexts.encourageBody(partner.displayName)}</Text>
          <Button label={partnerTexts.encourage} onPress={() => openTarget(partnerActions.encourage.target)} />
        </View>
      </Card>
      <SharedSections shared={shared} />
    </>
  );
}

/** „Fotos von heute“ samt dem Partnerbereich, der die Bilder abruft; `null` ohne geöffnetes Konto. */
type OverviewPhotos = Readonly<{ source: PartnerPhotos; photos: TodayPhotos['photos'] }> | null;

/**
 * Partnerübersicht: Avatar, Name, grober Tageszielstand und je freigegebenem Bereich eine Zeile. „Fotos von heute“
 * steht beim Bereich Ernährung, also direkt nach dessen Zeile oder, ohne Ernährungsfreigabe, an ihrer Stelle.
 */
function Overview({ partner, stand, photos }: { partner: CoupledPartner; stand: Spoken | null; photos: OverviewPhotos }) {
  const singleColumn = useLargeTextLayout();
  const name = partner.displayName;
  const stage = partner.dailyGoal?.stage ?? null;
  const spokenStand = stand === null ? '' : `, ${stand.spoken}`;
  const nutritionIndex = partner.summaries.findIndex((summary) => summary.type === 'ernaehrung');
  /** Die Fotozeile hinter der Zeile `index`; `-1` steht vor allen Bereichen. */
  const photosAt = (index: number) =>
    photos !== null && index === nutritionIndex ? <PhotosRow source={photos.source} name={name} photos={photos.photos} /> : null;
  return (
    <Card>
      <View testID="wir-partneruebersicht" style={styles.group}>
        <View accessible accessibilityRole="header" accessibilityLabel={partnerHeadline(name, stage, stand)} style={styles.person}>
          <PartnerAvatar displayName={name} />
          <View style={styles.flex}>
            <Text variant="headline">{name}</Text>
            {stage === null ? null : <PartnerStage stage={stage} />}
          </View>
        </View>
        {photosAt(-1)}
        {partner.summaries.map((summary, index) => {
          const value = summaryText(summary);
          const area = areaNames[summary.type];
          return (
            <Fragment key={summary.type}>
              <View
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
                <Text style={!singleColumn && styles.value}>
                  {value.shown}
                </Text>
              </View>
              {photosAt(index)}
            </Fragment>
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
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.touchMin, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[2] },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: space[1] },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
  value: { flex: 1, textAlign: 'right' },
});
