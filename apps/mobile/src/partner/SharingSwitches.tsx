import { StyleSheet, View } from 'react-native';

import { AreaKey } from '@abnehm/contracts/base';

import { ListGroup, ListRow, Notice, space, Switch, type IconName } from '../design';
import { SectionTitle } from '../settings/SectionTitle';
import { useMessageHost } from '../shell/MessageHost';
import type { Partner, SharingView } from './partner';
import type { SharingChange } from './sharing';
import { areaNames, sharingTexts } from './texts';

const areaIcons: Readonly<Record<AreaKey, IconName>> = { ernaehrung: 'plate', wasser: 'drop', sport: 'sport', gewicht: 'scale' };

/**
 * Die Schalter der eigenen Freigaben (Spezifikation 5, Abschnitt 6; #129): „Gesundheitsbereiche“ mit einem Schalter je
 * Bereich über die Partnerfreigabe, „Fotos“ über die Fotofreigabe und der Infotext zu Screenshots. Dieselben Schalter
 * zeigt der Onboarding-Schritt `partner` nach der Kopplung. Jeder Wechsel gilt sofort lokal; ohne Verbindung sagt der
 * Meldungs-Host nach dem Abschalten, dass es erst mit der nächsten Verbindung beim Partner wirkt.
 */
export function SharingSwitches({ partner, sharing }: { partner: Partner; sharing: Extract<SharingView, { type: 'coupled' }> }) {
  const { showMessage } = useMessageHost();
  const change = (next: SharingChange) => {
    const outcome = partner.share(next);
    if (outcome.type !== 'saved') showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
    else if (!next.shared && !sharing.online) showMessage({ messageKey: 'freigaben.gilt_wenn_online', values: {} });
  };
  return (
    <>
      <View style={styles.section}>
        <SectionTitle>{sharingTexts.areasTitle}</SectionTitle>
        <ListGroup>
          {AreaKey.options.map((area) => (
            <ListRow key={area} icon={areaIcons[area]} title={areaNames[area]} subtitle={sharingTexts.areaSubtitles[area]}
              accessory={<Switch testID={`freigabe-${area}`} label={areaNames[area]} value={sharing.areas[area]} onValueChange={(shared) => change({ type: 'area', area, shared })} />} />
          ))}
        </ListGroup>
      </View>
      <View style={styles.section}>
        <SectionTitle>{sharingTexts.photosTitle}</SectionTitle>
        <ListGroup>
          <ListRow icon="camera" title={sharingTexts.photos} subtitle={sharingTexts.photosSubtitle}
            accessory={<Switch testID="freigabe-fotos" label={sharingTexts.photos} value={sharing.photos} onValueChange={(shared) => change({ type: 'photos', shared })} />} />
        </ListGroup>
      </View>
      <Notice tone="neutral" icon="info" text={sharingTexts.info} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
});
