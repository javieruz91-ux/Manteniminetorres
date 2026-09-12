const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /      const nextState = updater\(visitsRef\.current\);\n      await AsyncStorage\.setItem\(currentNamespace, JSON\.stringify\(nextState\)\);\n      visitsRef\.current = nextState;\n      setVisits\(nextState\);\n      return nextState;/g;

const replacement = `      const nextState = updater(visitsRef.current);
      const stateToSave = nextState.map(v => Platform.OS === 'web' ? {
        ...v,
        findings: v.findings.map(f => ({
          ...f,
          photos: f.photos.map(p => ({
            ...p,
            uri: p.uri.startsWith('blob:') ? '' : p.uri
          }))
        }))
      } : v);
      await AsyncStorage.setItem(currentNamespace, JSON.stringify(stateToSave));
      visitsRef.current = nextState;
      setVisits(nextState);
      return nextState;`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
