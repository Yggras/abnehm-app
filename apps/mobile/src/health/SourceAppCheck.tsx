import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ImportOrigin } from '@abnehm/contracts/trackers';

import { Card, ListGroup, ListRow, Notice, Skeleton, space, Text } from '../design';
import { fitbitSourceAppId, sourceAppText } from '../trackers/entry-texts';
import type { HealthOrigin, HealthPlatformAdapter } from './platform';
import { healthTexts } from './texts';

// Prüfung der Quell-Apps samt Anleitung „Fitbit-Daten fehlen?“ (Spezifikation 3, Abschnitt 6): Onboarding-
// Schritt `health` (#189) zeigt sie nach dem Verbinden, die Einstellungsseite Health (#190) nutzt dieselben
// Bausteine. Gelesen wird nur über den Health-Plattform-Adapter. Alle Zustände sind neutral: Ohne Daten oder
// ohne Google Health (Fitbit) bleibt alles manuell nutzbar, und iOS lässt eine Verweigerung nicht erkennen.

/** Zeitraum der Prüfung in Tagen. */
const checkDays = 30;

type Check = Readonly<{ type: 'laedt' }> | Readonly<{ type: 'fehlgeschlagen' }> | Readonly<{ type: 'geprueft'; origins: readonly HealthOrigin[] }>;

/**
 * Gruppiert die Trainings und Gewichte der letzten 30 Tage nach Quell-App. Fehlt Google Health (Fitbit),
 * folgt die Anleitung als nicht blockierender Hinweis.
 */
export function SourceAppCheck({ platform }: { platform: HealthPlatformAdapter }) {
  const check = useRecentOrigins(platform);
  return (
    <View style={styles.check}>
      <Text variant="headline" accessibilityRole="header">
        {healthTexts.sourceAppsTitle}
      </Text>
      <CheckResult check={check} />
      {check.type === 'geprueft' && !check.origins.some(({ sourceApp }) => sourceApp.id === fitbitSourceAppId) ? <FitbitGuide origin={platform.origin} /> : null}
    </View>
  );
}

/** Anleitung „Fitbit-Daten fehlen?“ für die Plattform der Herkunft: Apple Health bzw. Health Connect. */
export function FitbitGuide({ origin }: { origin: ImportOrigin }) {
  return (
    <Card>
      <View style={styles.guide}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {healthTexts.guideTitle}
        </Text>
        <Text>{healthTexts.guide[origin]}</Text>
      </View>
    </Card>
  );
}

function CheckResult({ check }: { check: Check }) {
  switch (check.type) {
    case 'laedt':
      return (
        <View accessible accessibilityLabel={healthTexts.sourceAppsLoading}>
          <Skeleton height={48} />
        </View>
      );
    case 'fehlgeschlagen':
      return <Notice tone="neutral" text={healthTexts.checkFailed} />;
    case 'geprueft':
      if (check.origins.length === 0) return <Notice tone="neutral" icon="pulse" text={healthTexts.noData} />;
      return (
        <ListGroup>
          {check.origins.map(({ sourceApp, workouts, weights }) => {
            const name = sourceAppText(sourceApp.id, sourceApp.name) ?? sourceApp.id;
            const counts = healthTexts.originCounts(workouts, weights);
            return <ListRow key={sourceApp.id} title={name} subtitle={counts} accessibilityLabel={`${name}, ${counts}`} />;
          })}
        </ListGroup>
      );
  }
}

/** Liest die Quell-Apps einmal je Adapter; ein Fehler bleibt still und zeigt nur den neutralen Hinweis. */
function useRecentOrigins(platform: HealthPlatformAdapter): Check {
  const [check, setCheck] = useState<Readonly<{ platform: HealthPlatformAdapter; check: Check }> | null>(null);
  useEffect(() => {
    let current = true;
    platform.recentOrigins(checkDays).then(
      (origins) => current && setCheck({ platform, check: { type: 'geprueft', origins } }),
      () => current && setCheck({ platform, check: { type: 'fehlgeschlagen' } }),
    );
    return () => {
      current = false;
    };
  }, [platform]);
  return check !== null && check.platform === platform ? check.check : { type: 'laedt' };
}

const styles = StyleSheet.create({
  check: { gap: space[3] },
  guide: { gap: space[2] },
});
