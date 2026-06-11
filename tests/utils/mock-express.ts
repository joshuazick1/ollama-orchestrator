/**
 * Shared mock Express Request/Response helpers for route tests.
 *
 * @module tests/utils/mock-express
 */

import { vi } from 'vitest';

/**
 * Creates a mock Express Request object for route testing.
 *
 * @param overrides - Object to override default values (body, params, query, headers, etc.)
 * @returns Express request-shaped object
 *
 * @example
 * const req = createMockReq({ body: { userId: '123' }, params: { id: 'a' } });
 * req.body.userId // '123'
 */
export function createMockReq(overrides: any = {}): any {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    cookies: {},
    protocol: 'http',
    path: '/',
    method: 'GET',
    ip: '127.0.0.1',
    currentUser: undefined,
    get: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock Express Response object for route testing.
 * All methods are chainable (return `this`) for fluent builder usage.
 * Captures the last `json()` call body in `_json` for test assertions.
 *
 * @returns Express response-shaped object with chainable status/json/send/setHeader/end
 *
 * @example
 * const res = createMockRes();
 * res.status(201).json({ id: '123' });
 * res.statusCode // 201
 * res._json      // { id: '123' }
 */
export function createMockRes(): any {
  return {
    statusCode: undefined as number | undefined,
    _json: undefined as any,
    _body: undefined as any,
    headers: {} as Record<string, string>,
    status: vi.fn(function (this: any, code: number): any {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: any): any {
      this._json = body;
      return this;
    }),
    send: vi.fn(function (this: any, body: any): any {
      this._body = body;
      return this;
    }),
    setHeader: vi.fn(function (this: any, name: string, value: string): any {
      this.headers[name] = value;
      return this;
    }),
    end: vi.fn(function (this: any): any {
      return this;
    }),
  };
}
