const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/lib/auth.tsx', 'utf8');

code = code.replace(/return await getToken\(\);/, "return await SecureStore.getItemAsync(AUTH_TOKEN_KEY);");
code = code.replace(/await deleteToken\(\);\n  \}/, "await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);\n  }");

fs.writeFileSync('artifacts/mantenimiento-celular/lib/auth.tsx', code);
