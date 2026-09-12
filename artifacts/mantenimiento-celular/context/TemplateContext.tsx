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
  saveTemplateMappings,
  type TemplateImportInput,
  type TemplateMapping,
} from '@/lib/templateApi';
import type { TemplateCatalog } from '@/types';

const cacheKey = (ownerId: string) => `@mantenimiento_template_${ownerId}`;

interface TemplateContextValue {
  catalog: TemplateCatalog | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upload: (input: TemplateImportInput) => Promise<TemplateCatalog>;
  saveMappings: (mappings: TemplateMapping[]) => Promise<void>;
}

const TemplateContext = createContext<TemplateContextValue | null>(null);

export function TemplateProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(
    async (next: TemplateCatalog | null) => {
      setCatalog(next);
      if (user?.id && next) {
        await AsyncStorage.setItem(cacheKey(user.id), JSON.stringify(next));
      }
    },
    [user?.id],
  );

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setCatalog(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const remote = await getTemplate();
      if (remote) await persist(remote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar la plantilla.');
      // Keep the owner's last known catalog for offline rendering.
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, persist, user?.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      if (!user?.id) {
        if (mounted) {
          setCatalog(null);
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
      value={{ catalog, isLoading, error, refresh, upload, saveMappings }}
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