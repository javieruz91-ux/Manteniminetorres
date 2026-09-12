const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /if \(\(v\.syncStatus === 'PENDIENTE' \|\| v\.syncStatus === 'ERROR'\) && \(v\.lifecycleStatus === 'CERRADA' \|\| v\.lifecycleStatus === 'REABIERTA'\)\) \{/g;
const replacement = `if (v.syncStatus === 'PENDIENTE' || v.syncStatus === 'ERROR') {`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
