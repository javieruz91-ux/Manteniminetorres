const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /  const deleteVisit = async \(id: string\): Promise<void> => \{[\s\S]*?  const savePhoto = async/g;
const replacement = `  const savePhoto = async`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
