import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth';
import {
  getTemplate,
  importTemplate,
  importTemplateLocally,
  normalizeTemplateCatalog,
  saveTemplateMappings,
  type TemplateImportInput,
  type TemplateMapping,
} from '@/lib/templateApi';
import { shouldReplaceCachedCatalog } from '@/utils/catalogMigration';
import {
  CURRENT_CATALOG_SCHEMA_VERSION,
  type TemplateCatalog,
} from '@/types';
import { getApiBaseUrl } from '@/lib/runtimeConfig';

const cacheKey = (ownerId: string) => `@mantenimiento_template_${ownerId}`;
const LOCAL_CATALOG_KEY = '@mantenimiento_template_local';
const LOCAL_SOURCE_KEY = '@mantenimiento_template_local_source';

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(result);
}

interface TemplateContextValue {
  catalog: TemplateCatalog | null;
  isLoading: boolean;
  error: string | null;
  sourceBase64: string | null;
  sourceFileName: string | null;
  refresh: () => Promise<void>;
  uploadLocal: (input: TemplateImportInput) => Promise<TemplateCatalog>;
  upload: (input: TemplateImportInput) => Promise<TemplateCatalog>;
  saveMappings: (mappings: TemplateMapping[]) => Promise<void>;
}

const TemplateContext = createContext<TemplateContextValue | null>(null);

export function TemplateProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceBase64, setSourceBase64] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);

  const persist = useCallback(
    async (next: TemplateCatalog | null) => {
      setCatalog(next);
      if (next) {
        await AsyncStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(next));
        if (user?.id) {
          await AsyncStorage.setItem(cacheKey(user.id), JSON.stringify(next));
        }
      }
    },
    [user?.id],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isAuthenticated && user?.id) {
        const remote = await getTemplate();
        const localSource = await AsyncStorage.getItem(LOCAL_SOURCE_KEY);
        let region8Active = false;
        try { region8Active = JSON.parse(localSource || 'null')?.fileName === 'plantilla_region8_limpia.xlsx'; }
        catch { /* A damaged cache can still be replaced by the remote template. */ }
        if (
          remote &&
          remote.descriptor.schemaVersion >= CURRENT_CATALOG_SCHEMA_VERSION &&
          !region8Active
        ) {
          await persist(remote);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar la plantilla.');
      // Keep the local copy for offline rendering.
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, persist, user?.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      const localCatalog = await AsyncStorage.getItem(LOCAL_CATALOG_KEY);
      const localSource = await AsyncStorage.getItem(LOCAL_SOURCE_KEY);
      let cachedCatalog: TemplateCatalog | null = null;
      let storedSource: { fileName: string; contentBase64: string } | null = null;
      try {
        if (localCatalog) {
          cachedCatalog = normalizeTemplateCatalog(JSON.parse(localCatalog));
        }
        if (localSource) {
          const parsed = JSON.parse(localSource);
          if (parsed?.fileName && parsed?.contentBase64) storedSource = parsed;
        }
      } catch {
        await AsyncStorage.removeItem(LOCAL_CATALOG_KEY);
        cachedCatalog = null;
      }

      if (Platform.OS !== 'web' && cachedCatalog && mounted) {
        setCatalog(cachedCatalog);
      }
      if (storedSource && mounted) {
        setSourceFileName(storedSource.fileName);
        setSourceBase64(storedSource.contentBase64);
      }

      let next: TemplateCatalog | null = null;
      let nextSource = storedSource;
      let canonicalFileName: string | null = null;
      if (Platform.OS === 'web') {
        let fileName = 'Mantenimiento_Preventivo_a_Sitios_Celulares.xlsx';
        let contentBase64: string | null = null;
        const apiBase = getApiBaseUrl();
        try {
          const trialResponse = await fetch(`${apiBase}/api/templates/trial-local`, {
            cache: 'no-store',
          });
          if (trialResponse.ok) {
            const trial = await trialResponse.json();
            const canonical = normalizeTemplateCatalog(trial);
            const trialSourceFileName = trial.source?.fileName || fileName;
            canonicalFileName = trialSourceFileName;
            const legacyOfficialSource = trialSourceFileName === 'plantilla_region8_limpia.xlsx' &&
              ['Mantenimiento_Preventivo_a_Sitios_Celulares_REV2_(1)_1789252951099.xlsx',
                'Mantenimiento_Preventivo_a_Sitios_Celulares.xlsx'].includes(storedSource?.fileName || '');
            const isCustomSource = Boolean(
              storedSource && storedSource.fileName !== trialSourceFileName && !legacyOfficialSource,
            );
            if (!isCustomSource && canonical) {
              next = canonical;
              fileName = trialSourceFileName;
              contentBase64 = trial.source?.contentBase64 || null;
            }
          }
        } catch {
          // The static workbook fallback below still supports a published web server.
        }

        if (!next && storedSource &&
            (!cachedCatalog ||
              cachedCatalog.descriptor.schemaVersion < CURRENT_CATALOG_SCHEMA_VERSION)) {
          try {
            next = await importTemplateLocally({
              fileName: storedSource.fileName,
              contentBase64: storedSource.contentBase64,
              replace: true,
            });
            contentBase64 = storedSource.contentBase64;
            fileName = storedSource.fileName;
          } catch {
            // Keep a current cached catalog if parsing is temporarily unavailable.
          }
        }
        if (!next && cachedCatalog &&
            cachedCatalog.descriptor.schemaVersion >= CURRENT_CATALOG_SCHEMA_VERSION) {
          next = cachedCatalog;
        }
        if (!next) {
          const response = await fetch(
            `${window.location.origin}/template-official.xlsx`,
            { cache: 'no-store' },
          );
          if (response.ok) {
            contentBase64 = bytesToBase64(
              new Uint8Array(await response.arrayBuffer()),
            );
            next = await importTemplateLocally({
              fileName,
              contentBase64,
              replace: true,
            });
          }
        }
        if (next && mounted) {
          const shouldPersist = shouldReplaceCachedCatalog(cachedCatalog, next) ||
            (canonicalFileName !== null && storedSource?.fileName === canonicalFileName);
          if (shouldPersist) await persist(next);
          if (contentBase64) {
            nextSource = { fileName, contentBase64 };
            await AsyncStorage.setItem(LOCAL_SOURCE_KEY, JSON.stringify(nextSource));
          }
          setCatalog(next);
          if (nextSource) {
            setSourceFileName(nextSource.fileName);
            setSourceBase64(nextSource.contentBase64);
          }
        }
      } else if (
        cachedCatalog &&
        cachedCatalog.descriptor.schemaVersion < CURRENT_CATALOG_SCHEMA_VERSION &&
        storedSource
      ) {
        try {
          next = await importTemplateLocally({
            fileName: storedSource.fileName,
            contentBase64: storedSource.contentBase64,
            replace: true,
          });
          if (mounted) {
            await persist(next);
            setCatalog(next);
          }
        } catch {
          // Offline native sessions keep the old draft readable but cannot create
          // a new visit until the canonical schema is available.
        }
      }
      if (!user?.id) {
        if (mounted) {
          setIsLoading(false);
        }
        return;
      }
      const cached = await AsyncStorage.getItem(cacheKey(user.id));
      if (cached && mounted) {
        try {
          const normalized = normalizeTemplateCatalog(JSON.parse(cached));
          if (
            normalized &&
            normalized.descriptor.schemaVersion >= CURRENT_CATALOG_SCHEMA_VERSION
          ) {
            setCatalog(normalized);
          }
        } catch {
          await AsyncStorage.removeItem(cacheKey(user.id));
        }
      }
      if (mounted) await refresh();
    })().catch(() => {
      if (mounted) setIsLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [refresh, user?.id]);

  const uploadLocal = useCallback(
    async (input: TemplateImportInput) => {
      const next = await importTemplateLocally(input);
      await persist(next);
      await AsyncStorage.setItem(
        LOCAL_SOURCE_KEY,
        JSON.stringify({ fileName: input.fileName, contentBase64: input.contentBase64 }),
      );
      setSourceFileName(input.fileName);
      setSourceBase64(input.contentBase64);
      return next;
    },
    [persist],
  );

  const upload = useCallback(
    async (input: TemplateImportInput) => {
      const next = await importTemplate(input);
      await persist(next);
      return next;
    },
    [persist],
  );

  const saveMappings = useCallback(
    async (mappings: TemplateMapping[]) => {
      const next = await saveTemplateMappings(
        mappings,
        catalog ? Number(catalog.descriptor.version) : undefined,
      );
      if (next) await persist(next);
      else await refresh();
    },
    [catalog, persist, refresh],
  );

  return (
    <TemplateContext.Provider
      value={{
        catalog,
        isLoading,
        error,
        sourceBase64,
        sourceFileName,
        refresh,
        uploadLocal,
        upload,
        saveMappings,
      }}
    >
      {children}
    </TemplateContext.Provider>
  );
}

export function useTemplate(): TemplateContextValue {
  const context = useContext(TemplateContext);
  if (!context) throw new Error('useTemplate must be used within TemplateProvider');
  return context;
}
