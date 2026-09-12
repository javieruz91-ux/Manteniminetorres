const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/visit/[id]/index.tsx', 'utf8');

code = code.replace(/updateVisit\(id, \{ siteId, siteName, workOrder, technician \}\);/, 'await updateVisit(id, { siteId, siteName, workOrder, technician });');
code = code.replace(/const saveGeneralData = \(\) => \{/, 'const saveGeneralData = async () => {');

fs.writeFileSync('artifacts/mantenimiento-celular/app/visit/[id]/index.tsx', code);
