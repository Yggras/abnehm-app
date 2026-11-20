import type { EntityId } from '@abnehm/contracts/base';
import { ScrollView, StyleSheet, View } from 'react-native';

import { boxShadow, Button, color, radius, size, space, Text } from '../design';
import type { Discovery, IslandEvent, ShownReward, VisitorWish } from './island-events';
import { ObjectPreview } from './ObjectPreview';
import { eventTexts } from './texts';

// Inhalt des Sheets „Ereignisse“ (Spezifikation 4, Abschnitt 9; #202), geöffnet über „Ereignisse“ in der
// Leiste oder die Route `momo` mit `view: 'ereignisse'`. Oben „Neu auf der Insel“: wer seit dem letzten
// Ansehen angekommen ist, also was beim Öffnen neu war. Darunter „Offene Wünsche“ mit „Kein Zeitdruck“ und
// einer Karte je Wunsch, neue eingeschlossen. Jede Karte zeigt den Besucher, seinen Wunsch und die
// Belohnung; ist der Wunsch erfüllt, holt „Belohnung abholen“ sie ab. Was abgeholt ist, bestätigt das Sheet
// oben selbst, denn eine Meldung des Meldungs-Hosts läge auf dem Gerät hinter dem nativen Sheet. Ereignisse verfallen nie, es gibt
// keine Frist und keinen Zähler. Wie Bau-Sheet und Lager in voller Höhe mit scrollender Liste.
//
// Entdeckungen (#204): Ein neues Gebiet steht unter „Neu auf der Insel“ und mit einer Karte unter „Neue
// Gebiete“: die Baupläne, die mit ihm für die Insel freigeschaltet sind, und die Entdeckungs-Deko zum
// Abholen. Ohne Deko (endlose Gebiete) verschwindet die Karte, sobald sie gesehen ist.

export type EventsSheetProps = Readonly<{
  events: readonly IslandEvent[];
  /** Ereignisstände, die beim Öffnen des Sheets neu waren; sie bleiben bis zum Schließen oben. */
  freshAtOpen: ReadonlySet<EntityId>;
  /** Seit dem Öffnen abgeholte Belohnungen; sie stehen als Bestätigung oben. */
  claimed: readonly ShownReward[];
  onClaim(event: IslandEvent): void;
}>;

export function EventsSheet({ events, freshAtOpen, claimed, onClaim }: EventsSheetProps) {
  const fresh = events.filter((event) => freshAtOpen.has(event.stateId));
  const discoveries = events.filter((event): event is Discovery => event.kind === 'entdeckung');
  const wishes = events.filter((event): event is VisitorWish => event.kind === 'besuch');
  return (
    <View style={styles.sheet}>
      <Text variant="title" accessibilityRole="header">
        {eventTexts.title}
      </Text>
      {claimed.map((reward, index) => (
        <View key={`${reward.key}-${index}`} style={styles.claimed} accessibilityLiveRegion="polite">
          <ObjectPreview art={reward.art} />
          <Text variant="bodyStrong" style={styles.text}>
            {eventTexts.claimed(reward)}
          </Text>
        </View>
      ))}
      {events.length === 0 ? (
        <Text tone="inkMuted">{eventTexts.empty}</Text>
      ) : (
        <ScrollView testID="ereignisse" style={styles.scroll} contentContainerStyle={styles.list}>
          {fresh.length > 0 && (
            <View style={styles.section}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {eventTexts.fresh}
              </Text>
              {fresh.map((event) => (
                <View key={event.stateId} style={styles.arrival}>
                  <ObjectPreview art={arrivalOf(event).art} />
                  <Text style={styles.text}>{arrivalOf(event).text}</Text>
                </View>
              ))}
            </View>
          )}
          {discoveries.length > 0 && (
            <View style={styles.section}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {eventTexts.areas}
              </Text>
              {discoveries.map((event) => (
                <DiscoveryCard key={event.stateId} event={event} onClaim={onClaim} />
              ))}
            </View>
          )}
          {wishes.length > 0 && (
            <View style={styles.section}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {eventTexts.wishes}
              </Text>
              <Text variant="label" tone="inkMuted">
                {eventTexts.noPressure}
              </Text>
              {wishes.map((event) => (
                <VisitorCard key={event.stateId} event={event} onClaim={onClaim} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** Bild und Zeile einer Ankunft unter „Neu auf der Insel“, je Ereignisart. */
function arrivalOf(event: IslandEvent): Readonly<{ art: string; text: string }> {
  switch (event.kind) {
    case 'besuch':
      return { art: event.visitor.animal, text: eventTexts.visiting(event.visitor.name) };
    case 'entdeckung':
      return { art: event.art, text: eventTexts.newArea(event.area.name) };
  }
}

function DiscoveryCard({ event, onClaim }: Readonly<{ event: Discovery; onClaim(event: Discovery): void }>) {
  const deko = event.deko.map((piece) => piece.name);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ObjectPreview art={event.art} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{eventTexts.discovered(event.area.name)}</Text>
          {event.blueprints.length > 0 && <Text>{eventTexts.areaBlueprints(event.blueprints.map((blueprint) => blueprint.name))}</Text>}
        </View>
      </View>
      {event.claimable ? (
        <>
          <Text variant="label" tone="inkMuted">
            {eventTexts.areaDeko(deko)}
          </Text>
          <Button block label={eventTexts.claim} accessibilityLabel={eventTexts.claimDeko(deko)} onPress={() => onClaim(event)} />
        </>
      ) : null}
    </View>
  );
}

function VisitorCard({ event, onClaim }: Readonly<{ event: VisitorWish; onClaim(event: VisitorWish): void }>) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ObjectPreview art={event.visitor.animal} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{eventTexts.visiting(event.visitor.name)}</Text>
          <Text>{eventTexts.wish(event.wish.name)}</Text>
        </View>
      </View>
      <View style={styles.reward}>
        <ObjectPreview art={event.reward.art} />
        <Text variant="label" tone="inkMuted" style={styles.text}>
          {eventTexts.reward(event.reward)}
        </Text>
      </View>
      {event.claimable ? (
        <Button block label={eventTexts.claim} accessibilityLabel={eventTexts.claimFor(event.visitor.name)} onPress={() => onClaim(event)} />
      ) : (
        <Text variant="label" tone="inkMuted">
          {eventTexts.howTo(event.wish.name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space[4] },
  scroll: { flex: 1 },
  // Platz unten für die Sockelkante der letzten Karte (`boxShadow` zählt nicht zur Höhe).
  list: { gap: space[5], paddingBottom: size.plinthDepth },
  section: { gap: space[3] },
  card: {
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  arrival: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  claimed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
  },
  reward: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: 120, gap: space[1] },
});
