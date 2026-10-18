import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useClock } from '../../clock/clock-context';
import { deviceHaptics } from '../../haptics/device-haptics';
import { Button, IconButton } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { EnergySymbol, Icon } from '../Icon';
import { iconShapes, type IconName } from '../icon-shapes';
import { ListGroup, ListRow } from '../ListRow';
import { useReducedMotion } from '../motion';
import { ContextMenu } from '../native/ContextMenu';
import { DateTimePicker } from '../native/DateTimePicker';
import { Sheet } from '../native/Sheet';
import { Switch } from '../native/Switch';
import { Notice } from '../Notice';
import { ProgressBar } from '../ProgressBar';
import { Skeleton } from '../Skeleton';
import { Text } from '../Text';
import { useLargeTextLayout } from '../text-scale';
import { Toast } from '../Toast';
import { color, fontFamily, space, type, type TypeToken } from '../tokens';

// Komponentenkatalog (#95), nur im Development Build erreichbar: zeigt alle Primitiven des
// Design-Systems in ihren Zuständen und dient als Grundlage für Gerätesmoke und Impeccable-Prüfung.
// Gedrückte Zustände zeigt er über `testOnly_pressed` von `Pressable`.

const noop = () => {};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.specimen}>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
      {children}
    </View>
  );
}

function DeviceCheck() {
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  return (
    <Card>
      <Text variant="title">Gerätesmoke</Text>
      <Text>
        {Platform.OS === 'ios' ? 'iOS' : 'Android'} {String(Platform.Version)} · Schriftfaktor{' '}
        {fontScale.toLocaleString('de-DE')}
      </Text>
      <Text>Bewegung reduzieren: {reduceMotion ? 'an' : 'aus'}</Text>
      <Text tone="inkMuted" variant="label">
        Prüfen: Rubik in vier Schnitten, Sockelkante unten, dezente Haptik.
      </Text>
    </Card>
  );
}

const weights: [keyof typeof fontFamily, string][] = [
  ['regular', '400 Regular'],
  ['medium', '500 Medium'],
  ['semibold', '600 SemiBold'],
  ['bold', '700 Bold'],
];

function Typography() {
  return (
    <Section title="Schrift">
      <Card>
        {weights.map(([weight, name]) => (
          <Text key={weight} style={{ fontFamily: fontFamily[weight] }}>
            Rubik {name} · Gemeinsam leichter 1.234
          </Text>
        ))}
      </Card>
      <Card>
        {(Object.keys(type) as TypeToken[]).map((variant) => (
          <Text key={variant} variant={variant}>
            {variant === 'numberXl' || variant === 'numberM' ? `${variant} 1.210` : `${variant} · Tagesziel`}
          </Text>
        ))}
      </Card>
    </Section>
  );
}

function Plinth() {
  return (
    <Section title="Sockelkante">
      <Text tone="inkMuted" variant="label">
        Die Kante liegt bei Karte und Buttons unten. Liegt sie oben, wird nur der Adapter in elevation.ts korrigiert.
      </Text>
      <Card>
        <Text>Karte auf elevation-card</Text>
      </Card>
      <View style={styles.row}>
        <Button label="Primär" onPress={noop} />
        <Button label="Sekundär" variant="secondary" onPress={noop} />
        <IconButton icon="gear" accessibilityLabel="Einstellungen" onPress={noop} />
      </View>
    </Section>
  );
}

function Buttons() {
  return (
    <Section title="Buttons">
      {(['primary', 'secondary', 'text'] as const).map((variant) => (
        <Specimen key={variant} label={`${variant}: Standard · gedrückt · deaktiviert · lädt`}>
          <View style={styles.row}>
            <Button label="Speichern" variant={variant} onPress={noop} />
            <Button label="Speichern" variant={variant} onPress={noop} testOnly_pressed />
            <Button label="Speichern" variant={variant} onPress={noop} disabled />
            <Button label="Speichern" variant={variant} onPress={noop} loading />
          </View>
        </Specimen>
      ))}
      <Specimen label="mit Icon · kompakt · volle Breite">
        <View style={styles.row}>
          <Button label="Anfeuern" icon="heart" onPress={noop} />
          <Button label="+250 ml" variant="secondary" compact onPress={noop} />
        </View>
        <Button label="Bauen" icon="hammer" block onPress={noop} />
      </Specimen>
      <Specimen label="Icon-Button: Standard · gedrückt · deaktiviert">
        <View style={styles.row}>
          <IconButton icon="close" accessibilityLabel="Schließen" onPress={noop} />
          <IconButton icon="close" accessibilityLabel="Schließen" onPress={noop} testOnly_pressed />
          <IconButton icon="close" accessibilityLabel="Schließen" onPress={noop} disabled />
        </View>
      </Specimen>
    </Section>
  );
}

const periods = ['4 Wochen', '3 Monate', 'Alles'] as const;
const days = [
  ['Mo', 'Montag'],
  ['Di', 'Dienstag'],
  ['Mi', 'Mittwoch'],
  ['Do', 'Donnerstag'],
  ['Fr', 'Freitag'],
  ['Sa', 'Samstag'],
  ['So', 'Sonntag'],
] as const;

function Chips() {
  const [period, setPeriod] = useState<(typeof periods)[number]>('3 Monate');
  const [sportDays, setSportDays] = useState<ReadonlySet<string>>(new Set(['Mo', 'Mi', 'Fr']));
  const toggleDay = (day: string) =>
    setSportDays((previous) => {
      const next = new Set(previous);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  return (
    <Section title="Chips">
      <Specimen label="Einzelauswahl">
        <View accessibilityRole="radiogroup" style={styles.row}>
          {periods.map((option) => (
            <Chip
              key={option}
              label={option}
              selection="single"
              selected={period === option}
              onPress={() => setPeriod(option)}
            />
          ))}
        </View>
      </Specimen>
      <Specimen label="Mehrfachauswahl (Sporttage)">
        <View style={styles.row}>
          {days.map(([short, long]) => (
            <Chip
              key={short}
              label={short}
              accessibilityLabel={long}
              selection="multiple"
              square
              selected={sportDays.has(short)}
              onPress={() => toggleDay(short)}
            />
          ))}
        </View>
      </Specimen>
      <Specimen label="Schnellwahl · gedrückt · deaktiviert">
        <View style={styles.row}>
          <Chip label="Glas 250 ml" onPress={noop} />
          <Chip label="Flasche 500 ml" onPress={noop} testOnly_pressed />
          <Chip label="Eigene Menge" onPress={noop} disabled />
        </View>
      </Specimen>
    </Section>
  );
}

function Cards() {
  return (
    <Section title="Karten">
      <Card>
        <Text variant="title">Standard</Text>
        <Text>Fläche mit Sockelkante.</Text>
      </Card>
      <Card onPress={noop} accessibilityLabel="Antippbare Karte öffnen">
        <Text variant="title">Antippbar</Text>
        <Text>Öffnet Details.</Text>
      </Card>
      <Card onPress={noop} accessibilityLabel="Gedrückte Karte" testOnly_pressed>
        <Text variant="title">Gedrückt</Text>
        <Text>Sinkt um 3 dp, Kante 1 dp.</Text>
      </Card>
      <Card variant="response">
        <Text variant="title">Antwortbedürftig</Text>
        <Text>Anna schlägt eine gemeinsame Challenge vor.</Text>
        <View style={styles.row}>
          <Button label="Annehmen" onPress={noop} />
          <Button label="Ablehnen" variant="text" onPress={noop} />
        </View>
      </Card>
      <Card variant="empty">
        <Text variant="headline">Noch nichts erfasst</Text>
        <Text tone="inkMuted">Dein Tagesprotokoll füllt sich mit jedem Eintrag.</Text>
        <Button label="Essen hinzufügen" variant="secondary" onPress={noop} />
      </Card>
      <Card>
        <Skeleton width="40%" />
        <Skeleton />
        <Skeleton width="70%" />
      </Card>
      <Card>
        <Notice tone="neutral" icon="offline" text="Offline – Annas Stand ist von 13:58." />
      </Card>
    </Section>
  );
}

function Notices() {
  return (
    <Section title="Hinweise">
      <Notice tone="partner" text="Anna feuert dich an: „Du schaffst das!“" />
      <Notice tone="hint" icon="island" text="Neues auf der Insel: Ein Besucher wartet am Strand." action={{ label: 'Ansehen', onPress: noop }} />
      <Notice tone="hint" icon="moon" text="„Im Kalorienbudget“ entscheidet sich am Tagesende." />
      <Notice tone="neutral" icon="offline" text="Offline · zuletzt abgeglichen um 13:58" />
      <Notice tone="success" text="Alle drei Tagesziele erfüllt · Tagesbonus +1 Energie" />
      <Notice
        tone="problem"
        cause="technik"
        text="Das Foto konnte nicht ausgewertet werden. Versuch es noch einmal."
        action={{ label: 'Nochmal', onPress: noop }}
      />
    </Section>
  );
}

function Rows() {
  const [shared, setShared] = useState(true);
  return (
    <Section title="Listenzeilen">
      <ListGroup>
        <ListRow icon="plate" title="Haferflocken mit Apfel" subtitle="80 g · Frühstück" value="320 kcal" />
        <ListRow icon="pulse" title="Radfahren" subtitle="45 min" tag="Apple Health" value="45 min" />
        <ListRow icon="sport" title="Morgenlauf" subtitle="Ersetzt durch Import" replaced />
        <ListRow
          icon="camera"
          title="Fotos teilen"
          subtitle="Anna sieht deine Mahlzeitenfotos"
          accessory={<Switch label="Fotos teilen" value={shared} onValueChange={setShared} />}
        />
        <ListRow icon="calendar" title="Wochenplan" onPress={noop} />
        <ListRow icon="gear" title="Gedrückt" onPress={noop} testOnly_pressed />
        <ListRow icon="pulse" title="Health" subtitle="Braucht Internet" onPress={noop} disabled />
      </ListGroup>
      <ContextMenu
        actions={[
          { id: 'edit', title: 'Bearbeiten' },
          { id: 'hide', title: 'Ausblenden' },
        ]}
        onAction={noop}
      >
        <ListGroup>
          <ListRow icon="more" title="Lange drücken: Kontextmenü" subtitle="Bearbeiten · Ausblenden" />
        </ListGroup>
      </ContextMenu>
      <Card>
        <View style={styles.row}>
          <Skeleton width={36} height={36} radius="sm" />
          <View style={styles.grow}>
            <Skeleton width="60%" />
            <Skeleton width="30%" />
          </View>
        </View>
      </Card>
    </Section>
  );
}

function Toasts() {
  return (
    <Section title="Meldungen">
      <Toast line={{ text: '+250 ml Wasser' }} onUndo={noop} />
      <Toast line={{ text: '+250 ml Wasser' }} onUndo={noop} testOnly_pressed />
      <Toast line={{ text: '+250 ml Wasser' }} secondLine={{ text: 'Wasserziel erfüllt · +1 Energie', energy: true }} onUndo={noop} />
      <Toast line={{ text: 'Alle drei geschafft · +1 Energie', energy: true }} />
    </Section>
  );
}

function Progress() {
  return (
    <Section title="Fortschritt">
      <Card>
        <ProgressBar label="Wasser heute" value={0} target={1500} valueText="0 von 1,5 l" />
        <ProgressBar label="Wasser heute" value={1000} target={1500} valueText="1,0 von 1,5 l" />
        <ProgressBar label="Sport diese Woche" value={150} target={150} valueText="150 von 150 min" />
        <ProgressBar label="Wasser heute" value={1750} target={1500} valueText="1,75 von 1,5 l" />
        <Skeleton height={6} radius="pill" />
      </Card>
    </Section>
  );
}

function NativeElements() {
  const clock = useClock();
  const reading = clock.read();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false);
  const [when, setWhen] = useState(reading.instant);
  return (
    <Section title="Native Elemente (@expo/ui)">
      <ListGroup>
        <ListRow title="Schalter aus" accessory={<Switch label="Schalter aus" value={on} onValueChange={setOn} />} />
        <ListRow title="Schalter an" accessory={<Switch label="Schalter an" value onValueChange={noop} />} />
        <ListRow
          title="Schalter deaktiviert"
          subtitle="Braucht Internet"
          disabled
          accessory={<Switch label="Schalter deaktiviert" value={false} onValueChange={noop} disabled />}
        />
      </ListGroup>
      <Card>
        <Text variant="label">Datum</Text>
        <DateTimePicker mode="date" value={when} onChange={setWhen} timeZone={reading.timeZone} />
        <Text variant="label">Uhrzeit</Text>
        <DateTimePicker mode="time" value={when} onChange={setWhen} timeZone={reading.timeZone} />
      </Card>
      <Button label="Sheet öffnen" variant="secondary" onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <Text variant="title" accessibilityRole="header">
            Erfassen
          </Text>
          <Text>Der Inhalt ist gebrandet; Griff, Abdunklung und Wischgeste sind nativ.</Text>
          <Button label="Fertig" block onPress={() => setOpen(false)} />
        </View>
      </Sheet>
    </Section>
  );
}

const hapticKinds = [
  ['tageszielerfuellung', 'Tagesziel erfüllt'],
  ['tagesbonus', 'Tagesbonus'],
  ['levelaufstieg', 'Levelaufstieg'],
] as const;

// Einziger Aufrufer der Haptik ist in der App die Reaktion aus Spezifikation 4. Der Katalog ruft sie
// nur im Development Build für den Gerätesmoke („dezente Haptik“) direkt auf.
function Haptics() {
  return (
    <Section title="Haptik">
      <View style={styles.row}>
        {hapticKinds.map(([kind, label]) => (
          <Button key={kind} label={label} variant="secondary" compact onPress={() => deviceHaptics.feedback(kind)} />
        ))}
      </View>
    </Section>
  );
}

function LargeText() {
  const stacked = useLargeTextLayout();
  return (
    <Section title="Große Schrift (Umbruch ab 1,3)">
      <View style={stacked ? styles.stack : styles.columns}>
        {(['drop', 'sport', 'scale'] as const).map((icon) => (
          <Card key={icon}>
            <Icon name={icon} />
            <Text variant="numberM">1,0 l</Text>
          </Card>
        ))}
      </View>
      <Text tone="inkMuted" variant="label">
        {stacked ? 'Gestapelt (Schriftfaktor ab 1,3).' : 'Nebeneinander (Schriftfaktor unter 1,3).'}
      </Text>
    </Section>
  );
}

function Icons() {
  return (
    <Section title="Icons">
      <Card>
        <View style={styles.icons}>
          {(Object.keys(iconShapes) as IconName[]).map((name) => (
            <Icon key={name} name={name} size="lg" />
          ))}
          <EnergySymbol size="lg" />
        </View>
      </Card>
    </Section>
  );
}

export default function ComponentCatalog() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <IconButton icon="back" accessibilityLabel="Zurück" onPress={() => router.back()} />
          <Text variant="display" accessibilityRole="header" style={styles.grow}>
            Komponenten
          </Text>
        </View>
        <DeviceCheck />
        <Plinth />
        <Typography />
        <Buttons />
        <Chips />
        <Cards />
        <Notices />
        <Rows />
        <Toasts />
        <Progress />
        <NativeElements />
        <Haptics />
        <LargeText />
        <Icons />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceBase },
  content: { padding: space[4], gap: space[6] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  section: { gap: space[3] },
  specimen: { gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  grow: { flex: 1, gap: space[2] },
  columns: { flexDirection: 'row', gap: space[2] },
  stack: { gap: space[2] },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  sheet: { gap: space[4] },
});
