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
import type { TemplateCatalog } from '@/types';

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
        if (remote) await persist(remote);
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
      if (localCatalog && mounted) {
        try {
          setCatalog(JSON.parse(localCatalog) as TemplateCatalog);
          if (localSource) {
            const parsed = JSON.parse(localSource) as { fileName: string; contentBase64: string };
            setSourceFileName(parsed.fileName);
            setSourceBase64(parsed.contentBase64);
          }
        } catch {
          await AsyncStorage.removeItem(LOCAL_CATALOG_KEY);
        }
      }
      if (!localCatalog && Platform.OS === 'web') {
        let fileName = 'Mantenimiento_Preventivo_a_Sitios_Celulares.xlsx';
        let contentBase64: string | null = null;
        let next: TemplateCatalog | null = null;
        const apiBase = process.env.EXPO_PUBLIC_DOMAIN
          ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
          : '';
        try {
          const trialResponse = await fetch(`${apiBase}/api/templates/trial-local`, {
            cache: 'no-store',
          });
          if (trialResponse.ok) {
            const trial = await trialResponse.json();
            next = normalizeTemplateCatalog(trial);
            fileName = trial.source?.fileName || fileName;
            contentBase64 = trial.source?.contentBase64 || null;
          }
        } catch {
          // The static workbook fallback below still supports a published web server.
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
        if (next && contentBase64) {
          if (mounted) {
            await persist(next);
            await AsyncStorage.setItem(
              LOCAL_SOURCE_KEY,
              JSON.stringify({
                fileName,
                contentBase64,
              }),
            );
            setSourceFileName(fileName);
            setSourceBase64(contentBase64);
          }
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
          setCatalog(JSON.parse(cached) as TemplateCatalog);
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