const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/visit/[id]/finding/[pointId].tsx', 'utf8');

code = code.replace(/saveFindingAndStatus\(id, pointId, sectionId, 'NOK', \{/g, 'await saveFindingAndStatus(id, pointId, sectionId, "NOK", {');

fs.writeFileSync('artifacts/mantenimiento-celular/app/visit/[id]/finding/[pointId].tsx', code);
