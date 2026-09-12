const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /const conf = await syncVisit\(input, \{ headers: \{ 'Idempotency-Key': currentV\.operationId! \}\}\);\s*await updateAndPersist\(prev => prev\.map\(pv => \{\s*if \(pv\.id === currentV\.id\) \{\s*return \{\s*\.\.\.pv,\s*syncStatus: 'SINCRONIZADO',\s*serverVersion: conf\.serverVersion,\s*confirmedAt: conf\.confirmedAt,\s*syncError: undefined\s*\};\s*\}\s*return pv;\s*\}\)\);/g;
const replacement = `const conf = await syncVisit(input, { headers: { 'Idempotency-Key': currentV.operationId! }});
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === currentV.id) {
              if (pv.operationId === currentV.operationId) {
                return { 
                  ...pv, 
                  syncStatus: 'SINCRONIZADO', 
                  serverVersion: conf.serverVersion, 
                  confirmedAt: conf.confirmedAt, 
                  syncError: undefined 
                };
              } else {
                // If operationId changed during sync (user edited), just update metadata but leave PENDIENTE
                return {
                  ...pv,
                  serverVersion: conf.serverVersion,
                  confirmedAt: conf.confirmedAt
                };
              }
            }
            return pv;
          }));`;

code = code.replace(regex, replacement);

const errorRegex = /catch \(err: any\) \{\s*await updateAndPersist\(prev => prev\.map\(pv => \{\s*if \(pv\.id === currentV\.id\) \{\s*const delay = Math\.min\(1000 \* Math\.pow\(2, pv\.syncAttemptCount \|\| 1\), 1000 \* 60 \* 60\);\s*return \{ \.\.\.pv, syncStatus: 'ERROR', syncError: err\.message \|\| 'Error desconocido', nextAttemptAt: Date\.now\(\) \+ delay \};\s*\}\s*return pv;\s*\}\)\);\s*\}/;
const errorReplacement = `catch (err: any) {
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === currentV.id && pv.operationId === currentV.operationId) {
              const delay = Math.min(1000 * Math.pow(2, pv.syncAttemptCount || 1), 1000 * 60 * 60);
              return { ...pv, syncStatus: 'ERROR', syncError: err.message || 'Error desconocido', nextAttemptAt: Date.now() + delay };
            }
            return pv;
          }));
        }`;
code = code.replace(errorRegex, errorReplacement);

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
