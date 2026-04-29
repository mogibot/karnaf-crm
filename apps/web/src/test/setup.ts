import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

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
