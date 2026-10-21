import { createNavigationContainerRef } from '@react-navigation/native';
import type { NudgeScreen } from './pushNudges';

export const navigationRef = createNavigationContainerRef();

export function openMorningLog() {
  openNudgeScreen('MorningLog');
}

export function openPainLog(opts?: { injuryId?: string }) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('PainLog' as never, (opts || {}) as never);
}

export function openReb3iLive() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Reb3iLive' as never);
}

export function openNudgeScreen(screen?: NudgeScreen | string) {
  if (!navigationRef.isReady()) return;
  switch (screen) {
    case 'MorningLog':
      navigationRef.navigate('MorningLog' as never);
      return;
    case 'PainLog':
      navigationRef.navigate('PainLog' as never);
      return;
    case 'Meals':
      navigationRef.navigate('Tabs' as never, { screen: 'Meals' } as never);
      return;
    case 'Mental':
      navigationRef.navigate('Tabs' as never, { screen: 'Mental' } as never);
      return;
    case 'Glucose':
      navigationRef.navigate('Tabs' as never, { screen: 'Glucose' } as never);
      return;
    case 'Activity':
      navigationRef.navigate('Tabs' as never, { screen: 'Activity' } as never);
      return;
    case 'Reports':
      navigationRef.navigate('Tabs' as never, { screen: 'Reports' } as never);
      return;
    case 'Today':
    default:
      navigationRef.navigate('Tabs' as never, { screen: 'Today' } as never);
  }
}
