import type { TemplateCatalog, TemplateField } from '@/types';

const demoFields: TemplateField[] = [
  {
    id: 'demo-site-name',
    label: 'Nombre del sitio',
    fullText: 'Nombre del sitio',
    sheet: 'PRESENTACION',
    section: 'Datos generales',
    type: 'text',
    required: true,
    target: { cell: 'B2' },
    evidenceSlot: 'none',
  },
  {
    id: 'demo-work-order',
    label: 'Orden de trabajo',
    fullText: 'Orden de trabajo',
    sheet: 'PRESENTACION',
    section: 'Datos generales',
    type: 'text',
    required: true,
    target: { cell: 'B3' },
    evidenceSlot: 'none',
  },
  {
    id: 'demo-plant',
    label: 'Planta y energía',
    fullText: 'Planta y energía',
    sheet: 'PLANTA HUAWEI',
    section: 'Checklist',
    type: 'status',
    required: true,
    options: ['OK', 'NOK', 'SC', 'NA'],
    target: { cell: 'D10' },
    evidenceSlot: 'photo',
  },
  {
    id: 'demo-infra',
    label: 'Infraestructura del sitio',
    fullText: 'Infraestructura del sitio',
    sheet: 'INFRAESTRUCTURA',
    section: 'Checklist',
    type: 'status',
    required: true,
    options: ['OK', 'NOK', 'SC', 'NA'],
    target: { cell: 'D10' },
    evidenceSlot: 'photo',
  },
  {
    id: 'demo-temperature',
    label: 'Temperatura medida',
    fullText: 'Temperatura medida',
    sheet: 'ELECTROMECANICA',
    section: 'Mediciones',
    type: 'measurement',
    required: false,
    target: { cell: 'D12' },
    evidenceSlot: 'none',
  },
];

export function createDemoCatalog(): TemplateCatalog {
  return {
    descriptor: {
      id: 'demo-local-template',
      version: 'demo',
      hash: 'demo-local',
      fileName: 'datos_de_ejemplo.xlsx',
      uploadedAt: new Date().toISOString(),
      ready: true,
      sheets: 3,
      sections: 3,
      fields: demoFields.length,
      unmappedCells: [],
    },
    fields: demoFields,
  };
}