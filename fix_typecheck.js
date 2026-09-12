const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /if \(info\.size === 0\) \{/g;
const replacement = `if ('size' in info && info.size === 0) {`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
