const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export function getApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return trimTrailingSlash(explicit);

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) return `https://${trimTrailingSlash(domain)}`;

  return '';
}

export function isRemoteAuthEnabled(): boolean {
  return process.env.EXPO_PUBLIC_AUTH_MODE === 'replit';
}
