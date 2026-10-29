import { createNavigationContainerRef } from '@react-navigation/native';
import type { NudgeScreen } from './pushNudges';

export const navigationRef = createNavigationContainerRef();

/** Untyped navigate: routes are not declared as a ParamList in this app. */
export function navigateTo(name: string, params?: object) {
  (navigationRef as unknown as { navigate: (name: string, params?: object) => void }).navigate(name, params);
}

export function openMorningLog() {
  openNudgeScreen('MorningLog');
}

export function openPainLog(opts?: { injuryId?: string }) {
  if (!navigationRef.isReady()) return;
  navigateTo('PainLog', opts || {});
}

export function openReb3iLive() {
  if (!navigationRef.isReady()) return;
  navigateTo('Reb3iLive');
}

export function openNudgeScreen(screen?: NudgeScreen | string) {
  if (!navigationRef.isReady()) return;
  switch (screen) {
    case 'MorningLog':
      navigateTo('MorningLog');
      return;
    case 'PainLog':
      navigateTo('PainLog');
      return;
    case 'Meals':
      navigateTo('Tabs', { screen: 'Log', params: { screen: 'LogMain' } });
      return;
    case 'Mental':
      navigateTo('Tabs', { screen: 'Me', params: { screen: 'Mental' } });
      return;
    case 'Glucose':
      navigateTo('Tabs', { screen: 'Home', params: { screen: 'GlucoseDetail' } });
      return;
    case 'Activity':
      navigateTo('Tabs', { screen: 'Me', params: { screen: 'Activity' } });
      return;
    case 'Reports':
      navigateTo('Tabs', { screen: 'Insights' });
      return;
    case 'Today':
    default:
      navigateTo('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });
  }
}
