import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function openMorningLog() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('MorningLog' as never);
}
