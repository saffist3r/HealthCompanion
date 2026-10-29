import { View, type ViewStyle } from 'react-native';

type Props = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  pills?: string[];
  children?: React.ReactNode;
  style?: ViewStyle;
  padTop?: number;
  compact?: boolean;
};

/**
 * Screens used to open on a full-bleed gradient banner. In the HUD layout the native header
 * (or the tab screen's own title) names the screen, so only the banner's own content stays.
 */
export default function ScreenHero({ children, style }: Props) {
  if (!children) return null;
  return <View style={[{ gap: 10 }, style]}>{children}</View>;
}
