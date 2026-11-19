import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Notice, Sheet, space, Text } from '../design';
import { openTarget } from '../navigation';
import { ownerName, shellTexts } from '../shell/texts';
import { isTestArtifact } from '../test-artifact';
import { sharedTexts } from './texts';
import type { ResponseCard, SharedCard, ShownEvent, WirShared } from './wir-shared';

// Gemeinsame Bereiche von „Wir“ (Spezifikation 5, Abschnitt 2; #124). `Responses` steht ganz oben,
// `SharedSections` unter Partnerübersicht und Anfeuern: aktive gemeinsame Challenge, aktives
// Gemeinschaftsprojekt, „Neu bei euch“. Ein Bereich ohne Inhalt entfällt still.

/** „Wir“ ist gekoppelt, aber keine `WirContributionSource` angemeldet: im Release ein Integrationsfehler. */
export class MissingWirContributionError extends Error {
  constructor() {
    super('Integrationsfehler: Die Beiträge von „Momo, Insel & Challenges“ für „Wir“ fehlen.');
    this.name = 'MissingWirContributionError';
  }
}

/** Antwortbedürftige Vorgänge: kompakte Karten mit 2-dp-Rahmen in `partner`, neueste zuerst. */
export function Responses({ shared, partnerName }: { shared: WirShared; partnerName: string }) {
  if (shared.type !== 'ready') return null;
  return shared.responses.map((card) => <Response key={card.id} card={card} partnerName={partnerName} />);
}

function Response({ card, partnerName }: { card: ResponseCard; partnerName: string }) {
  const { action } = card;
  return (
    <Card variant="response">
      <View testID={`wir-vorgang-${card.id}`} style={styles.response}>
        <Icon name="heart" tone="partner" />
        <View style={styles.flex}>
          <Text variant="label" accessibilityRole="header">
            {card.title(partnerName)}
          </Text>
          {card.detail === null ? null : (
            <Text variant="caption" tone="inkMuted">
              {card.detail}
            </Text>
          )}
        </View>
        {action === undefined ? null : <Button compact variant="secondary" label={sharedTexts.open} onPress={() => openTarget(action.target)} />}
      </View>
    </Card>
  );
}

/** Challenge, Gemeinschaftsprojekt und „Neu bei euch“; fehlende Spiel-Beiträge als Platzhalter in Test-Artefakten. */
export function SharedSections({ shared }: { shared: WirShared }) {
  switch (shared.type) {
    case 'loading':
      return null;
    case 'missing':
      // Im Release ist ein fehlender Beitrag ein Integrationsfehler, kein stiller Platzhalter (Spezifikation 0,
      // Abschnitt 6). Die App-Sitzung meldet die Quelle vor dem Partnerbereich an und löst sie im selben Durchlauf
      // wieder, ein gekoppeltes „Wir“ ohne Quelle kommt also nur bei einem Integrationsfehler vor.
      if (!isTestArtifact()) throw new MissingWirContributionError();
      return (
        <View testID="wir-spiel-platzhalter" style={styles.group}>
          <Notice tone="neutral" icon="hammer" text={shellTexts.placeholder} />
          <Text variant="caption" tone="inkMuted">
            {shellTexts.placeholderOwner(ownerName('momo'))}
          </Text>
        </View>
      );
    case 'error': {
      const retry = shared.retryAction;
      return (
        <View style={styles.group}>
          <Notice tone="neutral" text={sharedTexts.unavailable} />
          {retry === undefined ? null : <Button variant="secondary" label={sharedTexts.retry} onPress={() => openTarget(retry.target)} />}
        </View>
      );
    }
    case 'ready':
      return (
        <>
          {shared.challenges.map((card) => (
            <SectionCard key={card.id} card={card} testID={`wir-challenge-${card.id}`} />
          ))}
          {shared.projects.map((card) => (
            <SectionCard key={card.id} card={card} testID={`wir-projekt-${card.id}`} />
          ))}
          {shared.news.length === 0 ? null : <News shared={shared} />}
        </>
      );
  }
}

/** Challenge- oder Projektkarte; antippbar, wenn der Beitrag eine Aktion mitbringt. */
function SectionCard({ card, testID }: { card: SharedCard; testID: string }) {
  const { action } = card;
  return (
    <Card
      onPress={action === undefined ? undefined : () => openTarget(action.target)}
      accessibilityLabel={[`${card.eyebrow} ${card.title}`, ...card.lines].join(', ')}
    >
      <View testID={testID} style={styles.tight}>
        <Text variant="caption" tone="inkMuted">
          {card.eyebrow}
        </Text>
        <Text variant="headline" accessibilityRole="header">
          {card.title}
        </Text>
        {card.lines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </View>
    </Card>
  );
}

function News({ shared }: { shared: Extract<WirShared, { type: 'ready' }> }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <Card>
      <View testID="wir-neu-bei-euch" style={styles.group}>
        <Text variant="headline" accessibilityRole="header">
          {sharedTexts.news}
        </Text>
        {shared.news.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
        <Button variant="text" label={sharedTexts.showAll} onPress={() => setHistoryOpen(true)} />
      </View>
      <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} height="full">
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">
            {sharedTexts.news}
          </Text>
          {shared.history.map((week) => (
            <View key={week.monday} testID="wir-verlauf-woche" style={styles.tight}>
              <Text variant="label" tone="inkMuted" accessibilityRole="header">
                {week.label}
              </Text>
              {week.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </View>
          ))}
          <Button variant="text" label={sharedTexts.close} onPress={() => setHistoryOpen(false)} />
        </View>
      </Sheet>
    </Card>
  );
}

function EventRow({ event }: { event: ShownEvent }) {
  return (
    <View testID="wir-ereignis" accessible accessibilityLabel={`${event.text}, ${event.when.spoken}`} style={styles.event}>
      <Icon name={event.icon} tone="partner" />
      <View style={styles.flex}>
        <Text>{event.text}</Text>
        <Text variant="caption" tone="inkMuted">
          {event.when.shown}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[3] },
  tight: { gap: space[1] },
  flex: { flex: 1 },
  response: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  event: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
