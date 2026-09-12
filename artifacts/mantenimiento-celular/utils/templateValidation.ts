import type {
  TemplateDescriptor,
  TemplateField,
  TemplateEvidenceSlot,
  VisitTemplatePin,
} from '../types';

export interface TemplateMappingDraft {
  id?: string;
  candidateTarget?: string;
  label: string;
  fullText?: string;
  sheet: string;
  section: string;
  type: TemplateField['type'];
  options?: string[];
  required?: boolean;
  applicability?: string;
  subsection?: string;
  evidenceSlot?: TemplateEvidenceSlot;
  target: { cell?: string; range?: string };
  ignore?: boolean;
  ignoreReason?: string;
}

export function buildTemplateMappingsPatch(
  mappings: TemplateMappingDraft[],
  version?: number,
): {
  version?: number;
  mappings: Array<{
    candidateTarget: string;
    state: 'mapped' | 'ignored';
    ignoreReason: string | null;
    field?: Record<string, unknown>;
  }>;
} {
  return {
    ...(version === undefined ? {} : { version }),
    mappings: mappings.map(mapping => {
      const ref = mapping.target.cell || mapping.target.range || '';
      const exactTarget = `${mapping.sheet}!${ref}`;
      const candidateTarget =
        mapping.candidateTarget?.includes('!')
          ? mapping.candidateTarget
          : exactTarget;
      return {
        candidateTarget,
        state: mapping.ignore ? 'ignored' : 'mapped',
        ignoreReason: mapping.ignore ? mapping.ignoreReason || null : null,
        field: mapping.ignore
          ? undefined
          : {
              id: mapping.id,
              sheet: mapping.sheet,
              subsection: mapping.subsection || mapping.section,
              key: ref || mapping.label,
              label: mapping.label,
              responseType: mapping.type,
              options: mapping.options || [],
              required: Boolean(mapping.required),
              applicability: mapping.applicability || '',
              evidenceSlot: mapping.evidenceSlot || (mapping.type === 'observation' ? 'observation' : 'photo'),
              target: exactTarget,
              sourceEvidence: mapping.fullText || mapping.label,
              confidence: 1,
              state: 'mapped',
            },
      };
    }),
  };
}

export interface MappingValidationError {
  mappingId?: string;
  message: string;
}

const VALID_TYPES = new Set<TemplateField['type']>([
  'text',
  'number',
  'date',
  'selection',
  'measurement',
  'observation',
  'status',
]);
const A1_TARGET = /^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/i;

export function validateTemplateMappings(
  mappings: TemplateMappingDraft[],
): MappingValidationError[] {
  const errors: MappingValidationError[] = [];
  for (const mapping of mappings) {
    const id = mapping.id;
    if (mapping.ignore) {
      if (!mapping.ignoreReason?.trim()) {
        errors.push({ mappingId: id, message: 'La razón de ignorar es obligatoria.' });
      }
      continue;
    }
    if (!mapping.label.trim() || !mapping.fullText?.trim()) {
      errors.push({ mappingId: id, message: 'La etiqueta y el texto completo son obligatorios.' });
    }
    if (!mapping.sheet.trim() || !mapping.section.trim()) {
      errors.push({ mappingId: id, message: 'La hoja y sección son obligatorias.' });
    }
    if (!mapping.type || !VALID_TYPES.has(mapping.type)) {
      errors.push({ mappingId: id, message: 'El tipo de campo no es válido.' });
    }
    const target = mapping.target.cell?.trim() || mapping.target.range?.trim() || '';
    if (!target) {
      errors.push({ mappingId: id, message: 'La celda o rango exacto es obligatorio.' });
    } else if (!A1_TARGET.test(target)) {
      errors.push({ mappingId: id, message: 'La celda/rango debe usar sintaxis A1 o A1:B2.' });
    }
    if (mapping.type === 'selection' && (!mapping.options || mapping.options.length === 0)) {
      errors.push({ mappingId: id, message: 'Los campos de selección requieren opciones.' });
    }
    if (mapping.type === 'status') {
      const options = new Set(mapping.options || []);
      if (!['OK', 'NOK', 'SC', 'NA'].every(option => options.has(option))) {
        errors.push({ mappingId: id, message: 'Los estados requieren OK, NOK, SC y NA.' });
      }
    }
    if (!['none', 'photo', 'observation'].includes(mapping.evidenceSlot || 'none')) {
      errors.push({ mappingId: id, message: 'El tipo de evidencia debe ser none, photo u observation.' });
    }
  }
  return errors;
}

export function getTemplateExportBlockReason(
  visit: { template?: VisitTemplatePin },
  descriptor?: Pick<TemplateDescriptor, 'ready' | 'unmappedCells'> | null,
): string | null {
  if (!visit.template || !descriptor) return 'Falta cargar la plantilla Excel original';
  if (!descriptor.ready || descriptor.unmappedCells.length > 0) {
    return 'La plantilla tiene celdas editables sin mapear. Resuelve la auditoría antes de exportar.';
  }
  return null;
}