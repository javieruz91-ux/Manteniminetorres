import { describe, expect, it } from 'vitest';
import { findingsForProvider, providersForFindings } from '../utils/providerReports';

const findings = [
  { id: 'shared', responsible: 'Telcel / Telesite' },
  { id: 'single', responsible: 'Telesite' },
  { id: 'other', responsible: 'Proveedor adicional; Telcel' },
];

describe('provider-specific reports', () => {
  it('extracts multiple providers and de-duplicates names regardless of casing', () => {
    expect(providersForFindings([
      { responsible: 'Telcel, Telesite' },
      { responsible: 'TELCEL; Proveedor adicional' },
      { responsible: 'Telesite / Telcel' },
    ])).toEqual(['Telcel', 'Telesite', 'Proveedor adicional']);
  });

  it('includes shared findings in each responsible provider report and excludes unrelated findings', () => {
    expect(findingsForProvider(findings, 'Telcel').map(item => item.id)).toEqual(['shared', 'other']);
    expect(findingsForProvider(findings, 'Telesite').map(item => item.id)).toEqual(['shared', 'single']);
    expect(findingsForProvider(findings, 'Tel').map(item => item.id)).toEqual([]);
    expect(findingsForProvider(findings)).toEqual(findings);
  });
});
