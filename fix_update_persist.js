const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /  const updateAndPersist = useCallback\(async \(updater: \(prev: Visit\[\]\) => Visit\[\]\): Promise<Visit\[\]> => \{[\s\S]*?  \}, \[currentNamespace\]\);/;

const replacement = `  const updateAndPersist = useCallback((updater: (prev: Visit[]) => Visit[]): Promise<Visit[]> => {
    const nextPromise = persistQueue.current.catch(() => null).then(async () => {
      const nextState = updater(visitsRef.current);
      await AsyncStorage.setItem(currentNamespace, JSON.stringify(nextState));
      visitsRef.current = nextState;
      setVisits(nextState);
      return nextState;
    });
    // Set queue tail to a promise that always resolves internally, but return the one that can reject to caller
    persistQueue.current = nextPromise.catch((e) => {
      console.error("Storage write failed", e);
      return null;
    });
    return nextPromise;
  }, [currentNamespace]);`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
