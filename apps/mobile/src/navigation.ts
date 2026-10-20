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

export function openNudgeScreen(screen?: NudgeScreen | string) {
  if (!navigationRef.isReady()) return;
  switch (screen) {
    case 'MorningLog':
      navigateTo('MorningLog');
      return;
    case 'Meals':
      navigateTo('Tabs', { screen: 'Meals' });
      return;
    case 'Mental':
      navigateTo('Tabs', { screen: 'Mental' });
      return;
    case 'Glucose':
      navigateTo('Tabs', { screen: 'Glucose' });
      return;
    case 'Activity':
      navigateTo('Tabs', { screen: 'Activity' });
      return;
    case 'Reports':
      navigateTo('Tabs', { screen: 'Reports' });
      return;
    case 'Today':
    default:
      navigateTo('Tabs', { screen: 'Today' });
  }
}
