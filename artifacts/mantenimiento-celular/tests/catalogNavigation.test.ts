import { describe, expect, it } from 'vitest';
import {
  buildCapturePages,
  catalogQuestions,
  completedQuestionCount,
  currentSectionQuestionIds,
  DEFAULT_PAGE_SIZE,
  filterCaptureQuestions,
  questionnaireSections,
  questionnaireSheets,
  questionObservationId,
  setStatusInResponse,
} from '../utils/catalogNavigation';
import { createDraftVisit } from '../utils/maintenanceRules';
import type { TemplateField } from '../types';

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
    expect(filterCaptureQuestions(questions, 'revisión real 8')).toHaveLength(1);
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
});