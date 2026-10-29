import type { RouteTarget } from '@abnehm/contracts/routes';
import { Platform, StyleSheet, View } from 'react-native';

import { color, ListGroup, ListRow, size, Skeleton, space, Text, type IconName } from '../design';
import { openTarget, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAccountEmail, useDisplayName, type EmailState } from './AccountProvider';
import { SectionTitle } from './SectionTitle';
import { settingsTexts } from './texts';

// Einstellungen-Übersicht hinter dem Zahnrad (Spezifikation 5, Abschnitt 6; Gliederung nach #43): Kopf
// mit Anzeigename und E-Mail, darunter „Dein Plan“, „Gemeinsam“ und „Daten & Konto“. Jede Zeile öffnet
// ihre Seite; Seiten, die andere Tickets liefern, zeigen bis dahin den deutschen Platzhalter der Shell.

type Section = NonNullable<Extract<RouteTarget, { type: 'settings' }>['section']>;

type Row = Readonly<{ section: Section; icon: IconName }>;

const groups: readonly Readonly<{ title: string; rows: readonly Row[] }>[] = [
  {
    title: settingsTexts.groups.plan,
    rows: [
      { section: 'goals', icon: 'flag' },
      { section: 'weekly_plan', icon: 'calendar' },
    ],
  },
  {
    title: settingsTexts.groups.together,
    rows: [
      { section: 'partner_sharing', icon: 'people' },
      { section: 'notifications', icon: 'bell' },
    ],
  },
  {
    title: settingsTexts.groups.dataAndAccount,
    rows: [
      { section: 'health', icon: 'pulse' },
      { section: 'account', icon: 'person' },
    ],
  },
];

/** Titel einer Zeile; die Gesundheitsdaten heißen wie die Plattform-App, mit der die App sie austauscht. */
function rowTitle(section: Section): string {
  if (section !== 'health') return titleOf({ type: 'settings', section });
  return Platform.OS === 'android' ? settingsTexts.health.android : settingsTexts.health.ios;
}

export function SettingsOverview({ target }: RouteScreenProps<'settings'>) {
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      <AccountHeader />
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          <ListGroup>
            {group.rows.map(({ section, icon }) => (
              <ListRow key={section} icon={icon} title={rowTitle(section)} onPress={() => openTarget({ type: 'settings', section })} />
            ))}
          </ListGroup>
        </View>
      ))}
    </ScreenFrame>
  );
}

function AccountHeader() {
  const name = useDisplayName();
  const email = useAccountEmail();
  const emailText = (state: EmailState) => (state.type === 'known' ? state.email : state.type === 'unknown' ? settingsTexts.emailUnknown : null);
  return (
    <View style={styles.header} accessible accessibilityLabel={name === null ? undefined : settingsTexts.header(name, emailText(email))}>
      <View style={styles.avatar}>
        <Text variant="headline" tone="onPrimary">
          {name === null ? '' : [...name][0]!.toUpperCase()}
        </Text>
      </View>
      <View style={styles.identity}>
        {name === null ? <Skeleton width="50%" /> : <Text variant="title">{name}</Text>}
        {email.type === 'loading' ? <Skeleton width="70%" /> : (
          <Text variant="label" tone="inkMuted">
            {emailText(email)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  avatar: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: size.avatar / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.self,
  },
  identity: { flex: 1, gap: space[1] },
  group: { gap: space[2] },
});
