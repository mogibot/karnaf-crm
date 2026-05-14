import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Pre-existing: supabase-js validates URL + anon at module import.
// DashboardPage/LeadsPage/QueuePage/LeadDetailPage test files import
// pages whose lib chain transitively touches `supabase`, so without
// VITE_SUPABASE_URL set those files crash at setup. They've been red
// for that reason since before the production-hardening sweep — see the
// audit notes from 2026-05-14. Not in scope to fix here.

// happy-dom doesn't ship browser dialog primitives. Provide writable
// defaults so production code that uses them never throws under test;
// individual specs can stub them via vi.stubGlobal / direct assignment.
if (typeof globalThis.confirm !== 'function') {
  Object.defineProperty(globalThis, 'confirm', {
    value: vi.fn().mockReturnValue(true),
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.alert !== 'function') {
  Object.defineProperty(globalThis, 'alert', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
