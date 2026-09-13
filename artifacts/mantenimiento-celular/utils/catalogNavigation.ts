import type {
  ChecklistStatus,
  TemplateField,
  Visit,
} from '../types';

export const PRESENTATION_SHEET = 'PRESENTACION';
export const QUESTIONNAIRE_SHEETS = [
  '(HW) ALARMAS DE FUERZA',
  'PLANTA HUAWEI',
  'INFRAESTRUCTURA',
  'ELECTROMECANICA',
  'TIERRAS',
  'TRANSMISION',
] as const;

export const DEFAULT_PAGE_SIZE = 6;

export type CaptureQuestion = {
  field: TemplateField;
  additionalFields: TemplateField[];
};

export type CapturePage = {
  id: string;
  sheet: string;
  section: string;
  pageIndex: number;
  questions: CaptureQuestion[];
};

export function questionObservationId(questionId: string): string {
  return `${questionId}:observation`;
}

function isQuestionField(field: TemplateField): boolean {
  if (field.role === 'question') return true;
  return field.type === 'status' &&
    field.sheet !== PRESENTATION_SHEET &&
    field.role !== 'additional' &&
    field.isTitle !== true &&
    field.editable !== false;
}

export function catalogQuestions(fields: TemplateField[]): CaptureQuestion[] {
  const questionFields = fields.filter(isQuestionField);
  const questionIds = new Set(questionFields.map(field => field.id));
  return questionFields
    .filter((field, index, all) => all.findIndex(candidate => candidate.id === field.id) === index)
    .map(field => ({
      field,
      additionalFields: fields.filter(candidate =>
        candidate.role === 'additional' &&
        candidate.questionId === field.id &&
        !questionIds.has(candidate.id),
      ),
    }));
}

export function presentationFields(fields: TemplateField[]): TemplateField[] {
  return fields
    .filter(field =>
      field.sheet === PRESENTATION_SHEET &&
      field.role !== 'additional' &&
      field.role !== 'question' &&
      field.isTitle !== true &&
      field.editable !== false,
    )
    .filter((field, index, all) => all.findIndex(candidate => candidate.id === field.id) === index);
}

function searchableText(question: CaptureQuestion): string {
  return [
    question.field.label,
    question.field.fullText,
    question.field.sheet,
    question.field.section,
    question.field.subsection,
    ...question.additionalFields.map(field => `${field.label} ${field.fullText ?? ''}`),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function filterCaptureQuestions(
  questions: CaptureQuestion[],
  search: string,
): CaptureQuestion[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return questions;
  return questions.filter(question => searchableText(question).includes(query));
}

export function questionnaireSheets(fields: TemplateField[]): string[] {
  const available = new Set(catalogQuestions(fields).map(question => question.field.sheet));
  return QUESTIONNAIRE_SHEETS.filter(sheet => available.has(sheet));
}

export function questionnaireSections(
  questions: CaptureQuestion[],
  sheet: string,
): string[] {
  const sections = new Set(
    questions
      .filter(question => question.field.sheet === sheet)
      .map(question => question.field.section || sheet),
  );
  return [...sections];
}

export function buildCapturePages(
  fields: TemplateField[],
  options: {
    sheet: string;
    section?: string;
    search?: string;
    pageSize?: number;
  },
): CapturePage[] {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  if (options.sheet === PRESENTATION_SHEET) {
    const general = presentationFields(fields);
    const pages: CapturePage[] = [];
    for (let start = 0; start < general.length; start += pageSize) {
      pages.push({
        id: `${PRESENTATION_SHEET}:general:${start}`,
        sheet: PRESENTATION_SHEET,
        section: 'Datos generales',
        pageIndex: pages.length,
        questions: general.slice(start, start + pageSize).map(field => ({
          field,
          additionalFields: [],
        })),
      });
    }
    return pages;
  }

  const filtered = filterCaptureQuestions(catalogQuestions(fields), options.search ?? '')
    .filter(question => question.field.sheet === options.sheet)
    .filter(question => !options.section || (question.field.section || options.sheet) === options.section);
  const pages: CapturePage[] = [];
  for (let start = 0; start < filtered.length; start += pageSize) {
    pages.push({
      id: `${options.sheet}:${options.section || 'all'}:${start}`,
      sheet: options.sheet,
      section: options.section || options.sheet,
      pageIndex: pages.length,
      questions: filtered.slice(start, start + pageSize),
    });
  }
  return pages;
}

export function sectionQuestions(
  fields: TemplateField[],
  sheet: string,
  section: string,
): CaptureQuestion[] {
  return catalogQuestions(fields).filter(question =>
    question.field.sheet === sheet &&
    (question.field.section || sheet) === section,
  );
}

export function completedQuestionCount(
  questions: CaptureQuestion[],
  visit: Pick<Visit, 'responses' | 'sections'>,
): number {
  const statuses = new Map(
    visit.sections.flatMap(section => section.points.map(point => [point.id, point.status] as const)),
  );
  return questions.filter(question => {
    const status = statuses.get(question.field.id) ?? visit.responses[question.field.id];
    return ['OK', 'NOK', 'SC', 'NA'].includes(String(status));
  }).length;
}

export function responseIsComplete(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function currentSectionQuestionIds(
  fields: TemplateField[],
  sheet: string,
  section: string,
): string[] {
  return sectionQuestions(fields, sheet, section).map(question => question.field.id);
}

export function setStatusInResponse(
  responses: Record<string, unknown>,
  questionId: string,
  status: ChecklistStatus,
): Record<string, unknown> {
  return { ...responses, [questionId]: status };
}