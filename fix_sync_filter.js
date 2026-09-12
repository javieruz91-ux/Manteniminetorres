const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /let pendingVisits = visitsRef\.current\.filter\(v => \s*\(v\.syncStatus === 'PENDIENTE' \|\| v\.syncStatus === 'ERROR'\) && \s*\(v\.nextAttemptAt \|\| 0\) <= Date\.now\(\) && \s*\(v\.lifecycleStatus === 'CERRADA' \|\| v\.lifecycleStatus === 'REABIERTA'\)\s*\);/;

const replacement = `let pendingVisits = visitsRef.current.filter(v => 
      (v.syncStatus === 'PENDIENTE' || v.syncStatus === 'ERROR') && 
      (v.nextAttemptAt || 0) <= Date.now()
    );`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
