import type { TemplateCatalog } from '../types';

export function shouldReplaceCachedCatalog(
  cached: TemplateCatalog | null,
  incoming: TemplateCatalog,
): boolean {
  if (!cached) return true;
  return cached.descriptor.schemaVersion !== incoming.descriptor.schemaVersion ||
    cached.descriptor.hash !== incoming.descriptor.hash;
}