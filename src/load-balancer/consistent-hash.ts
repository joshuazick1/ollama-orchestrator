import crypto from 'crypto';

export class ConsistentHashRing<T> {
  private nodes: T[] = [];
  private sortedHashes: string[] = [];
  private hashToNode: Map<string, T> = new Map();
  private readonly virtualNodesPerWeight = 150;

  addNode(id: T, weight: number = 1): void {
    if (this.nodes.some(n => n === id)) {
      return;
    }
    this.nodes.push(id);
    const idStr = String(id);
    const virtualCount = Math.round(weight * this.virtualNodesPerWeight);
    for (let i = 0; i < virtualCount; i++) {
      const hashInput = `${idStr}:${i}`;
      const hash = crypto.createHash('sha256').update(hashInput, 'utf-8').digest('hex');
      this.sortedHashes.push(hash);
      this.hashToNode.set(hash, id);
    }
    this.sortedHashes.sort();
  }

  removeNode(id: T): void {
    const newHashes: string[] = [];
    for (const hash of this.sortedHashes) {
      const nodeId = this.hashToNode.get(hash);
      if (nodeId === id) {
        this.hashToNode.delete(hash);
      } else {
        newHashes.push(hash);
      }
    }
    this.sortedHashes = newHashes;
    this.nodes = this.nodes.filter(n => n !== id);
  }

  getNode(key: string): T | null {
    if (this.sortedHashes.length === 0) {
      return null;
    }
    const keyHash = crypto.createHash('sha256').update(key, 'utf-8').digest('hex');

    let low = 0;
    let high = this.sortedHashes.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedHashes[mid] < keyHash) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const index = low % this.sortedHashes.length;
    return this.hashToNode.get(this.sortedHashes[index]) ?? null;
  }

  size(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.nodes = [];
    this.sortedHashes = [];
    this.hashToNode.clear();
  }
}
