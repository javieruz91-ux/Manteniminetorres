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
import { useTemplate } from '@/context/TemplateContext';
import { TemplateField } from '../types';
import * as SecureStore from 'expo-secure-store';
import {
  closeVisit as closeVisitRules,
  createDraftVisit,
  reopenVisit as reopenVisitRules,
  isSyncDue,
  retryDelayMs,
  saveFindingAndStatus as saveFindingAndStatusRules,
  setPointStatus,
  buildTemplateSyncSnapshot,
  getVisitConvenienceFields,
  buildStatusPointWire,
} from '../utils/maintenanceRules';

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
  updateResponse: (visitId: string, fieldId: string, value: unknown) => Promise<void>;
  getVisit: (id: string) => Visit | undefined;
  savePhoto: (tempUri: string, visitId: string, photoId?: string) => Promise<string>;
  triggerSync: () => void;
  isDemoMode: boolean;
  resetDemoData: () => Promise<string>;
}

const VisitContext = createContext<VisitContextValue | null>(null);

class VisitOperationChangedError extends Error {
  constructor() {
    super('La visita cambió mientras se sincronizaba; se conservará la nueva versión local.');
    this.name = 'VisitOperationChangedError';
  }
}

export function VisitProvider({ children }: { children: ReactNode }) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const visitsRef = useRef<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const { user, isAuthenticated } = useAuth();
  const { catalog } = useTemplate();
  const isDemoMode = __DEV__ && !isAuthenticated && process.env.EXPO_PUBLIC_DEMO_MODE !== 'false';
  
  const isHydrated = useRef(false);
  const currentNamespace = isDemoMode
    ? '@mantenimiento_demo_v1'
    : `@mantenimiento_visits_${user?.id || 'guest'}`;
  const cleanupNamespace = `${currentNamespace}_photo_cleanup`;
  const persistQueue = useRef(Promise.resolve<any>(null));
  const photoCleanupQueue = useRef(Promise.resolve<void>(undefined));
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serializePhotoCleanup = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = photoCleanupQueue.current.catch(() => undefined).then(operation);
    photoCleanupQueue.current = result.then(() => undefined, () => undefined);
    return result;
  };

  const enqueuePhotoCleanupFor = (
    namespace: string,
    photos: Photo[],
  ): Promise<void> => serializePhotoCleanup(async () => {
    if (photos.length === 0) return;
    const stored = await AsyncStorage.getItem(namespace);
    const pending: Photo[] = stored ? JSON.parse(stored) : [];
    const merged = new Map([...pending, ...photos].map(photo => [photo.id, photo]));
    await AsyncStorage.setItem(namespace, JSON.stringify([...merged.values()]));
  });

  const flushPhotoCleanupFor = (
    namespace: string,
    currentVisits: Visit[],
  ): Promise<void> => serializePhotoCleanup(async () => {
    const stored = await AsyncStorage.getItem(namespace);
    if (!stored) return;
    const pending: Photo[] = JSON.parse(stored);
    const referencedIds = new Set(
      currentVisits.flatMap(visit =>
        visit.findings.flatMap(finding => finding.photos.map(photo => photo.id)),
      ),
    );
    const failed: Photo[] = [];
    for (const photo of pending) {
      if (referencedIds.has(photo.id)) continue;
      try {
        if (Platform.OS === 'web') {
          if (photo.uri.startsWith('blob:')) URL.revokeObjectURL(photo.uri);
        } else if (
          FileSystem.documentDirectory &&
          photo.uri.startsWith(FileSystem.documentDirectory)
        ) {
          await FileSystem.deleteAsync(photo.uri, { idempotent: true });
        }
      } catch {
        failed.push(photo);
      }
    }
    if (failed.length > 0) {
      await AsyncStorage.setItem(namespace, JSON.stringify(failed));
    } else {
      await AsyncStorage.removeItem(namespace);
    }
  });

  const enqueuePhotoCleanup = (photos: Photo[]) =>
    enqueuePhotoCleanupFor(cleanupNamespace, photos);
  const flushPhotoCleanup = (currentVisits: Visit[]) =>
    flushPhotoCleanupFor(cleanupNamespace, currentVisits);

  // 1. Awaitable Persistence Barrier
  const updateAndPersist = useCallback((updater: (prev: Visit[]) => Visit[]): Promise<Visit[]> => {
    const nextPromise = persistQueue.current.catch(() => null).then(async () => {
      const previousState = visitsRef.current;
      const nextState = updater(previousState);
      const nextPhotoIds = new Set(
        nextState.flatMap(visit =>
          visit.findings.flatMap(finding => finding.photos.map(photo => photo.id)),
        ),
      );
      const removedPhotos = previousState.flatMap(visit =>
        visit.findings.flatMap(finding =>
          finding.photos.filter(photo => !nextPhotoIds.has(photo.id)),
        ),
      );
      await enqueuePhotoCleanup(removedPhotos);
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
      await flushPhotoCleanup(nextState);
      return nextState;
    });
    // Set queue tail to a promise that always resolves internally, but return the one that can reject to caller
    persistQueue.current = nextPromise.catch((e) => {
      console.error("Storage write failed", e);
      return null;
    });
    return nextPromise;
  }, [currentNamespace, cleanupNamespace]);

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
            const localVisit = merged[idx];
            const localIsDirty = ['PENDIENTE', 'SINCRONIZANDO', 'ERROR'].includes(
              localVisit.syncStatus,
            );
            const localIsNewer =
              new Date(localVisit.clientUpdatedAt).getTime() >
              new Date(sv.clientUpdatedAt).getTime();

            if (
              sv.serverVersion > (localVisit.serverVersion || 0) &&
              (!localIsDirty || !localIsNewer)
            ) {
              merged[idx] = mapSnapshotToLocal(
                sv,
                remoteUris,
                catalog &&
                  (sv as any).template &&
                  Number((sv as any).template.version) === Number(catalog.descriptor.version) &&
                  String((sv as any).template.sha256) === catalog.descriptor.hash
                  ? catalog.fields
                  : [],
              );
            } else {
              // Never replace a newer local revision with a server snapshot. We can
              // still advance the known server version and merge downloaded files.
              merged[idx] = {
                ...localVisit,
                serverVersion: Math.max(
                  localVisit.serverVersion || 0,
                  sv.serverVersion,
                ),
                findings: localVisit.findings.map(f => ({
                  ...f,
                  photos: f.photos.map(p => ({
                    ...p,
                    uri: remoteUris[p.id] || p.uri,
                  })),
                })),
              };
            }
          } else {
            merged.push(mapSnapshotToLocal(
              sv,
              remoteUris,
              catalog &&
                (sv as any).template &&
                Number((sv as any).template.version) === Number(catalog.descriptor.version) &&
                String((sv as any).template.sha256) === catalog.descriptor.hash
                ? catalog.fields
                : [],
            ));
          }
        });
        return merged;
      });
    } catch (e) {
      console.warn("Failed to fetch server visits", e);
    }
  }, [catalog?.fields, isAuthenticated, updateAndPersist]);

  // Load namespace
  useEffect(() => {
    let isMounted = true;
    const loadVisits = async () => {
      setIsLoading(true);
      setVisits([]); // clear while switching
      isHydrated.current = false;
      let parsed: Visit[] = [];
      try {
        const stored = await AsyncStorage.getItem(currentNamespace);
        if (stored) {
          parsed = JSON.parse(stored);
            // Older local drafts predate imported catalogs. Preserve them as
            // explicitly catalog-less drafts rather than reviving the demo
            // checklist.
            parsed = parsed.map(v => ({
              ...v,
              templateFields: Array.isArray(v.templateFields) ? v.templateFields : [],
              responses: v.responses && typeof v.responses === 'object' ? v.responses : {},
            }));
          // Crash recovery: revert SINCRONIZANDO -> PENDIENTE, preserving exact operationId
          parsed = parsed.map(v => {
            if (v.syncStatus === 'SINCRONIZANDO') {
              return {
                ...v,
                syncStatus: 'PENDIENTE',
                syncAttemptCount: (v.syncAttemptCount || 0) + 1,
                nextAttemptAt: Date.now(),
              };
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
          flushPhotoCleanup(parsed).catch(error =>
            console.warn('No se pudo completar la limpieza local de fotografías', error),
          );
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
                        const guestCleanupNamespace =
                          '@mantenimiento_visits_guest_photo_cleanup';
                        await enqueuePhotoCleanupFor(
                          guestCleanupNamespace,
                          guestVisits.flatMap(visit =>
                            visit.findings.flatMap(finding => finding.photos),
                          ),
                        );
                        await AsyncStorage.removeItem('@mantenimiento_visits_guest');
                        await flushPhotoCleanupFor(guestCleanupNamespace, []);
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
    if (!catalog && !isDemoMode) {
      throw new Error('Falta cargar la plantilla Excel original.');
    }
    if (
      catalog &&
      (!catalog.descriptor.ready || catalog.descriptor.unmappedCells.length > 0) &&
      !isDemoMode
    ) {
      throw new Error(
        'La plantilla tiene celdas editables sin mapear. Resuelve la auditoría antes de iniciar una visita.',
      );
    }
    const newVisit = createDraftVisit({
      ...data,
      template: catalog?.descriptor
        ? {
            id: catalog.descriptor.id,
            version: catalog.descriptor.version,
            hash: catalog.descriptor.hash,
          }
        : undefined,
      templateFields: catalog?.fields ?? [],
    }, {
      id: () => Crypto.randomUUID(),
      now: () => new Date().toISOString(),
    });
    newVisit.demoOnly = isDemoMode;
    
    await updateAndPersist(prev => [newVisit, ...prev]);
    return newVisit.id;
  };

  const resetDemoData = async (): Promise<string> => {
    if (!isDemoMode) {
      throw new Error('El modo demo solo está disponible durante el desarrollo.');
    }
    const demoVisit = createDraftVisit(
      {
        siteId: 'DEMO-SITIO-001',
        siteName: 'Sitio ficticio de capacitación',
        workOrder: 'OT-DEMO-001',
        technician: 'Técnico de demostración',
      },
      {
        id: () => Crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
    );
    demoVisit.demoOnly = true;
    demoVisit.syncError =
      'Modo demo: la sincronización y la subida de fotografías no se envían al servidor.';
    await updateAndPersist(() => [demoVisit]);
    return demoVisit.id;
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

  const updateResponse = async (
    visitId: string,
    fieldId: string,
    value: unknown,
  ): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error('Visita no encontrada');
      if (existing.lifecycleStatus === 'CERRADA') {
        throw new Error('No se puede editar una visita cerrada');
      }
      return prev.map(v =>
        v.id === visitId
          ? (() => {
              const responses = { ...v.responses, [fieldId]: value };
              return {
                ...v,
                ...getVisitConvenienceFields({ templateFields: v.templateFields, responses }),
                responses,
                clientUpdatedAt: new Date().toISOString(),
                operationId: Crypto.randomUUID(),
                syncStatus: 'PENDIENTE' as const,
              };
            })()
          : v,
      );
    });
  };

  const closeVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      const closed = closeVisitRules(existing, auditEvent, {
        id: () => Crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      return prev.map(v => v.id === id ? closed : v);
    });
  };

  const reopenVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      const reopened = reopenVisitRules(existing, auditEvent, {
        id: () => Crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      return prev.map(v => v.id === id ? reopened : v);
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
      const updated = setPointStatus(existing, sectionId, pointId, status, {
        id: () => Crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      return prev.map(v => v.id === visitId ? updated : v);
    });
  };

  const saveFindingAndStatus = async (visitId: string, pointId: string, sectionId: string, status: ChecklistStatus, finding: Finding | null): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error("Visita no encontrada");
      const updated = saveFindingAndStatusRules(existing, sectionId, pointId, status, finding, {
        id: () => Crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      return prev.map(v => v.id === visitId ? updated : v);
    });
  };

  const savePhoto = async (
    tempUri: string,
    visitId: string,
    photoId?: string,
  ): Promise<string> => {
    if (Platform.OS === 'web') return tempUri;
    
    const ext = tempUri.split('.').pop() || 'jpg';
    const newName = `${visitId}_${Crypto.randomUUID()}.${ext}`;
    const dest = `${FileSystem.documentDirectory}${newName}`;
    
    await FileSystem.copyAsync({ from: tempUri, to: dest });
    
    const fileInfo = await FileSystem.getInfoAsync(dest);
    if (!fileInfo.exists) {
      throw new Error('Failed to copy file to documentDirectory');
    }
    // A copied file is provisional until a visit mutation references it. If
    // persistence fails, the durable cleanup queue removes it on the next
    // successful write or app hydration.
    try {
      await enqueuePhotoCleanup([{
        id: photoId ?? newName,
        uri: dest,
        type: 'GENERAL',
        timestamp: Date.now(),
        objectPath: null,
        uploadStatus: 'pending',
      }]);
    } catch (error) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
      throw error;
    }
    
    return dest;
  };

  const getVisit = (id: string) => visits.find(v => v.id === id);

  // Sync Loop
  const isSyncing = useRef(false);

  const processSyncQueue = useCallback(async () => {
    if (isDemoMode || isSyncing.current || !isOnline || !isHydrated.current || !isAuthenticated) return;

    const pendingVisits = visitsRef.current.filter(v => isSyncDue(v));
    if (pendingVisits.length === 0) return;

    isSyncing.current = true;

    try {
      for (const visit of pendingVisits) {
        const persistedState = await updateAndPersist(prev => prev.map(v => {
          if (v.id === visit.id) {
            return {
              ...v,
              syncStatus: 'SINCRONIZANDO' as const,
              syncAttemptCount: (v.syncAttemptCount || 0) + 1,
            };
          }
          return v;
        }));

        let latestV = persistedState.find(v => v.id === visit.id);
        if (!latestV?.operationId) continue;

        const syncVisitId = latestV.id;
        const syncOperationId = latestV.operationId;
        const persistOperationState = async (
          updater: (current: Visit) => Visit,
        ): Promise<Visit> => {
          let matchedOperation = false;
          const nextState = await updateAndPersist(prev => prev.map(current => {
            if (current.id === syncVisitId && current.operationId === syncOperationId) {
              matchedOperation = true;
              return updater(current);
            }
            return current;
          }));
          if (!matchedOperation) throw new VisitOperationChangedError();
          const current = nextState.find(v => v.id === syncVisitId);
          if (!current) throw new VisitOperationChangedError();
          return current;
        };

        try {
          let allPhotosUploaded = true;
          for (const finding of latestV.findings) {
            for (const photo of finding.photos) {
              if (photo.uploadStatus === 'uploaded') continue;

              try {
                const response = await fetch(photo.uri);
                if (!response.ok) throw new Error(`No se pudo leer la foto (${response.status})`);
                const blob = await response.blob();
                const ext = photo.uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
                const contentType: UploadUrlRequestContentType =
                  ext === 'png' ? 'image/png' : 'image/jpeg';
                const urlRes = await requestUploadUrl({
                  name: `${photo.id}.${ext}`,
                  size: blob.size || 1024,
                  contentType,
                  visitId: syncVisitId,
                  sectionId: finding.sectionId,
                  pointId: finding.pointId,
                  findingId: finding.id,
                  type: photo.type,
                  localId: photo.id,
                });

                latestV = await persistOperationState(current => ({
                  ...current,
                  findings: current.findings.map(item =>
                    item.id === finding.id
                      ? {
                          ...item,
                          photos: item.photos.map(itemPhoto =>
                            itemPhoto.id === photo.id
                              ? {
                                  ...itemPhoto,
                                  uploadStatus: 'uploading' as UploadStatus,
                                  objectPath: urlRes.objectPath,
                                }
                              : itemPhoto,
                          ),
                        }
                      : item,
                  ),
                }));

                const uploadRes = await fetch(urlRes.uploadURL, {
                  method: 'PUT',
                  headers: { 'Content-Type': contentType },
                  body: blob,
                });
                if (!uploadRes.ok) {
                  throw new Error(`La carga de la foto falló (${uploadRes.status})`);
                }

                latestV = await persistOperationState(current => ({
                  ...current,
                  findings: current.findings.map(item =>
                    item.id === finding.id
                      ? {
                          ...item,
                          photos: item.photos.map(itemPhoto =>
                            itemPhoto.id === photo.id
                              ? {
                                  ...itemPhoto,
                                  uploadStatus: 'uploaded' as UploadStatus,
                                  objectPath: urlRes.objectPath,
                                }
                              : itemPhoto,
                          ),
                        }
                      : item,
                  ),
                }));
              } catch (error) {
                if (error instanceof VisitOperationChangedError) throw error;
                console.error('Photo upload error', error);
                allPhotosUploaded = false;
                await persistOperationState(current => ({
                  ...current,
                  findings: current.findings.map(item =>
                    item.id === finding.id
                      ? {
                          ...item,
                          photos: item.photos.map(itemPhoto =>
                            itemPhoto.id === photo.id
                              ? { ...itemPhoto, uploadStatus: 'failed' as UploadStatus }
                              : itemPhoto,
                          ),
                        }
                      : item,
                  ),
                }));
              }
            }
          }

          if (!allPhotosUploaded) {
            throw new Error('No se pudieron cargar todas las fotos');
          }
        } catch (error) {
          if (error instanceof VisitOperationChangedError) continue;
          const message = error instanceof Error ? error.message : 'Error';
          console.error('Visit sync failed early', error);
          await updateAndPersist(prev => prev.map(current => {
            if (current.id === syncVisitId && current.operationId === syncOperationId) {
              return {
                ...current,
                syncStatus: 'ERROR',
                syncError: message,
                nextAttemptAt: Date.now() + retryDelayMs(current.syncAttemptCount || 1),
              };
            }
            return current;
          }));
          continue;
        }

        const currentV = latestV;
        const convenience = getVisitConvenienceFields(currentV);
        const photos: VisitPhoto[] = currentV.findings.flatMap(f =>
          f.photos.map(p => ({
            visitId: currentV.id,
            sectionId: f.sectionId,
            pointId: f.pointId,
            findingId: f.id,
            type: p.type,
            localId: p.id,
            objectPath: p.objectPath,
            uploadStatus: 'uploaded' as VisitPhotoUploadStatus,
            size: p.size,
          })),
        );

        const input: VisitSyncInput & Record<string, unknown> = {
          visitId: currentV.id,
          operationId: syncOperationId,
          siteId: currentV.siteId || convenience.siteId,
          siteName: currentV.siteName || convenience.siteName,
          workOrder: currentV.workOrder || convenience.workOrder,
          technician: currentV.technician || convenience.technician,
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
              const wirePoint = buildStatusPointWire(
                pt,
                currentV.templateFields,
                currentV.responses ?? {},
              );
              return {
              id: pt.id,
              title: pt.title,
              fields: wirePoint.fields,
              status: wirePoint.status as VisitPointStatus,
              findings: currentV.findings
                .filter(f => f.pointId === pt.id)
                .map(f => ({
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
                })),
              };
            }),
          })),
          auditEvents: currentV.auditEvents.map(a => ({
            id: a.id,
            eventType: a.eventType,
            occurredAt: a.occurredAt,
            actorId: a.actorId,
            metadata: a.metadata,
          })),
          photos,
          ...buildTemplateSyncSnapshot(currentV),
          responses: currentV.responses as Record<string, string | number | boolean | null>,
        };

        try {
          const conf = await syncVisit(input, {
            headers: { 'Idempotency-Key': syncOperationId },
          });
          await updateAndPersist(prev => prev.map(current => {
            if (current.id === syncVisitId) {
              if (current.operationId === syncOperationId) {
                return {
                  ...current,
                  syncStatus: 'SINCRONIZADO',
                  serverVersion: conf.serverVersion,
                  confirmedAt: conf.confirmedAt,
                  syncError: undefined,
                  nextAttemptAt: undefined,
                };
              }
              // The server accepted the older operation, but a newer local
              // revision must remain pending. Only advance its base version.
              return {
                ...current,
                serverVersion: Math.max(current.serverVersion || 0, conf.serverVersion),
                confirmedAt: conf.confirmedAt,
              };
            }
            return current;
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Error desconocido';
          await updateAndPersist(prev => prev.map(current => {
            if (current.id === syncVisitId && current.operationId === syncOperationId) {
              return {
                ...current,
                syncStatus: 'ERROR',
                syncError: message,
                nextAttemptAt: Date.now() + retryDelayMs(current.syncAttemptCount || 1),
              };
            }
            return current;
          }));
        }
      }
    } finally {
      isSyncing.current = false;
    }
  }, [isDemoMode, isOnline, isAuthenticated, updateAndPersist]);

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
      updateResponse,
      getVisit,
      savePhoto,
      triggerSync,
      isDemoMode,
      resetDemoData
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

function mapSnapshotToLocal(
  sv: VisitSnapshot,
  remoteUris: Record<string, string> = {},
  fallbackTemplateFields: TemplateField[] = [],
): Visit {
  const remoteTemplate = (sv as any).template as
    | { version?: number; sha256?: string; id?: string; hash?: string }
    | null
    | undefined;
  const rawTemplateFields = (sv as any).templateFields as any[] | undefined;
  const remoteTemplateFields: TemplateField[] = rawTemplateFields?.length
    ? rawTemplateFields.map(normalizeWireTemplateField)
    : fallbackTemplateFields;
  const restoredResponses = ((sv as any).responses ||
    sv.sections.reduce((all, section) => ({
      ...all,
      ...section.points.reduce((fields, point) => ({ ...fields, ...(point as any).fields }), {}),
    }), {})) as Record<string, unknown>;
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
          startDate: normalizeDateOnly(f.startDate),
          commitmentDate: normalizeDateOnly(f.commitmentDate),
          completedDate: f.completedDate ? normalizeDateOnly(f.completedDate) : null,
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
    siteId: sv.siteId || '',
    siteName: sv.siteName || '',
    workOrder: sv.workOrder || '',
    technician: sv.technician || '',
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
    template: remoteTemplate
      ? {
          id: remoteTemplate.id || remoteTemplate.sha256 || remoteTemplate.hash || '',
          version: String(remoteTemplate.version ?? ''),
          hash: remoteTemplate.hash || remoteTemplate.sha256 || '',
        }
      : undefined,
    templateFields: remoteTemplateFields,
    responses: restoredResponses,
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

function normalizeDateOnly(value: string): string {
  return value.includes('T') ? value.slice(0, 10) : value;
}

function normalizeWireTemplateField(field: any): TemplateField {
  const target = String(field.target ?? '');
  const separator = target.indexOf('!');
  const sheet = String(field.sheet ?? (separator >= 0 ? target.slice(0, separator) : ''));
  const ref = separator >= 0 ? target.slice(separator + 1) : target;
  return {
    id: String(field.id ?? field.key ?? `${sheet}:${ref}`),
    label: String(field.label ?? ''),
    fullText: field.sourceEvidence ?? field.label,
    sheet,
    section: String(field.section ?? field.subsection ?? ''),
    subsection: field.subsection,
    type: (field.type ?? field.responseType ?? 'text') as TemplateField['type'],
    options: Array.isArray(field.options) ? field.options.map(String) : [],
    required: Boolean(field.required),
    applicability: field.applicability,
    evidenceSlot: field.evidenceSlot,
    target: ref.includes(':') ? { range: ref } : { cell: ref },
    editable: field.state !== 'ignored',
    mapped: field.state !== 'unresolved',
    isTitle: false,
  };
}