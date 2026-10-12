import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Node 26 exposes a global localStorage that is unusable without
// --localstorage-file and shadows jsdom's, so provide an in-memory one.
const memoryStorage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return memoryStorage.size
    },
    key: (index: number) => [...memoryStorage.keys()][index] ?? null,
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, String(value))
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key)
    },
    clear: () => {
      memoryStorage.clear()
    }
  }
})

afterEach(() => {
  cleanup()
  memoryStorage.clear()
})
