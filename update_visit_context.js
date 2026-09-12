const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

// Replace VisitProvider state management
const replaceStateManagement = () => {
  const searchStart = `const [visits, setVisits] = useState<Visit[]>([]);`;
  const searchEnd = `const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);`;
  
  if (!code.includes(searchStart)) throw new Error("Could not find start");
  
  const replaceStr = `const [visits, setVisits] = useState<Visit[]>([]);
  const visitsRef = useRef<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const { user, isAuthenticated } = useAuth();
  
  const isHydrated = useRef(false);
  const currentNamespace = \`@mantenimiento_visits_\${user?.id || 'guest'}\`;
  const persistQueue = useRef(Promise.resolve<any>(null));
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Awaitable Persistence Barrier
  const updateAndPersist = useCallback(async (updater: (prev: Visit[]) => Visit[]): Promise<Visit[]> => {
    return new Promise((resolve, reject) => {
      persistQueue.current = persistQueue.current.then(async () => {
        try {
          const nextState = updater(visitsRef.current);
          visitsRef.current = nextState;
          setVisits(nextState); // Trigger UI render synchronously in this tick
          await AsyncStorage.setItem(currentNamespace, JSON.stringify(nextState));
          resolve(nextState);
        } catch (e) {
          console.error("Storage write failed", e);
          reject(e);
        }
      });
    });
  }, [currentNamespace]);

  const mutateVisits = useCallback((updater: (prev: Visit[]) => Visit[]) => {
    updateAndPersist(updater).catch(e => console.error("mutateVisits error", e));
  }, [updateAndPersist]);`;

  const regex = /const \[visits, setVisits\] = useState<Visit\[\]>\(\[\]\);[\s\S]*?const syncTimerRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\);/;
  code = code.replace(regex, replaceStr);
}
replaceStateManagement();

// Replace downloadPhotosForVisit and fetchAndMergeServerVisits
const replaceDownload = () => {
  const downloadRegex = /\/\/ Download photos securely[\s\S]*?\}, \[isAuthenticated, mutateVisits\]\);/;
  
  const replaceStr = `// Download photos securely
  const fetchAndMergeServerVisits = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const serverVisits = await listVisits();
      const token = await SecureStore.getItemAsync('auth_session_token');
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const remoteUris: Record<string, string> = {};

      if (token && domain) {
        for (const sv of serverVisits) {
          for (const photo of sv.photos) {
            if (!photo.objectPath) continue;
            const safePath = photo.objectPath.startsWith('/') ? photo.objectPath : \`/\${photo.objectPath}\`;
            const url = \`https://\${domain}/api/storage\${safePath}\`;
            
            if (Platform.OS === 'web') {
              try {
                const res = await fetch(url, { headers: { Authorization: \`Bearer \${token}\` } });
                if (res.ok && res.headers.get('content-type')?.includes('image')) {
                  const blob = await res.blob();
                  remoteUris[photo.localId] = URL.createObjectURL(blob);
                }
              } catch (e) {
                console.warn("Failed to download photo web", e);
              }
            } else {
              const dest = \`\${FileSystem.documentDirectory}\${photo.localId}\`;
              const info = await FileSystem.getInfoAsync(dest);
              if (!info.exists) {
                try {
                  const res = await FileSystem.downloadAsync(url, dest, {
                    headers: { Authorization: \`Bearer \${token}\` }
                  });
                  if (res.status >= 200 && res.status < 300 && res.headers['content-type']?.includes('image')) {
                    remoteUris[photo.localId] = dest;
                  } else {
                    await FileSystem.deleteAsync(dest, { idempotent: true });
                    console.warn("Invalid photo response", res.status);
                  }
                } catch (e) {
                  console.warn("Failed to download photo native", e);
                }
              } else {
                remoteUris[photo.localId] = dest;
              }
            }
          }
        }
      }
      
      await updateAndPersist(prev => {
        const merged = [...prev];
        serverVisits.forEach(sv => {
          const idx = merged.findIndex(v => v.id === sv.visitId);
          if (idx >= 0) {
            if (sv.serverVersion > (merged[idx].serverVersion || 0)) {
              merged[idx] = mapSnapshotToLocal(sv, remoteUris);
            }
          } else {
            merged.push(mapSnapshotToLocal(sv, remoteUris));
          }
        });
        return merged;
      });
    } catch (e) {
      console.warn("Failed to fetch server visits", e);
    }
  }, [isAuthenticated, updateAndPersist]);`;

  code = code.replace(downloadRegex, replaceStr);
}
replaceDownload();

// Replace loadVisits
const replaceLoadVisits = () => {
  const loadVisitsRegex = /if \(stored\) \{[\s\S]*?parsed = JSON\.parse\(stored\);[\s\S]*?parsed = parsed\.map\(v => \{[\s\S]*?\}\);[\s\S]*?\}[\s\S]*?if \(isMounted\) \{[\s\S]*?setVisits\(parsed\);[\s\S]*?persistQueue\.current = persistQueue\.current\.then\(async \(\) => \{[\s\S]*?await AsyncStorage\.setItem\(currentNamespace, JSON\.stringify\(parsed\)\);[\s\S]*?\}\);[\s\S]*?\}/;
  
  const replaceStr = `if (stored) {
          parsed = JSON.parse(stored);
          // Crash recovery: revert SINCRONIZANDO -> PENDIENTE, preserving exact operationId
          parsed = parsed.map(v => {
            if (v.syncStatus === 'SINCRONIZANDO') {
              return { ...v, syncStatus: 'PENDIENTE', syncAttemptCount: (v.syncAttemptCount || 0) + 1 };
            }
            return v;
          });
        }
        if (isMounted) {
          visitsRef.current = parsed;
          setVisits(parsed);
          persistQueue.current = persistQueue.current.then(async () => {
            await AsyncStorage.setItem(currentNamespace, JSON.stringify(parsed));
          });
        }`;
  code = code.replace(loadVisitsRegex, replaceStr);
}
replaceLoadVisits();

// Replace processSyncQueue
const replaceSyncQueue = () => {
  const syncQueueRegex = /const processSyncQueue = useCallback\(async \(\) => \{[\s\S]*?  \}, \[isOnline, isAuthenticated, visits, mutateVisits\]\);/;
  
  const replaceStr = `const processSyncQueue = useCallback(async () => {
    if (isSyncing.current || !isOnline || !isHydrated.current || !isAuthenticated) return;
    
    let pendingVisits = visitsRef.current.filter(v => 
      (v.syncStatus === 'PENDIENTE' || v.syncStatus === 'ERROR') && 
      (v.nextAttemptAt || 0) <= Date.now() && 
      (v.lifecycleStatus === 'CERRADA' || v.lifecycleStatus === 'REABIERTA')
    );
    
    if (pendingVisits.length === 0) return;

    isSyncing.current = true;

    try {
      for (const visit of pendingVisits) {
        // Mark as syncing and await the exact state
        const persistedState = await updateAndPersist(prev => prev.map(v => {
          if (v.id === visit.id) {
            return { ...v, syncStatus: 'SINCRONIZANDO' as const, syncAttemptCount: (v.syncAttemptCount || 0) + 1 };
          }
          return v;
        }));
        
        let latestV = persistedState.find(v => v.id === visit.id);
        if (!latestV) continue;

        try {
          let allPhotosUploaded = true;
          for (let f of latestV.findings) {
            for (let p of f.photos) {
              if (p.uploadStatus !== 'uploaded') {
                try {
                  let blob: Blob;
                  if (Platform.OS === 'web') {
                    const res = await fetch(p.uri);
                    blob = await res.blob();
                  } else {
                    const res = await fetch(p.uri);
                    blob = await res.blob();
                  }

                  const ext = p.uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
                  const contentType: UploadUrlRequestContentType = ext === 'png' ? 'image/png' : 'image/jpeg';
                  
                  const urlRes = await requestUploadUrl({
                    name: p.id + '.' + ext,
                    size: blob.size || 1024,
                    contentType,
                    visitId: latestV.id,
                    sectionId: f.sectionId,
                    pointId: f.pointId,
                    findingId: f.id,
                    type: p.type,
                    localId: p.id
                  });

                  const uploadRes = await fetch(urlRes.uploadURL, {
                    method: 'PUT',
                    headers: { 'Content-Type': contentType },
                    body: blob,
                  });

                  if (uploadRes.ok) {
                    const stateAfterUpload = await updateAndPersist(prev => prev.map(pv => {
                      if (pv.id === latestV!.id) {
                        const updatedFindings = pv.findings.map(pf => {
                          if (pf.id === f.id) {
                            return { ...pf, photos: pf.photos.map(pp => pp.id === p.id ? { ...pp, uploadStatus: 'uploaded' as UploadStatus, objectPath: urlRes.objectPath } : pp) };
                          }
                          return pf;
                        });
                        return { ...pv, findings: updatedFindings };
                      }
                      return pv;
                    }));
                    latestV = stateAfterUpload.find(v => v.id === latestV!.id);
                  } else {
                    allPhotosUploaded = false;
                    await updateAndPersist(prev => prev.map(pv => pv.id === latestV!.id ? { ...pv, findings: pv.findings.map(pf => pf.id === f.id ? { ...pf, photos: pf.photos.map(pp => pp.id === p.id ? { ...pp, uploadStatus: 'failed' as UploadStatus } : pp) } : pf) } : pv));
                  }
                } catch (err) {
                  console.error('Photo upload error', err);
                  allPhotosUploaded = false;
                  await updateAndPersist(prev => prev.map(pv => pv.id === latestV!.id ? { ...pv, findings: pv.findings.map(pf => pf.id === f.id ? { ...pf, photos: pf.photos.map(pp => pp.id === p.id ? { ...pp, uploadStatus: 'failed' as UploadStatus } : pp) } : pf) } : pv));
                }
              }
            }
          }

          if (!allPhotosUploaded) {
            throw new Error('Failed to upload some photos');
          }
        } catch (err: any) {
          console.error('Visit sync failed early', err);
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === latestV!.id) {
              const delay = Math.min(1000 * Math.pow(2, pv.syncAttemptCount || 1), 1000 * 60 * 60);
              return { ...pv, syncStatus: 'ERROR', syncError: err.message || 'Error', nextAttemptAt: Date.now() + delay };
            }
            return pv;
          }));
          continue;
        }

        // Build exact state for API sync
        const currentV = latestV!;
        const photos: VisitPhoto[] = currentV.findings.flatMap(f => f.photos.map(p => ({
          visitId: currentV.id,
          sectionId: f.sectionId,
          pointId: f.pointId,
          findingId: f.id,
          type: p.type,
          localId: p.id,
          objectPath: p.objectPath,
          uploadStatus: 'uploaded' as VisitPhotoUploadStatus,
          size: p.size,
        })));

        const input: VisitSyncInput = {
          visitId: currentV.id,
          operationId: currentV.operationId!,
          siteId: currentV.siteId,
          siteName: currentV.siteName,
          workOrder: currentV.workOrder,
          technician: currentV.technician,
          visitDate: currentV.visitDate,
          lifecycleStatus: currentV.lifecycleStatus,
          syncStatus: 'SINCRONIZADO',
          clientUpdatedAt: currentV.clientUpdatedAt,
          closedAt: currentV.closedAt,
          reopenedAt: currentV.reopenedAt,
          serverVersion: currentV.serverVersion || 0,
          sections: currentV.sections.map(s => ({
            id: s.id,
            title: s.title,
            name: s.name,
            status: s.status as VisitSectionStatus,
            points: s.points.map(pt => {
              const fds = currentV.findings.filter(f => f.pointId === pt.id).map(f => ({
                id: f.id,
                sectionId: f.sectionId,
                pointId: f.pointId,
                state: f.state as VisitFindingState,
                description: f.description,
                responsible: f.responsible,
                priority: f.priority as VisitFindingPriority,
                startDate: f.startDate,
                commitmentDate: f.commitmentDate,
                completedDate: f.completedDate,
              }));
              return {
                id: pt.id,
                title: pt.title,
                status: pt.status as VisitPointStatus,
                findings: fds
              };
            })
          })),
          auditEvents: currentV.auditEvents.map(a => ({
            id: a.id,
            eventType: a.eventType,
            occurredAt: a.occurredAt,
            actorId: a.actorId,
            metadata: a.metadata,
          })),
          photos
        };

        try {
          const conf = await syncVisit(input, { headers: { 'Idempotency-Key': currentV.operationId! }});
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === currentV.id) {
              return { 
                ...pv, 
                syncStatus: 'SINCRONIZADO', 
                serverVersion: conf.serverVersion, 
                confirmedAt: conf.confirmedAt, 
                syncError: undefined 
              };
            }
            return pv;
          }));
        } catch (err: any) {
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === currentV.id) {
              const delay = Math.min(1000 * Math.pow(2, pv.syncAttemptCount || 1), 1000 * 60 * 60);
              return { ...pv, syncStatus: 'ERROR', syncError: err.message || 'Error desconocido', nextAttemptAt: Date.now() + delay };
            }
            return pv;
          }));
        }
      }
    } finally {
      isSyncing.current = false;
    }
  }, [isOnline, isAuthenticated, updateAndPersist]);`;

  code = code.replace(syncQueueRegex, replaceStr);
}
replaceSyncQueue();

// Update mapSnapshotToLocal signature
code = code.replace(`function mapSnapshotToLocal(sv: VisitSnapshot): Visit {`, `function mapSnapshotToLocal(sv: VisitSnapshot, remoteUris: Record<string, string> = {}): Visit {`);
code = code.replace(/const expectedPath = \`\$\{FileSystem\.documentDirectory\}\$\{ph\.localId\}\`;\s*return \{[\s\S]*?uri: Platform\.OS === 'web' \? \(ph\.objectPath \|\| ''\) : expectedPath,/g, `const uri = remoteUris[ph.localId] || \`\$\{FileSystem.documentDirectory\}\$\{ph.localId\}\`;
             return {
               ...ph,
               uri: uri,`);

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
