import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { JsonFileStore } from '../../src/storage/json-file-store.js';

interface TestItem {
  id: string;
  name: string;
}

class TestStore extends JsonFileStore<TestItem> {
  protected filePath: string;
  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  protected getFilePath(): string {
    return this.filePath;
  }

  protected serialize(items: TestItem[]): string {
    return JSON.stringify(items, null, 2);
  }

  protected deserialize(raw: string): TestItem[] {
    return JSON.parse(raw);
  }
}

describe('JsonFileStore - base class', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-file-store-'));
    filePath = path.join(tmpDir, 'test.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should save items to file', async () => {
    const store = new TestStore(filePath);
    await store.save([{ id: '1', name: 'a' }]);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual([{ id: '1', name: 'a' }]);
  });

  it('should load items from file', async () => {
    await fs.writeFile(filePath, JSON.stringify([{ id: '1', name: 'a' }]), 'utf-8');
    const store = new TestStore(filePath);
    const items = await store.load();
    expect(items).toEqual([{ id: '1', name: 'a' }]);
  });

  it('should return empty array for non-existent file', async () => {
    const store = new TestStore(filePath);
    const items = await store.load();
    expect(items).toEqual([]);
  });

  it('should return empty array on parse error', async () => {
    await fs.writeFile(filePath, '{invalid json', 'utf-8');
    const store = new TestStore(filePath);
    const items = await store.load();
    expect(items).toEqual([]);
  });
});
