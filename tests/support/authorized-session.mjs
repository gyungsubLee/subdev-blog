import { sessionBinding } from '../../app/server/src/auth.mjs';

// Test-only issuer for routes whose OAuth boundary is covered separately.
export function authorizedSession(config, overrides = {}) {
  return {
    version: 1,
    binding: sessionBinding(config),
    issuedAt: Date.now(),
    user: { id: config.adminUserId, login: 'owner' },
    token: 'token',
    csrfToken: 'csrf',
    expires: Date.now() + 60000,
    ...overrides,
  };
}
