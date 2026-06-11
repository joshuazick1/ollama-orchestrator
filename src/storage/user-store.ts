/**
 * user-store.ts
 * SQLite-backed user store with bcrypt password hashing and access management.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';

import { logger } from '../utils/logger.js';

import { DEFAULT_STORAGE_CONFIG } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
const API_KEY_LENGTH = 32;

// ──────────────────────────────────────────────────────────────────────────────
// Row types
// ──────────────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  is_active: number;
  created_at: number;
  updated_at: number;
  api_key: string | null;
  api_key_created_at: number | null;
}

export interface UserServerAccessRow {
  id: number;
  user_id: string;
  server_id: string;
  granted_at: number;
}

export interface UserModelAccessRow {
  id: number;
  user_id: string;
  server_id: string;
  model: string;
  granted_at: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public types (excludes password_hash)
// ──────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  apiKey?: string | null;
  apiKeyCreatedAt?: number | null;
}

export interface ServerAccess {
  serverId: string;
  grantedAt: number;
}

export interface ModelAccess {
  serverId: string;
  model: string;
  grantedAt: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Schema (aligned with SCHEMA_V4_MIGRATION from src/storage/schema.ts)
// ──────────────────────────────────────────────────────────────────────────────

const USER_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  api_key             TEXT UNIQUE,
  api_key_created_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- User server access allowlist
CREATE TABLE IF NOT EXISTS user_server_access (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id   TEXT NOT NULL,
  granted_at  INTEGER NOT NULL,
  UNIQUE(user_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_user_server_access_user ON user_server_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_server_access_server ON user_server_access(server_id);

-- User model access allowlist (server-specific)
CREATE TABLE IF NOT EXISTS user_model_access (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id   TEXT NOT NULL,
  model       TEXT NOT NULL,
  granted_at  INTEGER NOT NULL,
  UNIQUE(user_id, server_id, model)
);
CREATE INDEX IF NOT EXISTS idx_user_model_access_user ON user_model_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_access_server ON user_model_access(server_id);
`;

// ──────────────────────────────────────────────────────────────────────────────
// UserStore
// ──────────────────────────────────────────────────────────────────────────────

export class UserStore {
  private db: Database.Database;

  // Prepared statements - constructed at construction
  private stmtInsertUser: Database.Statement;
  private stmtGetUserById: Database.Statement;
  private stmtGetUserByUsername: Database.Statement;
  private stmtGetUserByEmail: Database.Statement;
  private stmtGetUserByApiKey: Database.Statement;
  private stmtUpdateUser: Database.Statement;
  private stmtSoftDeleteUser: Database.Statement;
  private stmtListUsers: Database.Statement;
  private stmtListUsersByRole: Database.Statement;
  private stmtSetApiKey: Database.Statement;
  private stmtClearApiKey: Database.Statement;
  private stmtGrantServerAccess: Database.Statement;
  private stmtRevokeServerAccess: Database.Statement;
  private stmtListServerAccess: Database.Statement;
  private stmtHasServerAccess: Database.Statement;
  private stmtGrantModelAccess: Database.Statement;
  private stmtRevokeModelAccess: Database.Statement;
  private stmtListModelAccess: Database.Statement;
  private stmtHasModelAccess: Database.Statement;
  private stmtClearUserAccess: Database.Statement;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DEFAULT_STORAGE_CONFIG.dbPath;

    // Ensure data directory exists
    const dir = path.dirname(path.resolve(resolvedPath));
    if (resolvedPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(USER_SCHEMA);

    const columnMigrations = [
      'ALTER TABLE users ADD COLUMN password_hash TEXT',
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
      'ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
      'ALTER TABLE users ADD COLUMN api_key TEXT',
      'ALTER TABLE users ADD COLUMN api_key_created_at INTEGER',
    ];

    for (const migration of columnMigrations) {
      try {
        this.db.exec(migration);
      } catch (err: unknown) {
        if (!(err instanceof Error && err.message.includes('duplicate column name'))) {
          throw err;
        }
      }
    }

    logger.info(`[UserStore] Opened SQLite database at ${resolvedPath}`);

    // Prepare statements at construction
    this.stmtInsertUser = this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);

    this.stmtGetUserById = this.db.prepare(`
      SELECT id, username, email, password_hash, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE id = ? AND is_active = 1
    `);

    this.stmtGetUserByUsername = this.db.prepare(`
      SELECT id, username, email, password_hash, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE username = ? AND is_active = 1
    `);

    this.stmtGetUserByEmail = this.db.prepare(`
      SELECT id, username, email, password_hash, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE email = ? AND is_active = 1
    `);

    this.stmtGetUserByApiKey = this.db.prepare(`
      SELECT id, username, email, password_hash, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE api_key = ? AND is_active = 1
    `);

    this.stmtUpdateUser = this.db.prepare(`
      UPDATE users SET username = ?, email = ?, role = ?, updated_at = ?
      WHERE id = ? AND is_active = 1
    `);

    this.stmtSoftDeleteUser = this.db.prepare(`
      UPDATE users SET is_active = 0, updated_at = ?
      WHERE id = ? AND is_active = 1
    `);

    this.stmtListUsers = this.db.prepare(`
      SELECT id, username, email, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE is_active = 1
      ORDER BY created_at DESC
    `);

    this.stmtListUsersByRole = this.db.prepare(`
      SELECT id, username, email, role, is_active, created_at, updated_at, api_key, api_key_created_at
      FROM users WHERE is_active = 1 AND role = ?
      ORDER BY created_at DESC
    `);

    this.stmtSetApiKey = this.db.prepare(`
      UPDATE users SET api_key = ?, api_key_created_at = ?, updated_at = ?
      WHERE id = ? AND is_active = 1
    `);

    this.stmtClearApiKey = this.db.prepare(`
      UPDATE users SET api_key = NULL, api_key_created_at = NULL, updated_at = ?
      WHERE id = ? AND is_active = 1
    `);

    this.stmtGrantServerAccess = this.db.prepare(`
      INSERT OR IGNORE INTO user_server_access (user_id, server_id, granted_at)
      VALUES (?, ?, ?)
    `);

    this.stmtRevokeServerAccess = this.db.prepare(`
      DELETE FROM user_server_access WHERE user_id = ? AND server_id = ?
    `);

    this.stmtListServerAccess = this.db.prepare(`
      SELECT server_id, granted_at FROM user_server_access WHERE user_id = ?
    `);

    this.stmtHasServerAccess = this.db.prepare(`
      SELECT 1 FROM user_server_access WHERE user_id = ? AND server_id = ?
    `);

    this.stmtGrantModelAccess = this.db.prepare(`
      INSERT OR IGNORE INTO user_model_access (user_id, server_id, model, granted_at)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtRevokeModelAccess = this.db.prepare(`
      DELETE FROM user_model_access WHERE user_id = ? AND server_id = ? AND model = ?
    `);

    this.stmtListModelAccess = this.db.prepare(`
      SELECT server_id, model, granted_at FROM user_model_access WHERE user_id = ?
    `);

    this.stmtHasModelAccess = this.db.prepare(`
      SELECT 1 FROM user_model_access WHERE user_id = ? AND server_id = ? AND model = ?
    `);

    this.stmtClearUserAccess = this.db.prepare(`
      DELETE FROM user_server_access WHERE user_id = ?
    `);

    // Clear model access is done via direct call since we don't have a prepared statement for it
    // (it's in a transaction with clearUserAccess)
  }

  close(): void {
    this.db.close();
    logger.info('[UserStore] Database closed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper methods
  // ─────────────────────────────────────────────────────────────────────────

  private mapRowToUser(row: UserRow, includeApiKey = false): User {
    const user: User = {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (includeApiKey) {
      user.apiKey = row.api_key;
      user.apiKeyCreatedAt = row.api_key_created_at;
    }
    return user;
  }

  private generateApiKeyString(): string {
    return crypto.randomBytes(API_KEY_LENGTH).toString('hex');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: createUser
  // ─────────────────────────────────────────────────────────────────────────

  async createUser(
    username: string,
    email: string,
    password: string,
    role = 'user'
  ): Promise<User> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    this.stmtInsertUser.run(id, username, email, passwordHash, role, now, now);

    return {
      id,
      username,
      email,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: getUserById
  // ─────────────────────────────────────────────────────────────────────────

  getUserById(id: string): User | undefined {
    const row = this.stmtGetUserById.get(id) as UserRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapRowToUser(row);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: getUserByUsername
  // ─────────────────────────────────────────────────────────────────────────

  getUserByUsername(username: string): User | undefined {
    const row = this.stmtGetUserByUsername.get(username) as UserRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapRowToUser(row);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: getUserByEmail
  // ─────────────────────────────────────────────────────────────────────────

  getUserByEmail(email: string): User | undefined {
    const row = this.stmtGetUserByEmail.get(email) as UserRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapRowToUser(row);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: getUserByApiKey
  // ─────────────────────────────────────────────────────────────────────────

  getUserByApiKey(apiKey: string): User | undefined {
    const row = this.stmtGetUserByApiKey.get(apiKey) as UserRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapRowToUser(row, true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: validatePassword
  // ─────────────────────────────────────────────────────────────────────────

  async validatePassword(username: string, password: string): Promise<User | null> {
    const row = this.stmtGetUserByUsername.get(username) as UserRow | undefined;
    if (!row) {
      return null;
    }

    const isValid = await bcrypt.compare(password, row.password_hash);
    if (!isValid) {
      return null;
    }

    return this.mapRowToUser(row);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: updateUser
  // ─────────────────────────────────────────────────────────────────────────

  updateUser(id: string, updates: { username?: string; email?: string; role?: string }): boolean {
    const existing = this.stmtGetUserById.get(id) as UserRow | undefined;
    if (!existing) {
      return false;
    }

    const username = updates.username ?? existing.username;
    const email = updates.email ?? existing.email;
    const role = updates.role ?? existing.role;
    const now = Date.now();

    this.stmtUpdateUser.run(username, email, role, now, id);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: deleteUser (soft delete)
  // ─────────────────────────────────────────────────────────────────────────

  deleteUser(id: string): boolean {
    const now = Date.now();
    const result = this.stmtSoftDeleteUser.run(now, id);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: listUsers
  // ─────────────────────────────────────────────────────────────────────────

  listUsers(): User[] {
    const rows = this.stmtListUsers.all() as UserRow[];
    return rows.map(row => this.mapRowToUser(row));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: listUsersByRole
  // ─────────────────────────────────────────────────────────────────────────

  listUsersByRole(role: string): User[] {
    const rows = this.stmtListUsersByRole.all(role) as UserRow[];
    return rows.map(row => this.mapRowToUser(row));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: generateApiKey
  // ─────────────────────────────────────────────────────────────────────────

  generateApiKey(userId: string): string | null {
    const existing = this.stmtGetUserById.get(userId) as UserRow | undefined;
    if (!existing) {
      return null;
    }

    const apiKey = this.generateApiKeyString();
    const now = Date.now();

    this.stmtSetApiKey.run(apiKey, now, now, userId);
    return apiKey;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD: revokeApiKey
  // ─────────────────────────────────────────────────────────────────────────

  revokeApiKey(userId: string): boolean {
    const existing = this.stmtGetUserById.get(userId) as UserRow | undefined;
    if (!existing) {
      return false;
    }

    const now = Date.now();
    this.stmtClearApiKey.run(now, userId);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: grantServerAccess
  // ─────────────────────────────────────────────────────────────────────────

  grantServerAccess(userId: string, serverId: string): void {
    const user = this.stmtGetUserById.get(userId) as UserRow | undefined;
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const now = Date.now();
    this.stmtGrantServerAccess.run(userId, serverId, now);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: revokeServerAccess
  // ─────────────────────────────────────────────────────────────────────────

  revokeServerAccess(userId: string, serverId: string): boolean {
    const result = this.stmtRevokeServerAccess.run(userId, serverId);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: listServerAccess
  // ─────────────────────────────────────────────────────────────────────────

  listServerAccess(userId: string): ServerAccess[] {
    const rows = this.stmtListServerAccess.all(userId) as Array<{
      server_id: string;
      granted_at: number;
    }>;
    return rows.map(row => ({
      serverId: row.server_id,
      grantedAt: row.granted_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: grantModelAccess
  // ─────────────────────────────────────────────────────────────────────────

  grantModelAccess(userId: string, serverId: string, model: string): void {
    const user = this.stmtGetUserById.get(userId) as UserRow | undefined;
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const now = Date.now();
    this.stmtGrantModelAccess.run(userId, serverId, model, now);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: revokeModelAccess
  // ─────────────────────────────────────────────────────────────────────────

  revokeModelAccess(userId: string, serverId: string, model: string): boolean {
    const result = this.stmtRevokeModelAccess.run(userId, serverId, model);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: listModelAccess
  // ─────────────────────────────────────────────────────────────────────────

  listModelAccess(userId: string): ModelAccess[] {
    const rows = this.stmtListModelAccess.all(userId) as Array<{
      server_id: string;
      model: string;
      granted_at: number;
    }>;
    return rows.map(row => ({
      serverId: row.server_id,
      model: row.model,
      grantedAt: row.granted_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: hasServerAccess (exact match)
  // ─────────────────────────────────────────────────────────────────────────

  hasServerAccess(userId: string, serverId: string): boolean {
    const row = this.stmtHasServerAccess.get(userId, serverId);
    return row !== undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: hasModelAccess (exact match)
  // ─────────────────────────────────────────────────────────────────────────

  hasModelAccess(userId: string, serverId: string, model: string): boolean {
    const row = this.stmtHasModelAccess.get(userId, serverId, model);
    return row !== undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access management: clearUserAccess
  // ─────────────────────────────────────────────────────────────────────────

  clearUserAccess(userId: string): void {
    const user = this.stmtGetUserById.get(userId) as UserRow | undefined;
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Clear server access
    this.stmtClearUserAccess.run(userId);

    // Clear model access
    this.db.prepare(`DELETE FROM user_model_access WHERE user_id = ?`).run(userId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let _instance: UserStore | undefined;

export function getUserStore(dbPath?: string): UserStore {
  if (!_instance) {
    _instance = new UserStore(dbPath);
  }
  return _instance;
}

export function setUserStore(store: UserStore): void {
  _instance = store;
}

export function resetUserStore(): void {
  if (_instance) {
    try {
      _instance.close();
    } catch {
      // ignore errors during reset
    }
    _instance = undefined;
  }
}
