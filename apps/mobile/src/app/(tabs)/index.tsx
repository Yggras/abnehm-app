import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useClock } from '../../clock/clock-context';
import { Button, space, Text } from '../../design';
import { routeScreen } from '../../navigation';
import { refreshDeviceSync } from '../../session/device-session';
import { ScreenFrame } from '../../shell/ScreenFrame';
import { appTodayRegistry } from '../../shell/app-today';
import { TodayContent } from '../../shell/TodayScreen';
import { createTodayPreview } from '../../shell/today-preview';
import { shellTexts } from '../../shell/texts';

function TodayRoute() {
  const clock = useClock();
  const [preview, setPreview] = useState(false);
  const [sample] = useState(() => __DEV__ ? createTodayPreview(clock) : null);
  return <ScreenFrame title="Heute" presentation="tab" compactTabTitle onRefresh={() => refreshDeviceSync() ?? Promise.resolve()}>
    {__DEV__ && !preview ? <Button compact label="Beispieldaten anzeigen" variant="secondary" onPress={() => setPreview(true)} /> : null}
    <TodayContent registry={preview && sample ? sample : appTodayRegistry} />
    {__DEV__ ? <View style={{ gap: space[2] }}>
      <Text variant="caption" tone="inkMuted">{shellTexts.developer}</Text>
      {preview ? <Button label="Beispieldaten ausblenden" variant="text" onPress={() => setPreview(false)} /> : null}
      <Button label={shellTexts.componentCatalog} variant="text" icon="layers" onPress={() => router.push('/katalog')} />
      <Button label={shellTexts.technicalCheck} variant="text" icon="pulse" onPress={() => router.push('/technik')} />
    </View> : null}
  </ScreenFrame>;
}

export default routeScreen('today', TodayRoute);
