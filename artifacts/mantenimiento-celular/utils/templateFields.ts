import type { TemplateField } from '@/types';

const logicalTextWords =
  /NOMBRE|MARCA|MODELO|SERIE|CANTIDAD|N[ÚU]M|NUMERO|DIRECCI[ÓO]N|REGI[ÓO]N|CENTRAL|WO|ORDEN|RESPONS|T[ÉE]CNIC|UBIC|VALOR|POTENCIA|VOLTAJE|AMPER|TEMP|FECHA|MEDI|OBSERV|COMENT|DESCRIP|ESTADO|ESTATUS|STATUS|OK\s*\/?\s*NOK/i;

const presentationText =
  /^(ALARMAS|REVISI[ÓO]N|HOJA DE|PAR[ÁA]METROS|INDICAR|REVISAR|AQU[IÍ] SE|FOTOGRAF|MANTENIMIENTO|REGISTRO|ESCENARIO|EQUIPO|SITIO|CONTENIDO|P[ÁA]GINA)/i;

export function templateFieldRef(field: Pick<TemplateField, 'target'>): string {
  return field.target?.range || field.target?.cell || '';
}

export function stableTemplateFieldKey(field: Pick<TemplateField, 'sheet' | 'label' | 'fullText' | 'target'>): string {
  const logicalKey = String(field.label || field.fullText || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return `${field.sheet.trim().toUpperCase()}|${templateFieldRef(field).trim().toUpperCase()}|${logicalKey}`;
}

export function isLogicalTemplateField(field: TemplateField): boolean {
  if (field.logical !== undefined) return field.logical;
  if (field.isTitle || field.editable === false) return false;
  if (field.type !== 'text') return true;
  if (field.evidenceSlot === 'photo') return false;
  const text = `${field.label} ${field.fullText || ''}`.trim();
  if (field.applicability === 'validated' || logicalTextWords.test(text)) return true;
  return text.length > 0 && !presentationText.test(text) && text.length <= 32;
}

export function getLogicalEditableFields(fields: TemplateField[]): TemplateField[] {
  return fields.filter(isLogicalTemplateField);
}