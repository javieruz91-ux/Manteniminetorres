const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regexToRemove = /\/\/ 1\. Ordered Writer Abstraction\s*const mutateVisits = useCallback\(\(updater: \(prev: Visit\[\]\) => Visit\[\]\) => \{[\s\S]*?\}\);\s*      return nextState;\s*    \}\);\s*  \}, \[currentNamespace\]\);/;

code = code.replace(regexToRemove, '');
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
