const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/visit/[id]/section/[sectionId].tsx', 'utf8');

code = code.replace(/saveFindingAndStatus\(visit\.id, pointId, section\.id, status, null\);/, 'await saveFindingAndStatus(visit.id, pointId, section.id, status, null);');
code = code.replace(/updatePointStatus\(visit\.id, section\.id, pointId, status\);/, 'await updatePointStatus(visit.id, section.id, pointId, status);');
code = code.replace(/onPress: \(\) => \{/, 'onPress: async () => {');
code = code.replace(/const handleStatusSelect = \(pointId: string, status: ChecklistStatus\) => \{/, 'const handleStatusSelect = async (pointId: string, status: ChecklistStatus) => {');

fs.writeFileSync('artifacts/mantenimiento-celular/app/visit/[id]/section/[sectionId].tsx', code);
