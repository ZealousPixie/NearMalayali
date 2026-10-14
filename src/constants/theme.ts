// Visual language: Kerala green and kasavu gold on warm off-white.
import { useColorScheme } from 'react-native';

export const Palette = {
  light: {
    background: '#FBF8F1',
    surface: '#FFFFFF',
    surfaceMuted: '#F1ECE0',
    border: '#E2DACB',
    text: '#1C1B18',
    textSecondary: '#5E5A52',
    primary: '#0B6E4F',
    primaryText: '#FFFFFF',
    primaryMuted: '#DCEFE7',
    accent: '#B8901F',
    danger: '#B3261E',
    dangerMuted: '#FBE4E2',
    warning: '#8A5A00',
    warningMuted: '#FFF1D6',
    success: '#1E7A3C',
  },
  dark: {
    background: '#12130F',
    surface: '#1C1D18',
    surfaceMuted: '#262720',
    border: '#35362E',
    text: '#F3F0E8',
    textSecondary: '#B7B2A6',
    primary: '#3DBE8E',
    primaryText: '#08130E',
    primaryMuted: '#173A2D',
    accent: '#E0BC52',
    danger: '#F2867E',
    dangerMuted: '#3D1D1A',
    warning: '#F5C25B',
    warningMuted: '#3A2C10',
    success: '#62C987',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Palette.light]: string };

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const FontSize = { caption: 13, body: 16, subtitle: 18, title: 24, hero: 32 } as const;

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? Palette.dark : Palette.light;
}
