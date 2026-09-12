const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

code = code.replace(/const token = await SecureStore\.getItemAsync\('auth_session_token'\);/, `const token = Platform.OS === 'web' ? localStorage.getItem('auth_session_token') : await SecureStore.getItemAsync('auth_session_token');`);

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
