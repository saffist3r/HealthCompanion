import type { ImageSourcePropType } from 'react-native';
import type { CareVisitKind, SportMatchResult } from '@health-companion/shared';

export const AppIcons = {
  kine: require('../../assets/icons/icon-kine.png'),
  osteo: require('../../assets/icons/icon-osteo.png'),
  podologue: require('../../assets/icons/icon-podologue.png'),
  other: require('../../assets/icons/icon-care-other.png'),
  padel: require('../../assets/icons/icon-padel.png'),
  gym: require('../../assets/icons/icon-gym.png'),
  completed: require('../../assets/icons/icon-completed.png'),
  win: require('../../assets/icons/icon-win.png'),
  loss: require('../../assets/icons/icon-loss.png'),
  draw: require('../../assets/icons/icon-draw.png'),
  steps: require('../../assets/icons/icon-steps.png'),
  watch: require('../../assets/icons/icon-watch.png'),
  glucose: require('../../assets/icons/icon-glucose.png'),
  meals: require('../../assets/icons/icon-meals.png'),
  reports: require('../../assets/icons/icon-reports.png'),
  samsung: require('../../assets/icons/icon-samsung.png'),
  stress: require('../../assets/icons/icon-stress.png'),
  brand: require('../../assets/health-companion-logo.png'),
} as const satisfies Record<string, ImageSourcePropType>;

export function careKindIcon(kind: CareVisitKind): ImageSourcePropType {
  return AppIcons[kind] ?? AppIcons.other;
}

export function sportResultIcon(result: SportMatchResult): ImageSourcePropType {
  if (result === 'completed') return AppIcons.gym;
  return AppIcons[result] ?? AppIcons.padel;
}

export function sportSessionIcon(sport?: string | null, result?: string | null): ImageSourcePropType {
  if ((sport || '').toLowerCase() === 'gym' || result === 'completed') return AppIcons.gym;
  if (result === 'win' || result === 'loss' || result === 'draw') {
    return AppIcons[result];
  }
  return AppIcons.padel;
}

export function stressLevelIcon(): ImageSourcePropType {
  return AppIcons.stress;
}
