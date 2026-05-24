// LOW-5: api.ts is now split into domain modules under api/.
// This file exists solely for backward compatibility — all exports are re-exported from the index.
export * from './api/index';
