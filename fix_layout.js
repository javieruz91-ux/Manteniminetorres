const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/_layout.tsx', 'utf8');

code = code.replace(/import \* as SecureStore from "expo-secure-store";/, `import * as SecureStore from "expo-secure-store";\nimport { Platform } from "react-native";`);

code = code.replace(/setAuthTokenGetter\(\(\) => SecureStore\.getItemAsync\("auth_session_token"\)\);/, `setAuthTokenGetter(async () => {
  if (Platform.OS === 'web') return localStorage.getItem('auth_session_token');
  return await SecureStore.getItemAsync('auth_session_token');
});`);

fs.writeFileSync('artifacts/mantenimiento-celular/app/_layout.tsx', code);
