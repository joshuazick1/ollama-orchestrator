import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { atomicWriteFile } from '../../src/utils/atomic-write.js';

describe('atomicWriteFile - crash safety', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-write-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should write file atomically', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await atomicWriteFile(filePath, 'hello world');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('should not leave partial file on write error', async () => {
    const filePath = path.join(tmpDir, 'test.txt');

    const spy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

    await expect(atomicWriteFile(filePath, 'content')).rejects.toThrow();

    spy.mockRestore();

    await expect(fs.access(filePath)).rejects.toThrow();
    const files = await fs.readdir(tmpDir);
    const tempFiles = files.filter(f => f.includes('tmp') || f.includes('temp'));
    expect(tempFiles).toHaveLength(0);
  });

  it('should overwrite existing file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'old content', 'utf-8');
    await atomicWriteFile(filePath, 'new content');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('new content');
  });
});
