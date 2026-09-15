import { describe, expect, it } from 'vitest';
import {
  buildCapturePages,
  catalogQuestions,
  completedQuestionCount,
  currentSectionQuestionIds,
  DEFAULT_PAGE_SIZE,
  filterCaptureQuestions,
  presentationFields,
  questionnaireSections,
  questionnaireSheets,
  questionObservationId,
  setStatusInResponse,
} from '../utils/catalogNavigation';
import { shouldReplaceCachedCatalog } from '../utils/catalogMigration';
import { createDraftVisit } from '../utils/maintenanceRules';
import type { TemplateCatalog, TemplateField } from '../types';

const sheets = [
  '(HW) ALARMAS DE FUERZA',
  'PLANTA HUAWEI',
  'INFRAESTRUCTURA',
  'ELECTROMECANICA',
  'TIERRAS',
  'TRANSMISION',
] as const;

function questionFields(total = 281): TemplateField[] {
  return Array.from({ length: total }, (_, index) => {
    const sheet = sheets[index % sheets.length];
    const section = `${sheet} · sección ${Math.floor(index / 12) + 1}`;
    const id = `${sheet}:question:${index + 1}`;
    return {
      id,
      label: `Revisión real ${index + 1}`,
      sheet,
      section,
      type: 'status',
      role: 'question',
      logical: true,
      target: { cell: `D${index + 1}` },
      options: ['OK', 'NOK', 'SC', 'NA'],
      required: true,
      questionId: id,
      observationTarget: `${sheet}!F${index + 1}`,
    };
  });
}

function canonicalFields(): TemplateField[] {
  const presentation = [
    'mnemónico',
    'mnemónicos del sitio',
    'nombre del sitio',
    'tipo de radiobase',
    'región',
    'central',
    'dirección',
    'fecha',
    'ingeniero',
    'número de tarea',
  ].map((label, index): TemplateField => ({
    id: `PRESENTACION:general:${index + 1}`,
    label,
    sheet: 'PRESENTACION',
    section: 'Datos generales',
    type: index === 7 ? 'date' : 'text',
    role: 'presentation',
    logical: true,
    target: { cell: `C${18 + index}` },
  }));
  const questions = questionFields();
  const additional = Array.from({ length: 50 }, (_, index): TemplateField => ({
    id: `${questions[index % questions.length].id}:additional:X${index + 1}`,
    label: `Dato adicional ${index + 1}`,
    sheet: questions[index % questions.length].sheet,
    section: questions[index % questions.length].section,
    type: 'measurement',
    role: 'additional',
    logical: false,
    questionId: questions[index % questions.length].id,
    target: { cell: `X${index + 1}` },
  }));
  return [...presentation, ...questions, ...additional];
}

describe('navegación del catálogo por preguntas reales', () => {
  it('recorre exactamente las seis hojas técnicas y no incluye salidas', () => {
    const fields = questionFields();
    expect(questionnaireSheets(fields)).toEqual([...sheets]);
    expect(questionnaireSheets([
      ...fields,
      { id: 'photo', label: 'Foto', sheet: 'REPORTE FOTOGRAFICO', section: 'Salida', type: 'text', role: 'additional' },
    ])).toEqual([...sheets]);
  });

  it('mantiene cada pregunta una sola vez y monta como máximo seis por página', () => {
    const fields = questionFields();
    const questions = catalogQuestions(fields);
    const pages = sheets.flatMap(sheet =>
      questionnaireSections(questions, sheet).flatMap(section =>
        buildCapturePages(fields, { sheet, section }),
      ),
    );
    expect(questions).toHaveLength(281);
    expect(new Set(questions.map(question => question.field.id)).size).toBe(281);
    expect(Math.max(...pages.map(page => page.questions.length))).toBeLessThanOrEqual(DEFAULT_PAGE_SIZE);
    expect(pages.every(page => page.questions.length > 0)).toBe(true);
  });

  it('filtra por texto de pregunta, hoja o sección sin cambiar el catálogo', () => {
    const fields = questionFields();
    const questions = catalogQuestions(fields);
    expect(filterCaptureQuestions(questions, 'revisión real 281')).toHaveLength(1);
    expect(filterCaptureQuestions(questions, 'TRANSMISION')).toHaveLength(
      questions.filter(question => question.field.sheet === 'TRANSMISION').length,
    );
    expect(filterCaptureQuestions(questions, 'no existe')).toHaveLength(0);
    expect(catalogQuestions(fields)).toHaveLength(281);
  });

  it('calcula progreso sólo con estados de preguntas reales y conserva observaciones', () => {
    const fields = questionFields();
    const visit = createDraftVisit({
      template: { id: 'template', version: '1', hash: 'hash' },
      templateFields: fields,
    }, { id: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => '2026-01-01T00:00:00.000Z' });
    const first = fields[0].id;
    const second = fields[1].id;
    const responses = setStatusInResponse(
      setStatusInResponse(visit.responses, first, 'OK'),
      second,
      'NOK',
    );
    const withResponses = {
      ...visit,
      responses: {
        ...responses,
        [questionObservationId(first)]: 'Sin novedades',
      },
      sections: visit.sections.map(section => ({
        ...section,
        points: section.points.map(point =>
          point.id === first ? { ...point, status: 'OK' as const } :
            point.id === second ? { ...point, status: 'NOK' as const } : point,
        ),
      })),
    };
    expect(completedQuestionCount(catalogQuestions(fields), withResponses)).toBe(2);
    expect(withResponses.responses[questionObservationId(first)]).toBe('Sin novedades');
    expect(JSON.parse(JSON.stringify(withResponses)).responses[questionObservationId(first)]).toBe('Sin novedades');
  });

  it('devuelve sólo los IDs de la sección actual para marcar restantes como OK', () => {
    const fields = questionFields();
    const firstSheet = sheets[0];
    const firstSection = questionnaireSections(catalogQuestions(fields), firstSheet)[0];
    const ids = currentSectionQuestionIds(fields, firstSheet, firstSection);
    const otherIds = catalogQuestions(fields)
      .filter(question => question.field.sheet !== firstSheet)
      .map(question => question.field.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every(id => !otherIds.includes(id))).toBe(true);
    expect(ids.length).toBeLessThan(281);
  });

  it('reemplaza el catálogo legado duplicado antes de crear una visita nueva', () => {
    const canonical = canonicalFields();
    const legacyFields = [
      ...canonical,
      ...canonical.filter(field => field.label === 'región' || field.label === 'central'),
      ...questionFields(159),
    ];
    const legacyCatalog: TemplateCatalog = {
      descriptor: {
        id: 'legacy',
        version: '1',
        schemaVersion: 1,
        hash: 'legacy-hash',
        fileName: 'legacy.xlsx',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        ready: true,
        sheets: 10,
        sections: 1,
        fields: legacyFields.length,
        unmappedCells: [],
      },
      fields: legacyFields,
    };
    const canonicalCatalog: TemplateCatalog = {
      ...legacyCatalog,
      descriptor: {
        ...legacyCatalog.descriptor,
        id: 'canonical',
        version: '2',
        schemaVersion: 2,
        hash: 'canonical-hash',
        fileName: 'oficial.xlsx',
        fields: canonical.length,
      },
      fields: canonical,
    };

    expect(shouldReplaceCachedCatalog(legacyCatalog, canonicalCatalog)).toBe(true);
    const activeCatalog = canonicalCatalog;
    const visit = createDraftVisit({
      template: {
        id: activeCatalog.descriptor.id,
        version: activeCatalog.descriptor.version,
        hash: activeCatalog.descriptor.hash,
        schemaVersion: activeCatalog.descriptor.schemaVersion,
      },
      templateFields: activeCatalog.fields,
    });

    expect(presentationFields(activeCatalog.fields)).toHaveLength(10);
    expect(catalogQuestions(activeCatalog.fields)).toHaveLength(281);
    expect(activeCatalog.fields.filter(field => field.role === 'additional')).toHaveLength(50);
    expect(presentationFields(activeCatalog.fields).map(field => field.label)).toEqual([
      'mnemónico',
      'mnemónicos del sitio',
      'nombre del sitio',
      'tipo de radiobase',
      'región',
      'central',
      'dirección',
      'fecha',
      'ingeniero',
      'número de tarea',
    ]);
    expect(visit.responses).toHaveProperty('PRESENTACION:general:5');
    expect(Object.keys(visit.responses)).toHaveLength(341);
    expect(presentationFields(activeCatalog.fields).filter(field =>
      ['región', 'central', 'dirección'].includes(field.label),
    )).toHaveLength(3);
  });
});