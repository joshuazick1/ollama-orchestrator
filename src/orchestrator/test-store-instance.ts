import { TestStore } from './test-store.js';

let testStore: TestStore | null = null;

export function getTestStore(): TestStore {
  if (!testStore) {
    testStore = new TestStore();
    testStore.startPeriodicCleanup();
  }
  return testStore;
}

export function resetTestStore(): void {
  if (testStore) {
    testStore.stopPeriodicCleanup();
  }
  testStore = null;
}
