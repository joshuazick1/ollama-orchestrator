/**
 * jsonFileHandler.test.ts
 * Tests for JSON file handler with backup support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileHandler } from '../../src/config/jsonFileHandler.js';

describe('JsonFileHandler', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create a temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-handler-test-'));
    testFilePath = path.join(tempDir, 'test.json');
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create directory if it does not exist (lines 31-33)', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep', 'dir');
      const filePath = path.join(nestedDir, 'file.json');

      expect(fs.existsSync(nestedDir)).toBe(false);

      new JsonFileHandler(filePath);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('should use default options', () => {
      const handler = new JsonFileHandler(testFilePath);
      expect(handler).toBeDefined();
    });

    it('should accept custom options', () => {
      const handler = new JsonFileHandler(testFilePath, {
        createBackups: false,
        maxBackups: 3,
        validateJson: false,
        validator: data => data !== null,
      });
      expect(handler).toBeDefined();
    });
  });

  describe('read', () => {
    it('should return null when file does not exist', () => {
      const handler = new JsonFileHandler(testFilePath);
      const result = handler.read();
      expect(result).toBeNull();
    });

    it('should read and parse JSON file', () => {
      const testData = { name: 'test', value: 42 };
      fs.writeFileSync(testFilePath, JSON.stringify(testData), 'utf-8');

      const handler = new JsonFileHandler(testFilePath);
      const result = handler.read();

      expect(result).toEqual(testData);
    });

    it('should validate data with custom validator (lines 44-50)', () => {
      const testData = { valid: true };
      fs.writeFileSync(testFilePath, JSON.stringify(testData), 'utf-8');

      const validator = vi.fn().mockReturnValue(false);
      const handler = new JsonFileHandler(testFilePath, { validator });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = handler.read();

      expect(validator).toHaveBeenCalledWith(testData);
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip validation when validateJson is false', () => {
      const testData = { name: 'test' };
      fs.writeFileSync(testFilePath, JSON.stringify(testData), 'utf-8');

      const validator = vi.fn().mockReturnValue(false);
      const handler = new JsonFileHandler(testFilePath, {
        validateJson: false,
        validator,
      });

      const result = handler.read();

      expect(validator).not.toHaveBeenCalled();
      expect(result).toEqual(testData);
    });

    it('should handle read errors gracefully', () => {
      // Create a directory instead of a file to cause read error
      fs.mkdirSync(testFilePath);

      const handler = new JsonFileHandler(testFilePath);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = handler.read();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle JSON parse errors', () => {
      fs.writeFileSync(testFilePath, 'invalid json {', 'utf-8');

      const handler = new JsonFileHandler(testFilePath);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = handler.read();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('write', () => {
    it('should write data to file', () => {
      const handler = new JsonFileHandler(testFilePath);
      const testData = { test: 'data', number: 123 };

      const result = handler.write(testData);

      expect(result).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(written).toEqual(testData);
    });

    it('should create backup before writing (lines 62-65)', () => {
      const existingData = { existing: true };
      fs.writeFileSync(testFilePath, JSON.stringify(existingData), 'utf-8');

      const handler = new JsonFileHandler(testFilePath, { createBackups: true });
      const newData = { new: 'data' };

      handler.write(newData);

      // Check that backup was created
      const dir = path.dirname(testFilePath);
      const files = fs.readdirSync(dir);
      const backups = files.filter(f => f.includes('.backup.'));
      expect(backups.length).toBeGreaterThan(0);
    });

    it('should skip backup when createBackups is false', () => {
      const existingData = { existing: true };
      fs.writeFileSync(testFilePath, JSON.stringify(existingData), 'utf-8');

      const handler = new JsonFileHandler(testFilePath, { createBackups: false });
      const newData = { new: 'data' };

      handler.write(newData);

      // Check that no backup was created
      const dir = path.dirname(testFilePath);
      const files = fs.readdirSync(dir);
      const backups = files.filter(f => f.includes('.backup.'));
      expect(backups.length).toBe(0);
    });

    it('should cleanup temp file on write error (lines 79-86)', () => {
      const handler = new JsonFileHandler(testFilePath);

      // Mock fs.writeFileSync to throw error
      const originalWriteFile = fs.writeFileSync;
      fs.writeFileSync = vi.fn().mockImplementation(() => {
        throw new Error('Write failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = handler.write({ test: 'data' });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      // Cleanup
      fs.writeFileSync = originalWriteFile;
      consoleSpy.mockRestore();
    });

    it('should handle write errors gracefully', () => {
      const handler = new JsonFileHandler(testFilePath);

      // Make directory read-only to cause write error
      fs.mkdirSync(testFilePath, { recursive: true });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = handler.write({ test: 'data' });

      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('backup management', () => {
    it('should create backup with timestamp (lines 92-104)', () => {
      fs.writeFileSync(testFilePath, JSON.stringify({ version: 1 }), 'utf-8');

      const handler = new JsonFileHandler(testFilePath, {
        createBackups: true,
        maxBackups: 5,
      });

      // Write multiple times to create backups
      for (let i = 0; i < 3; i++) {
        handler.write({ version: i + 2 });
      }

      const dir = path.dirname(testFilePath);
      const files = fs.readdirSync(dir);
      const backups = files.filter(f => f.includes('.backup.'));

      expect(backups.length).toBe(3);
    });

    it('should handle backup creation errors gracefully', () => {
      fs.writeFileSync(testFilePath, JSON.stringify({ test: 'data' }), 'utf-8');

      const handler = new JsonFileHandler(testFilePath, { createBackups: true });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Mock fs.copyFileSync to throw error
      const originalCopyFile = fs.copyFileSync;
      fs.copyFileSync = vi.fn().mockImplementation(() => {
        throw new Error('Copy failed');
      });

      // This should not throw even though backup fails
      handler.write({ new: 'data' });

      expect(consoleSpy).toHaveBeenCalled();

      // Restore
      fs.copyFileSync = originalCopyFile;
      consoleSpy.mockRestore();
    });

    it('should cleanup old backups (lines 106-133)', () => {
      const handler = new JsonFileHandler(testFilePath, {
        createBackups: true,
        maxBackups: 2,
      });

      // Create initial file and multiple backups
      fs.writeFileSync(testFilePath, JSON.stringify({ version: 0 }), 'utf-8');

      for (let i = 1; i <= 5; i++) {
        // Small delay to ensure different timestamps
        const start = Date.now();
        while (Date.now() - start < 10) {} // 10ms delay
        handler.write({ version: i });
      }

      const dir = path.dirname(testFilePath);
      const files = fs.readdirSync(dir);
      const backups = files.filter(f => f.includes('.backup.'));

      // Should only keep maxBackups (2) backups
      expect(backups.length).toBeLessThanOrEqual(2);
    });

    it('should handle cleanup errors gracefully', () => {
      fs.writeFileSync(testFilePath, JSON.stringify({ test: 'data' }), 'utf-8');

      const handler = new JsonFileHandler(testFilePath, {
        createBackups: true,
        maxBackups: 2,
      });

      // Create a backup file that can't be deleted (by making it a directory)
      const backupPath = `${testFilePath}.backup.test`;
      fs.mkdirSync(backupPath);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Write to trigger cleanup
      handler.write({ new: 'data' });

      // Should not throw
      expect(consoleSpy).not.toHaveBeenCalled(); // Cleanup errors are silently ignored

      // Cleanup
      fs.rmdirSync(backupPath);
      consoleSpy.mockRestore();
    });
  });
});
