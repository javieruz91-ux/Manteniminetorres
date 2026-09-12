import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type {
  TemplateCatalog,
  TemplateDescriptor,
  TemplateField,
  TemplateUnmappedCell,
  TemplateEvidenceSlot,
} from '../types';
export {
  buildTemplateMappingsPatch,
  getTemplateExportBlockReason,
  validateTemplateMappings,
  type MappingValidationError,
  type TemplateMappingDraft,
} from '../utils/templateValidation';
import { buildTemplateMappingsPatch } from '../utils/templateValidation';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface TemplateImportInput {
  fileName: string;
  contentBase64: string;
  replace: boolean;
}

export interface TemplateMapping {
  id?: string;
  /** Immutable unresolved-candidate identity returned by the descriptor. */
  candidateTarget?: string;
  cell?: string;
  range?: string;
  label: string;
  fullText?: string;
  sheet: string;
  section: string;
  subsection?: string;
  type: TemplateField['type'];
  evidenceSlot?: TemplateEvidenceSlot;
  options?: string[];
  required?: boolean;
  applicability?: string;
  target: { cell?: string; range?: string };
  ignore?: boolean;
  ignoreReason?: string;
}

export interface TemplateExportResult {
  base64: string;
  contentBase64?: string;
  mime: string;
  fileName: string;
  verification?: {
    verified?: boolean;
    hash?: string;
    [key: string]: unknown;
  };
}

function baseUrl(): string {
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token =
    Platform.OS === 'web'
      ? localStorage.getItem('auth_session_token')
      : await SecureStore.getItemAsync('auth_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...((init.body && { 'Content-Type': 'application/json' }) || {}),
      ...(await authHeaders()),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body?.message || body?.error || `Solicitud de plantilla fallida (${response.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

function unwrapCatalog(value: any): TemplateCatalog | null {
  if (!value) return null;
  const descriptor = value.descriptor || value.template || value;
  const rawFields =
    value.catalog?.fields ||
    value.catalog ||
    value.fields ||
    descriptor.catalog?.fields ||
    descriptor.catalog ||
    [];
  const fields = Array.isArray(rawFields) ? rawFields : [];
  const rawUnmapped =
    value.audit?.unmappedCells ||
    value.catalog?.unmappedCells ||
    value.catalog?.unmapped ||
    descriptor.unmappedCells ||
    value.unmappedCells ||
    value.unmapped ||
    [];
  const splitTarget = (target: unknown): { sheet?: string; ref?: string } => {
    if (typeof target !== 'string') return {};
    const separator = target.indexOf('!');
    return separator < 0
      ? { ref: target }
      : { sheet: target.slice(0, separator), ref: target.slice(separator + 1) };
  };
  const normalizedFields: TemplateField[] = fields.map((field: any) => {
    const target = splitTarget(field.target);
    const rawSheet = String(field.sheet ?? field.sheetName ?? target.sheet ?? '');
    const ref = target.ref ?? field.cell;
    return {
    id: String(field.id ?? field.fieldId ?? `${field.sheet}:${field.cell ?? field.target?.cell}`),
    label: String(field.label ?? field.name ?? field.fullText ?? ''),
    fullText: field.fullText ?? field.label,
    sheet: rawSheet,
    section: String(field.section ?? field.subsection ?? ''),
    subsection: field.subsection,
    type: (field.type ?? field.responseType ?? 'text') as TemplateField['type'],
    evidenceSlot: (field.evidenceSlot ??
      ((field.type ?? field.responseType) === 'observation' ? 'observation' : 'photo')) as TemplateEvidenceSlot,
    options: Array.isArray(field.options) ? field.options.map(String) : undefined,
    required: Boolean(field.required),
    applicability: field.applicability,
    target: typeof field.target === 'string'
      ? (ref?.includes(':') ? { range: ref } : { cell: ref })
      : field.target || (field.cell ? { cell: field.cell } : undefined),
    editable: field.editable !== false && field.state !== 'ignored',
    isTitle: Boolean(field.isTitle || field.role === 'title'),
    mapped: field.mapped !== false && field.state !== 'ignored',
    };
  });
  const unmappedCells: TemplateUnmappedCell[] = rawUnmapped
    .filter((cell: any) => cell.state !== 'ignored')
    .map((cell: any, i: number) => ({
    id: String(cell.id ?? `${cell.sheet}:${cell.cell ?? i}`),
    sheet: String(cell.sheet ?? cell.sheetName ?? ''),
    cell: String(cell.cell ?? cell.address ?? String(cell.target ?? '').split('!').pop() ?? ''),
      target: String(
        cell.target ??
          `${cell.sheet ?? cell.sheetName ?? ''}!${cell.cell ?? cell.address ?? ''}`,
      ),
    value:
      cell.value == null && cell.reason == null
        ? undefined
        : String(cell.value ?? cell.reason),
    fullText: cell.fullText ?? cell.reason ?? cell.value,
    }));
  const rawDescriptor = descriptor.descriptor || descriptor;
  const result: TemplateDescriptor = {
    id: String(
      rawDescriptor.id ??
        rawDescriptor.templateId ??
        rawDescriptor.sha256 ??
        `version:${rawDescriptor.version ?? ''}`,
    ),
    version: String(rawDescriptor.version ?? ''),
    hash: String(rawDescriptor.hash ?? rawDescriptor.sha256 ?? ''),
    fileName: String(rawDescriptor.fileName ?? rawDescriptor.name ?? ''),
    uploadedAt: String(rawDescriptor.uploadedAt ?? rawDescriptor.createdAt ?? ''),
    ready:
      (rawDescriptor.ready === undefined
        ? unmappedCells.length === 0
        : Boolean(rawDescriptor.ready)) && unmappedCells.length === 0,
    sheets: Number(
      rawDescriptor.sheets ??
        rawDescriptor.totalSheets ??
        new Set(normalizedFields.map(field => field.sheet)).size,
    ),
    sections: Number(
      rawDescriptor.sections ??
        rawDescriptor.totalSections ??
        new Set(normalizedFields.map(field => `${field.sheet}:${field.section}`)).size,
    ),
    fields: Number(rawDescriptor.fields ?? rawDescriptor.totalFields ?? normalizedFields.length),
    unmappedCells,
  };
  return { descriptor: result, fields: normalizedFields };
}

export async function getTemplate(): Promise<TemplateCatalog | null> {
  let value: any;
  try {
    value = await request<any>('/api/templates/current');
  } catch (error) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
  return unwrapCatalog(value);
}

export async function importTemplate(input: TemplateImportInput): Promise<TemplateCatalog> {
  const value = await request<any>('/api/templates/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const catalog = unwrapCatalog(value);
  if (!catalog) throw new Error('El servidor no devolvió el catálogo de la plantilla.');
  return catalog;
}

export async function saveTemplateMappings(
  mappings: TemplateMapping[],
  version?: number,
): Promise<TemplateCatalog | null> {
  const body = buildTemplateMappingsPatch(mappings, version);
  const value = await request<any>('/api/templates/mappings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return unwrapCatalog(value);
}

export async function exportTemplate(
  visitId: string,
  format: 'xlsx' | 'pdf',
): Promise<TemplateExportResult> {
  const result = await request<TemplateExportResult & { contentBase64?: string }>(
    '/api/templates/export',
    {
    method: 'POST',
    body: JSON.stringify({ visitId, format }),
    },
  );
  return {
    ...result,
    base64: result.base64 || result.contentBase64 || '',
  };
}

export { MIME_XLSX };