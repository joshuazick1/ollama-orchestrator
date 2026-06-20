import { PsPollCoordinator } from './ps-poll-coordinator.js';

let instance: PsPollCoordinator | null = null;

export function getPsPollCoordinator(): PsPollCoordinator {
  if (!instance) {
    instance = new PsPollCoordinator();
  }
  return instance;
}

export function resetPsPollCoordinator(): void {
  if (instance) {
    instance.stop();
  }
  instance = null;
}
