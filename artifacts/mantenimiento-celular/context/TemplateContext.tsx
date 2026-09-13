import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth';
import {
  getTemplate,
  importTemplate,
  importTemplateLocally,
  saveTemplateMappings,
  type TemplateImportInput,
  type TemplateMapping,
} from '@/lib/templateApi';
import type { TemplateCatalog } from '@/types';

const cacheKey = (ownerId: string) => `@mantenimiento_template_${ownerId}`;
const LOCAL_CATALOG_KEY = '@mantenimiento_template_local';
const LOCAL_SOURCE_KEY = '@mantenimiento_template_local_source';

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