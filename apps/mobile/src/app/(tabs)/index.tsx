import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useClock } from '../../clock/clock-context';
import { Button, space, Text } from '../../design';
import { routeScreen } from '../../navigation';
import { ScreenFrame } from '../../shell/ScreenFrame';
import { appTodayRegistry } from '../../shell/app-today';
import { TodayContent } from '../../shell/TodayScreen';
import { createTodayPreview } from '../../shell/today-preview';
import { shellTexts } from '../../shell/texts';

function TodayRoute() {
  const clock = useClock();
  const [preview, setPreview] = useState(false);
  const [sample] = useState(() => __DEV__ ? createTodayPreview(clock) : null);
  return <ScreenFrame title="Heute" presentation="tab">
    {__DEV__ ? <Button compact label={preview ? 'Beispieldaten ausblenden' : 'Beispieldaten anzeigen'} variant="secondary" onPress={() => setPreview(!preview)} /> : null}
    <TodayContent registry={preview && sample ? sample : appTodayRegistry} />
    {__DEV__ ? <View style={{ gap: space[2] }}>
      <Text variant="caption" tone="inkMuted">{shellTexts.developer}</Text>
      <Button label={shellTexts.componentCatalog} variant="text" icon="layers" onPress={() => router.push('/katalog')} />
      <Button label={shellTexts.technicalCheck} variant="text" icon="pulse" onPress={() => router.push('/technik')} />
    </View> : null}
  </ScreenFrame>;
}

export default routeScreen('today', TodayRoute);
