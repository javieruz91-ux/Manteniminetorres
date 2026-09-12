const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/lib/auth.tsx', 'utf8');

code = code.replace(/import \* as SecureStore from 'expo-secure-store';/, `import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const setToken = async (val: string) => {
  if (Platform.OS === 'web') {
    localStorage.setItem(AUTH_TOKEN_KEY, val);
  } else {
    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, val);
  }
};

const getToken = async () => {
  if (Platform.OS === 'web') {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }
  return await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
};

const deleteToken = async () => {
  if (Platform.OS === 'web') {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
  }
};
`);

code = code.replace(/await SecureStore\.getItemAsync\(AUTH_TOKEN_KEY\)/g, 'await getToken()');
code = code.replace(/await SecureStore\.setItemAsync\(AUTH_TOKEN_KEY, data\.token\)/g, 'await setToken(data.token)');
code = code.replace(/await SecureStore\.deleteItemAsync\(AUTH_TOKEN_KEY\)/g, 'await deleteToken()');

fs.writeFileSync('artifacts/mantenimiento-celular/lib/auth.tsx', code);
