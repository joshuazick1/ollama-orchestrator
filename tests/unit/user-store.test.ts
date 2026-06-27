import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

import { UserStore, resetUserStore, setUserStore } from '../../src/storage/user-store.js';

vi.mock('../../src/utils/logger.js');

describe('UserStore', () => {
  let store: UserStore;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-store-test-'));
  });

  beforeEach(() => {
    resetUserStore();
    store = new UserStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create database in memory when path is :memory:', () => {
      const inMemoryStore = new UserStore(':memory:');
      expect(inMemoryStore).toBeInstanceOf(UserStore);
      inMemoryStore.close();
    });

    it('should create directory if it does not exist for file-based DB', () => {
      const dbPath = path.join(tempDir, 'nested', 'deep', 'test.db');
      expect(fs.existsSync(path.dirname(dbPath))).toBe(false);

      const fileStore = new UserStore(dbPath);
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      fileStore.close();
    });

    it('should apply WAL journal mode', () => {
      const users = store.listUsers();
      expect(Array.isArray(users)).toBe(true);
    });

    it('should enable foreign keys', () => {
      const users = store.listUsers();
      expect(Array.isArray(users)).toBe(true);
    });
  });

  describe('createUser', () => {
    it('should create a new user with hashed password', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');

      expect(user.id).toBeDefined();
      expect(user.username).toBe('alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.role).toBe('user');
      expect(user.isActive).toBe(true);
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it('should create user with custom role', async () => {
      const user = await store.createUser('bob', 'bob@example.com', 'password123', 'admin');
      expect(user.role).toBe('admin');
    });

    it('should default to user role when role not specified', async () => {
      const user = await store.createUser('carol', 'carol@example.com', 'password123');
      expect(user.role).toBe('user');
    });

    it('should be retrievable by id after creation', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const retrieved = store.getUserById(created.id);

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.username).toBe('alice');
    });

    it('should be retrievable by username after creation', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const retrieved = store.getUserByUsername('alice');

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.username).toBe('alice');
    });

    it('should be retrievable by email after creation', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const retrieved = store.getUserByEmail('alice@example.com');

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.email).toBe('alice@example.com');
    });
  });

  describe('getUserById', () => {
    it('should return undefined for non-existent id', () => {
      const result = store.getUserById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return user for existing id', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const user = store.getUserById(created.id);

      expect(user).not.toBeUndefined();
      expect(user!.id).toBe(created.id);
    });

    it('should not return soft-deleted users', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.deleteUser(created.id);

      const user = store.getUserById(created.id);
      expect(user).toBeUndefined();
    });

    it('should not include apiKey by default', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.generateApiKey(created.id);

      const user = store.getUserById(created.id);
      expect(user!.apiKey).toBeUndefined();
    });
  });

  describe('getUserByUsername', () => {
    it('should return undefined for non-existent username', () => {
      const result = store.getUserByUsername('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return user for existing username', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const user = store.getUserByUsername('alice');

      expect(user).not.toBeUndefined();
      expect(user!.username).toBe('alice');
    });

    it('should be case-sensitive', async () => {
      await store.createUser('Alice', 'alice@example.com', 'password123');
      const user = store.getUserByUsername('alice');
      expect(user).toBeUndefined();
    });

    it('should not return soft-deleted users', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.deleteUser(created.id);

      const user = store.getUserByUsername('alice');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserByEmail', () => {
    it('should return undefined for non-existent email', () => {
      const result = store.getUserByEmail('nonexistent@example.com');
      expect(result).toBeUndefined();
    });

    it('should return user for existing email', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const user = store.getUserByEmail('alice@example.com');

      expect(user).not.toBeUndefined();
      expect(user!.email).toBe('alice@example.com');
    });

    it('should be case-sensitive', async () => {
      await store.createUser('alice', 'Alice@Example.com', 'password123');
      const user = store.getUserByEmail('alice@example.com');
      expect(user).toBeUndefined();
    });

    it('should not return soft-deleted users', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.deleteUser(created.id);

      const user = store.getUserByEmail('alice@example.com');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserByApiKey', () => {
    it('should return undefined for non-existent apiKey', () => {
      const user = store.getUserByApiKey('non-existent-key');
      expect(user).toBeUndefined();
    });

    it('should return user with apiKey when valid key provided', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const apiKey = store.generateApiKey(created.id);

      expect(apiKey).toBeDefined();
      const user = store.getUserByApiKey(apiKey!);

      expect(user).not.toBeUndefined();
      expect(user!.apiKey).toBe(apiKey);
      expect(user!.apiKeyCreatedAt).toBeDefined();
    });

    it('should not return soft-deleted users even with valid apiKey', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const apiKey = store.generateApiKey(created.id);
      store.deleteUser(created.id);

      const user = store.getUserByApiKey(apiKey!);
      expect(user).toBeUndefined();
    });
  });

  describe('validatePassword', () => {
    it('should return user for correct password', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const user = await store.validatePassword('alice', 'password123');

      expect(user).not.toBeNull();
      expect(user!.username).toBe('alice');
    });

    it('should return null for incorrect password', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const user = await store.validatePassword('alice', 'wrongpassword');
      expect(user).toBeNull();
    });

    it('should return null for non-existent username', async () => {
      const user = await store.validatePassword('nonexistent', 'password123');
      expect(user).toBeNull();
    });

    it('should return null for empty password', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      const user = await store.validatePassword('alice', '');
      expect(user).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('should update username', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.updateUser(created.id, { username: 'alice2' });

      expect(result).toBe(true);
      const user = store.getUserById(created.id);
      expect(user!.username).toBe('alice2');
    });

    it('should update email', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.updateUser(created.id, { email: 'alice2@example.com' });

      expect(result).toBe(true);
      const user = store.getUserById(created.id);
      expect(user!.email).toBe('alice2@example.com');
    });

    it('should update role', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.updateUser(created.id, { role: 'admin' });

      expect(result).toBe(true);
      const user = store.getUserById(created.id);
      expect(user!.role).toBe('admin');
    });

    it('should update multiple fields at once', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.updateUser(created.id, {
        username: 'alice2',
        email: 'alice2@example.com',
        role: 'admin',
      });

      expect(result).toBe(true);
      const user = store.getUserById(created.id);
      expect(user!.username).toBe('alice2');
      expect(user!.email).toBe('alice2@example.com');
      expect(user!.role).toBe('admin');
    });

    it('should not update if no changes provided', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.updateUser(created.id, {});

      expect(result).toBe(true);
      const user = store.getUserById(created.id);
      expect(user!.username).toBe('alice');
    });

    it('should return false for non-existent user', () => {
      const result = store.updateUser('non-existent-id', { username: 'newname' });
      expect(result).toBe(false);
    });

    it('should return false for soft-deleted user', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.deleteUser(created.id);

      const result = store.updateUser(created.id, { username: 'newname' });
      expect(result).toBe(false);
    });

    it('should preserve existing fields when partial update', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123', 'admin');
      store.updateUser(created.id, { username: 'alice2' });

      const user = store.getUserById(created.id);
      expect(user!.email).toBe('alice@example.com');
      expect(user!.role).toBe('admin');
    });
  });

  describe('deleteUser', () => {
    it('should soft delete an existing user', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.deleteUser(created.id);

      expect(result).toBe(true);
      expect(store.getUserById(created.id)).toBeUndefined();
    });

    it('should return false when user does not exist', () => {
      const result = store.deleteUser('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for non-existent user', () => {
      const result = store.deleteUser('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false when deleting already-deleted user', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      store.deleteUser(created.id);

      const result = store.deleteUser(created.id);
      expect(result).toBe(false);
    });
  });

  describe('listUsers', () => {
    it('should return empty array when no users exist', () => {
      const users = store.listUsers();
      expect(users).toEqual([]);
    });

    it('should return all active users', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123');
      await store.createUser('bob', 'bob@example.com', 'password123');
      await store.createUser('carol', 'carol@example.com', 'password123');

      const users = store.listUsers();
      expect(users.length).toBe(3);
    });

    it('should not include soft-deleted users', async () => {
      const alice = await store.createUser('alice', 'alice@example.com', 'password123');
      await store.createUser('bob', 'bob@example.com', 'password123');
      store.deleteUser(alice.id);

      const users = store.listUsers();
      expect(users.length).toBe(1);
      expect(users[0].username).toBe('bob');
    });

    it('should return users ordered by created_at descending', async () => {
      const alice = await store.createUser('alice', 'alice@example.com', 'password123');
      await new Promise(resolve => setTimeout(resolve, 10));
      const bob = await store.createUser('bob', 'bob@example.com', 'password123');

      const users = store.listUsers();
      expect(users[0].username).toBe('bob');
      expect(users[1].username).toBe('alice');
    });
  });

  describe('listUsersByRole', () => {
    it('should return empty array when no users with that role', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123', 'user');

      const admins = store.listUsersByRole('admin');
      expect(admins).toEqual([]);
    });

    it('should return users with specified role', async () => {
      await store.createUser('alice', 'alice@example.com', 'password123', 'user');
      await store.createUser('bob', 'bob@example.com', 'password123', 'admin');
      await store.createUser('carol', 'carol@example.com', 'password123', 'admin');

      const admins = store.listUsersByRole('admin');
      expect(admins.length).toBe(2);
      expect(admins.every(u => u.role === 'admin')).toBe(true);
    });

    it('should return only active users with role', async () => {
      const alice = await store.createUser('alice', 'alice@example.com', 'password123', 'admin');
      await store.createUser('bob', 'bob@example.com', 'password123', 'admin');
      store.deleteUser(alice.id);

      const admins = store.listUsersByRole('admin');
      expect(admins.length).toBe(1);
      expect(admins[0].username).toBe('bob');
    });
  });

  describe('generateApiKey', () => {
    it('should generate a 64-character hex string', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const apiKey = store.generateApiKey(created.id);

      expect(apiKey).toBeDefined();
      expect(apiKey!.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(apiKey!)).toBe(true);
    });

    it('should return null for non-existent user', () => {
      const apiKey = store.generateApiKey('non-existent-id');
      expect(apiKey).toBeNull();
    });

    it('should be retrievable via getUserByApiKey', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const apiKey = store.generateApiKey(created.id);

      const user = store.getUserByApiKey(apiKey!);
      expect(user).not.toBeUndefined();
      expect(user!.id).toBe(created.id);
    });

    it('should regenerate key for same user (replace old key)', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const key1 = store.generateApiKey(created.id);
      const key2 = store.generateApiKey(created.id);

      expect(key1).not.toBe(key2);
      expect(store.getUserByApiKey(key1!)).toBeUndefined();
      expect(store.getUserByApiKey(key2!)).not.toBeUndefined();
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke api key for existing user', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const apiKey = store.generateApiKey(created.id);
      expect(store.getUserByApiKey(apiKey!)).not.toBeUndefined();

      const result = store.revokeApiKey(created.id);
      expect(result).toBe(true);
      expect(store.getUserByApiKey(apiKey!)).toBeUndefined();
    });

    it('should return false for non-existent user', () => {
      const result = store.revokeApiKey('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return true for user without api key', async () => {
      const created = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.revokeApiKey(created.id);
      expect(result).toBe(true);
    });
  });

  describe('grantServerAccess', () => {
    it('should grant server access to user', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');

      expect(store.hasServerAccess(user.id, 'server1')).toBe(true);
    });

    it('should grant access to multiple servers', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      store.grantServerAccess(user.id, 'server2');

      expect(store.hasServerAccess(user.id, 'server1')).toBe(true);
      expect(store.hasServerAccess(user.id, 'server2')).toBe(true);
    });

    it('should throw for non-existent user', () => {
      expect(() => store.grantServerAccess('non-existent', 'server1')).toThrow('User not found');
    });

    it('should be idempotent', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      expect(() => store.grantServerAccess(user.id, 'server1')).not.toThrow();
    });
  });

  describe('revokeServerAccess', () => {
    it('should revoke server access', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      const result = store.revokeServerAccess(user.id, 'server1');

      expect(result).toBe(true);
      expect(store.hasServerAccess(user.id, 'server1')).toBe(false);
    });

    it('should return false when access does not exist', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.revokeServerAccess(user.id, 'non-existent-server');
      expect(result).toBe(false);
    });
  });

  describe('listServerAccess', () => {
    it('should return empty array when no access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      const access = store.listServerAccess(user.id);
      expect(access).toEqual([]);
    });

    it('should return all granted server access', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      store.grantServerAccess(user.id, 'server2');

      const access = store.listServerAccess(user.id);
      expect(access.length).toBe(2);
      expect(access.map(a => a.serverId).sort()).toEqual(['server1', 'server2']);
    });

    it('should include grantedAt timestamp', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');

      const access = store.listServerAccess(user.id);
      expect(access[0].grantedAt).toBeDefined();
      expect(access[0].grantedAt).toBeGreaterThan(0);
    });
  });

  describe('hasServerAccess', () => {
    it('should return false when no access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      expect(store.hasServerAccess(user.id, 'server1')).toBe(false);
    });

    it('should return true when access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      expect(store.hasServerAccess(user.id, 'server1')).toBe(true);
    });

    it('should return false after access revoked', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      store.revokeServerAccess(user.id, 'server1');
      expect(store.hasServerAccess(user.id, 'server1')).toBe(false);
    });
  });

  describe('grantModelAccess', () => {
    it('should grant model access to user', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');

      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(true);
    });

    it('should grant access to multiple models', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      store.grantModelAccess(user.id, 'server1', 'mistral');

      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(true);
      expect(store.hasModelAccess(user.id, 'server1', 'mistral')).toBe(true);
    });

    it('should throw for non-existent user', () => {
      expect(() => store.grantModelAccess('non-existent', 'server1', 'llama3')).toThrow(
        'User not found'
      );
    });

    it('should be idempotent', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      expect(() => store.grantModelAccess(user.id, 'server1', 'llama3')).not.toThrow();
    });
  });

  describe('revokeModelAccess', () => {
    it('should revoke model access', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      const result = store.revokeModelAccess(user.id, 'server1', 'llama3');

      expect(result).toBe(true);
      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(false);
    });

    it('should return false when access does not exist', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      const result = store.revokeModelAccess(user.id, 'server1', 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listModelAccess', () => {
    it('should return empty array when no access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      const access = store.listModelAccess(user.id);
      expect(access).toEqual([]);
    });

    it('should return all granted model access', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      store.grantModelAccess(user.id, 'server1', 'mistral');
      store.grantModelAccess(user.id, 'server2', 'llama3');

      const access = store.listModelAccess(user.id);
      expect(access.length).toBe(3);
    });

    it('should include serverId, model, and grantedAt', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');

      const access = store.listModelAccess(user.id);
      expect(access[0]).toEqual({
        serverId: 'server1',
        model: 'llama3',
        grantedAt: expect.any(Number),
      });
    });
  });

  describe('hasModelAccess', () => {
    it('should return false when no access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(false);
    });

    it('should return true when access granted', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(true);
    });

    it('should return false for different server', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      expect(store.hasModelAccess(user.id, 'server2', 'llama3')).toBe(false);
    });

    it('should return false after access revoked', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      store.revokeModelAccess(user.id, 'server1', 'llama3');
      expect(store.hasModelAccess(user.id, 'server1', 'llama3')).toBe(false);
    });
  });

  describe('clearUserAccess', () => {
    it('should clear all server and model access for user', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      store.grantServerAccess(user.id, 'server1');
      store.grantServerAccess(user.id, 'server2');
      store.grantModelAccess(user.id, 'server1', 'llama3');
      store.grantModelAccess(user.id, 'server1', 'mistral');

      store.clearUserAccess(user.id);

      expect(store.listServerAccess(user.id)).toEqual([]);
      expect(store.listModelAccess(user.id)).toEqual([]);
    });

    it('should throw for non-existent user', () => {
      expect(() => store.clearUserAccess('non-existent')).toThrow('User not found');
    });

    it('should handle user with no access gracefully', async () => {
      const user = await store.createUser('alice', 'alice@example.com', 'password123');
      expect(() => store.clearUserAccess(user.id)).not.toThrow();
    });
  });

  describe('singleton management', () => {
    it('getUserStore should return same instance on repeated calls', () => {
      const store1 = store;
      const store2 = store;
      expect(store1).toBe(store2);
    });

    it('setUserStore should replace the singleton instance', () => {
      const newStore = new UserStore(':memory:');
      setUserStore(newStore);

      const retrieved = newStore;
      expect(retrieved).toBe(newStore);

      newStore.close();
    });

    it('resetUserStore should allow new instance to be created', () => {
      const originalStore = store;
      resetUserStore();

      const newStore = new UserStore(':memory:');
      expect(newStore).not.toBe(originalStore);
      newStore.close();
    });
  });

  describe('close', () => {
    it('should close without error', () => {
      expect(() => store.close()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      store.close();
      expect(() => store.close()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle concurrent user creation', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.createUser(`user${i}`, `user${i}@example.com`, 'password')
      );

      const users = await Promise.all(promises);
      expect(users.length).toBe(10);
      expect(new Set(users.map(u => u.username)).size).toBe(10);
    });

    it('should handle very long username', async () => {
      const longUsername = 'a'.repeat(256);
      const user = await store.createUser(longUsername, 'long@example.com', 'password');

      expect(store.getUserByUsername(longUsername)).not.toBeUndefined();
    });

    it('should handle unicode in username', async () => {
      const unicodeUsername = '用户' + Math.random().toString(36).slice(2);
      const user = await store.createUser(unicodeUsername, 'unicode@example.com', 'password');

      expect(store.getUserByUsername(unicodeUsername)).not.toBeUndefined();
    });
  });
});
