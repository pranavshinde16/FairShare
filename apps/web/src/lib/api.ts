import { createApiClient } from '@fairshare/api-client';

// Same origin in every environment: Vite proxies /api in dev, the API serves the app in prod.
export const api = createApiClient({ baseUrl: '' });
