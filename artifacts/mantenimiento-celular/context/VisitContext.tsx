import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { Visit, Section, ChecklistStatus, Finding, Photo, AuditEvent, PhotoType, UploadStatus, VisitSnapshotLifecycleStatus, VisitSnapshotSyncStatus, FindingPriority, FindingState } from '../types';
import { syncVisit, requestUploadUrl, listVisits } from '@workspace/api-client-react';
import { VisitSyncInput, VisitPhoto, VisitPhotoUploadStatus, UploadUrlRequestContentType, VisitSnapshot, VisitFindingState, VisitFindingPriority, VisitSectionStatus, VisitPointStatus } from '@workspace/api-client-react';
import { Platform } from 'react-native';
import { useAuth } from '@/lib/auth';
import * as SecureStore from 'expo-secure-store';
import { createInitialSections } from '../data/checklist';

interface VisitContextValue {
  visits: Visit[];
  isLoading: boolean;
  isOnline: boolean;
  createVisit: (data: Partial<Visit>) => Promise<string>;
  updateVisit: (id: string, data: Partial<Visit>) => Promise<void>;
  closeVisit: (id: string, auditEvent: AuditEvent) => Promise<void>;
  reopenVisit: (id: string, auditEvent: AuditEvent) => Promise<void>;
  deleteVisit: (id: string) => Promise<void>;
  updatePointStatus: (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus) => Promise<void>;
  saveFindingAndStatus: (visitId: string, pointId: string, sectionId: string, status: ChecklistStatus, finding: Finding | null) => Promise<void>;
  getVisit: (id: string) => Visit | undefined;
  savePhoto: (tempUri: string, visitId: string) => Promise<string>;
  triggerSync: () => void;
}

const VisitContext = createContext<VisitContextValue | null>(null);

export function VisitProvider({ children }: { children: ReactNode }) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const visitsRef = useRef<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const { user, isAuthenticated } = useAuth();
  
  const isHydrated = useRef(false);
  const currentNamespace = `@mantenimiento_visits_${user?.id || 'guest'}`;
  const persistQueue = useRef(Promise.resolve<any>(null));
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Awaitable Persistence Barrier
  const updateAndPersist = useCallback((updater: (prev: Visit[]) => Visit[]): Promise<Visit[]> => {
    const nextPromise = persistQueue.current.catch(() => null).then(async () => {
      const nextState = updater(visitsRef.current);
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
      return nextState;
    });
    // Set queue tail to a promise that always resolves internally, but return the one that can reject to caller
    persistQueue.current = nextPromise.catch((e) => {
      console.error("Storage write failed", e);
      return null;
    });
    return nextPromise;
  }, [currentNamespace]);

  const mutateVisits = useCallback((updater: (prev: Visit[]) => Visit[]) => {
    updateAndPersist(updater).catch(e => console.error("mutateVisits error", e));
  }, [updateAndPersist]);

  

  // Download photos securely
  const fetchAndMergeServerVisits = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const serverVisits = await listVisits();
      const token = Platform.OS === 'web' ? localStorage.getItem('auth_session_token') : await SecureStore.getItemAsync('auth_session_token');
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const remoteUris: Record<string, string> = {};

      if (token && domain) {
        for (const sv of serverVisits) {
          for (const photo of sv.photos) {
            if (!photo.objectPath) continue;
            const safePath = photo.objectPath.startsWith('/') ? photo.objectPath : `/${photo.objectPath}`;
            const url = `https://${domain}/api/storage${safePath}`;
            
            if (Platform.OS === 'web') {
              try {
                const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok && res.headers.get('content-type')?.includes('image')) {
                  const blob = await res.blob();
                  remoteUris[photo.localId] = URL.createObjectURL(blob);
                }
              } catch (e) {
                console.warn("Failed to download photo web", e);
              }
            } else {
              let finalDest = '';
              const destJpg = `${FileSystem.documentDirectory}${photo.localId}.jpg`;
              const destPng = `${FileSystem.documentDirectory}${photo.localId}.png`;
              const infoJpg = await FileSystem.getInfoAsync(destJpg);
              const infoPng = await FileSystem.getInfoAsync(destPng);
              
              if (infoJpg.exists && ('size' in infoJpg && infoJpg.size > 0)) {
                finalDest = destJpg;
              } else if (infoPng.exists && ('size' in infoPng && infoPng.size > 0)) {
                finalDest = destPng;
              }
              
              if (!finalDest) {
                // Delete legacy extensionless if it exists
                const legacyDest = `${FileSystem.documentDirectory}${photo.localId}`;
                const legacyInfo = await FileSystem.getInfoAsync(legacyDest);
                if (legacyInfo.exists) await FileSystem.deleteAsync(legacyDest, { idempotent: true });

                try {
                  const tempDest = `${FileSystem.documentDirectory}temp_${photo.localId}`;
                  const res = await FileSystem.downloadAsync(url, tempDest, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  if (res.status >= 200 && res.status < 300 && res.headers['content-type']?.includes('image')) {
                    const isPng = res.headers['content-type'].includes('png');
                    const ext = isPng ? '.png' : '.jpg';
                    const targetDest = `${FileSystem.documentDirectory}${photo.localId}${ext}`;
                    await FileSystem.moveAsync({ from: tempDest, to: targetDest });
                    remoteUris[photo.localId] = targetDest;
                  } else {
                    await FileSystem.deleteAsync(tempDest, { idempotent: true });
                    console.warn("Invalid photo response", res.status);
                  }
                } catch (e) {
                  console.warn("Failed to download photo native", e);
                }
              } else {
                remoteUris[photo.localId] = finalDest;
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
            } else {
              // Merge only URIs on equal version to handle session blobs or newly downloaded native extensions
              merged[idx] = {
                ...merged[idx],
                findings: merged[idx].findings.map(f => ({
                  ...f,
                  photos: f.photos.map(p => ({
                    ...p,
                    uri: remoteUris[p.id] || p.uri
                  }))
                }))
              };
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
  }, [isAuthenticated, updateAndPersist]);

  // Load namespace
  useEffect(() => {
    let isMounted = true;
    const loadVisits = async () => {
      setIsLoading(true);
      setVisits([]); // clear while switching
      isHydrated.current = false;
      try {
        const stored = await AsyncStorage.getItem(currentNamespace);
        let parsed: Visit[] = [];
        if (stored) {
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
        }
      } catch (e) {
        console.error('Error loading visits', e);
      } finally {
        if (isMounted) {
          isHydrated.current = true;
          setIsLoading(false);
          fetchAndMergeServerVisits();
        }
      }
    };
    loadVisits();
    return () => { isMounted = false; };
  }, [currentNamespace, fetchAndMergeServerVisits]);

  // Guest adoption
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const checkGuestDrafts = async () => {
        try {
          const guestStored = await AsyncStorage.getItem('@mantenimiento_visits_guest');
          if (guestStored) {
            const guestVisits: Visit[] = JSON.parse(guestStored);
            if (guestVisits.length > 0) {
              import('react-native').then(({ Alert }) => {
                Alert.alert(
                  'Borradores Offline',
                  'Tienes visitas creadas sin conexión. ¿Deseas asignarlas a esta cuenta para sincronizarlas?',
                  [
                    { 
                      text: 'No, descartar', 
                      style: 'destructive',
                      onPress: async () => {
                        await AsyncStorage.removeItem('@mantenimiento_visits_guest');
                      }
                    },
                    {
                      text: 'Sí, adoptar',
                      onPress: async () => {
                        mutateVisits(prev => {
                          const adopted = guestVisits.map(v => ({ 
                            ...v, 
                            operationId: Crypto.randomUUID(),
                            syncStatus: 'PENDIENTE' as const
                          }));
                          return [...prev, ...adopted];
                        });
                        await AsyncStorage.removeItem('@mantenimiento_visits_guest');
                      }
                    }
                  ]
                );
              });
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
      checkGuestDrafts();
    }
  }, [isAuthenticated, user?.id, mutateVisits]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(!!state.isConnected && !!state.isInternetReachable);
    });
    return unsubscribe;
  }, []);

  const createVisit = async (data: Partial<Visit>): Promise<string> => {
    const newVisit: Visit = {
      id: Crypto.randomUUID(),
      siteId: data.siteId || '',
      siteName: data.siteName || '',
      workOrder: data.workOrder || '',
      technician: data.technician || '',
      visitDate: new Date().toISOString(),
      clientUpdatedAt: new Date().toISOString(),
      lifecycleStatus: 'BORRADOR',
      syncStatus: 'PENDIENTE',
      closedAt: null,
      reopenedAt: null,
      serverVersion: 0,
      sections: createInitialSections(),
      findings: [],
      auditEvents: [],
      operationId: Crypto.randomUUID(),
      syncAttemptCount: 0
    };
    
    await updateAndPersist(prev => [newVisit, ...prev]);
    return newVisit.id;
  };

  const updateVisit = async (id: string, data: Partial<Visit>): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada");
      
      return prev.map(v => {
        if (v.id === id) {
          const { lifecycleStatus, auditEvents, operationId, serverVersion, syncStatus, syncAttemptCount, nextAttemptAt, syncError, confirmedAt, closedAt, reopenedAt, ...safeData } = data;
          
          const nextData = { 
            ...v, 
            ...safeData, 
            clientUpdatedAt: new Date().toISOString() 
          };
          nextData.operationId = Crypto.randomUUID();
          nextData.syncStatus = 'PENDIENTE';
          return nextData as Visit;
        }
        return v;
      });
    });
  };

  const closeVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus !== 'BORRADOR' && existing.lifecycleStatus !== 'ABIERTA' && existing.lifecycleStatus !== 'REABIERTA') {
        throw new Error("Transición inválida: Solo visitas abiertas pueden ser cerradas.");
      }
      
      return prev.map(v => {
        if (v.id === id) {
          return {
            ...v,
            lifecycleStatus: 'CERRADA',
            closedAt: new Date().toISOString(),
            auditEvents: [...v.auditEvents, auditEvent],
            nextAttemptAt: Date.now(),
            syncAttemptCount: 0,
            syncStatus: 'PENDIENTE',
            operationId: Crypto.randomUUID(),
            clientUpdatedAt: new Date().toISOString()
          };
        }
        return v;
      });
    });
  };

  const reopenVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus !== 'CERRADA') {
        throw new Error("Transición inválida: Solo visitas cerradas pueden ser reabiertas.");
      }
      
      return prev.map(v => {
        if (v.id === id) {
          return {
            ...v,
            lifecycleStatus: 'REABIERTA',
            reopenedAt: new Date().toISOString(),
            auditEvents: [...v.auditEvents, auditEvent],
            nextAttemptAt: Date.now(),
            syncAttemptCount: 0,
            syncStatus: 'PENDIENTE',
            operationId: Crypto.randomUUID(),
            clientUpdatedAt: new Date().toISOString()
          };
        }
        return v;
      });
    });
  };

  const deleteVisit = async (id: string): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') {
        throw new Error("No se puede eliminar una visita cerrada.");
      }
      if (existing.syncStatus === 'SINCRONIZANDO') {
        throw new Error("No se puede eliminar una visita mientras se sincroniza.");
      }
      return prev.filter(v => v.id !== id);
    });
  };

  const updatePointStatus = async (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada.");

      return prev.map(v => {
        if (v.id === visitId) {
          const sections = v.sections.map(s => {
            if (s.id === sectionId) {
              const points = s.points.map(p => p.id === pointId ? { ...p, status } : p);
              return { ...s, points };
            }
            return s;
          });
          return { ...v, sections, clientUpdatedAt: new Date().toISOString(), operationId: Crypto.randomUUID(), syncStatus: 'PENDIENTE' };
        }
        return v;
      });
    });
  };

  const saveFindingAndStatus = async (visitId: string, pointId: string, sectionId: string, status: ChecklistStatus, finding: Finding | null): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada.");

      return prev.map(v => {
        if (v.id === visitId) {
          const sections = v.sections.map(s => {
            if (s.id === sectionId) {
              const points = s.points.map(p => p.id === pointId ? { ...p, status } : p);
              return { ...s, points };
            }
            return s;
          });
          
          let findings = [...v.findings];
          if (finding) {
            const existingIdx = findings.findIndex(f => f.id === finding.id);
            if (existingIdx >= 0) {
              findings[existingIdx] = finding;
            } else {
              findings.push(finding);
            }
          } else {
            findings = findings.filter(f => f.pointId !== pointId);
          }

          return { ...v, sections, findings, clientUpdatedAt: new Date().toISOString(), operationId: Crypto.randomUUID(), syncStatus: 'PENDIENTE' };
        }
        return v;
      });
    });
  };

  const savePhoto = async (tempUri: string, visitId: string): Promise<string> => {
    if (Platform.OS === 'web') return tempUri;
    
    const ext = tempUri.split('.').pop() || 'jpg';
    const newName = `${visitId}_${Crypto.randomUUID()}.${ext}`;
    const dest = `${FileSystem.documentDirectory}${newName}`;
    
    await FileSystem.copyAsync({ from: tempUri, to: dest });
    
    const fileInfo = await FileSystem.getInfoAsync(dest);
    if (!fileInfo.exists) {
      throw new Error('Failed to copy file to documentDirectory');
    }
    
    return dest;
  };

  const getVisit = (id: string) => visits.find(v => v.id === id);

  // Sync Loop
  const isSyncing = useRef(false);

  const processSyncQueue = useCallback(async () => {
    if (isSyncing.current || !isOnline || !isHydrated.current || !isAuthenticated) return;
    
    let pendingVisits = visitsRef.current.filter(v => 
      (v.syncStatus === 'PENDIENTE' || v.syncStatus === 'ERROR') && 
      (v.nextAttemptAt || 0) <= Date.now()
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
                    visitId: latestV!.id,
                    sectionId: f.sectionId,
                    pointId: f.pointId,
                    findingId: f.id,
                    type: p.type,
                    localId: p.id
                  });

                  
                  // Awaitable crash boundary: save path immediately BEFORE PUT
                  const stateBeforeUpload = await updateAndPersist(prev => prev.map(pv => {
                    if (pv.id === latestV!.id && pv.operationId === latestV!.operationId) {
                      const updatedFindings = pv.findings.map(pf => {
                        if (pf.id === f.id) {
                          return { ...pf, photos: pf.photos.map(pp => pp.id === p.id ? { ...pp, uploadStatus: 'uploading' as UploadStatus, objectPath: urlRes.objectPath } : pp) };
                        }
                        return pf;
                      });
                      return { ...pv, findings: updatedFindings };
                    }
                    return pv;
                  }));
                  
                  latestV = stateBeforeUpload.find(v => v.id === latestV!.id);
                  if (!latestV || latestV.operationId !== persistedState.find(v => v.id === visit.id)?.operationId) {
                     // Abort if operation changed during url fetch
                     throw new Error('Operation ID changed during requestUploadUrl');
                  }

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
          }));
        } catch (err: any) {
          await updateAndPersist(prev => prev.map(pv => {
            if (pv.id === currentV.id && pv.operationId === currentV.operationId) {
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
  }, [isOnline, isAuthenticated, updateAndPersist]);

  const scheduleNextSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    
    let earliest = Infinity;
    const now = Date.now();
    let hasImmediate = false;
    
    for (const v of visits) {
      if (v.syncStatus === 'PENDIENTE' || v.syncStatus === 'ERROR') {
        const attemptAt = v.nextAttemptAt || 0;
        if (attemptAt <= now) {
          hasImmediate = true;
          break;
        }
        if (attemptAt < earliest) {
          earliest = attemptAt;
        }
      }
    }
    
    if (hasImmediate) {
      processSyncQueue();
    } else if (earliest !== Infinity) {
      const delay = Math.max(earliest - Date.now(), 100);
      syncTimerRef.current = setTimeout(processSyncQueue, delay);
    }
  }, [visits, processSyncQueue]);

  useEffect(() => {
    scheduleNextSync();
  }, [scheduleNextSync]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') processSyncQueue();
    });
    return () => sub.remove();
  }, [processSyncQueue]);

  const triggerSync = useCallback(() => {
    processSyncQueue();
  }, [processSyncQueue]);

  return (
    <VisitContext.Provider value={{
      visits,
      isLoading,
      isOnline,
      createVisit,
      updateVisit,
      closeVisit,
      reopenVisit,
      deleteVisit,
      updatePointStatus,
      saveFindingAndStatus,
      getVisit,
      savePhoto,
      triggerSync
    }}>
      {children}
    </VisitContext.Provider>
  );
}

export function useVisits() {
  const context = useContext(VisitContext);
  if (!context) throw new Error('useVisits must be used within VisitProvider');
  return context;
}

function mapSnapshotToLocal(sv: VisitSnapshot, remoteUris: Record<string, string> = {}): Visit {
  const findings: Finding[] = [];
  sv.sections.forEach(s => {
    s.points.forEach(p => {
      p.findings.forEach(f => {
        findings.push({
          id: f.id,
          sectionId: f.sectionId,
          pointId: f.pointId,
          description: f.description,
          responsible: f.responsible,
          priority: f.priority as FindingPriority,
          startDate: f.startDate,
          commitmentDate: f.commitmentDate,
          completedDate: f.completedDate,
          state: f.state as FindingState,
          photos: sv.photos.filter(ph => ph.findingId === f.id).map(ph => {
             // For restored photos without local file, the uri should be the documentDirectory path.
             const uri = remoteUris[ph.localId] || `${FileSystem.documentDirectory}${ph.localId}`;
             return {
               id: ph.localId,
               uri: uri,
               type: ph.type as PhotoType,
               timestamp: 0,
               objectPath: ph.objectPath,
               uploadStatus: ph.uploadStatus as UploadStatus,
               size: ph.size,
             };
          })
        });
      });
    });
  });

  return {
    id: sv.visitId,
    siteId: sv.siteId,
    siteName: sv.siteName,
    workOrder: sv.workOrder,
    technician: sv.technician,
    visitDate: sv.visitDate,
    clientUpdatedAt: sv.clientUpdatedAt,
    lifecycleStatus: sv.lifecycleStatus as VisitSnapshotLifecycleStatus,
    syncStatus: sv.syncStatus as VisitSnapshotSyncStatus,
    closedAt: sv.closedAt,
    reopenedAt: sv.reopenedAt,
    serverVersion: sv.serverVersion,
    sections: sv.sections.map(s => ({
      id: s.id,
      name: s.name,
      title: s.title,
      status: s.status as ChecklistStatus,
      points: s.points.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status as ChecklistStatus,
      }))
    })),
    findings,
    auditEvents: sv.auditEvents.map(a => ({
      id: a.id,
      eventType: a.eventType,
      occurredAt: a.occurredAt,
      actorId: a.actorId || undefined,
      metadata: a.metadata,
    })),
    operationId: Crypto.randomUUID(),
    syncAttemptCount: 0
  };
}