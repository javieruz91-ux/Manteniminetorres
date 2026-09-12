import { useColorScheme } from 'react-native';
import colors from '../constants/colors';

export function useColors() {
  const scheme = useColorScheme() ?? 'light';
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  return { ...theme, radius: colors.radius };
}
