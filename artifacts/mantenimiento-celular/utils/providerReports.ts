import { Finding } from '../types';

const providerSeparator = /[,;\n]+|\s+\/\s+|\s+y\s+/i;

/** Splits, trims, and de-duplicates provider names while preserving their display spelling. */
export function providersForFindings(findings: Pick<Finding, 'responsible'>[]): string[] {
  const providers = new Map<string, string>();
  for (const finding of findings) {
    for (const name of finding.responsible.split(providerSeparator).map(value => value.trim()).filter(Boolean)) {
      const key = name.toLocaleLowerCase('es-MX');
      if (!providers.has(key)) providers.set(key, name);
    }
  }
  return [...providers.values()];
}

/** A multi-provider finding is included in every matching provider's report. */
export function findingsForProvider<T extends Pick<Finding, 'responsible'>>(
  findings: T[],
  provider?: string,
): T[] {
  if (!provider) return findings;
  const selected = provider.trim().toLocaleLowerCase('es-MX');
  if (!selected) return findings;
  return findings.filter(finding =>
    finding.responsible.split(providerSeparator).some(
      name => name.trim().toLocaleLowerCase('es-MX') === selected,
    ),
  );
}
