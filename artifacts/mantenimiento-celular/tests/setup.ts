import { vi } from 'vitest';

// The tested domain rules inject their own ID generator. Keep the fallback
// Expo-backed generator out of Node test startup so Vitest does not load
// React Native's Flow-only entrypoint.
vi.mock('@/lib/uuid', () => ({
  createUuid: () => 'test-uuid',
}));
