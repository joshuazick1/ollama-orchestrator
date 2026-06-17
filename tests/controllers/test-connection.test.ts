import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../src/orchestrator/test-store-instance.js');
vi.mock('../../src/orchestrator/test-server-capabilities.js');
vi.mock('../../src/utils/url-safety.js');
vi.mock('../../src/config/config.js');

import { testConnection } from '../../src/controllers/servers-controller.js';
import { getTestStore } from '../../src/orchestrator/test-store-instance.js';
import { testServerCapabilities } from '../../src/orchestrator/test-server-capabilities.js';
import { isBlockedUrl } from '../../src/utils/url-safety.js';
import { getConfigManager } from '../../src/config/config.js';

describe('testConnection controller', () => {
  let mockTestStore: ReturnType<typeof vi.fn>;
  let mockTestServerCapabilities: ReturnType<typeof vi.fn>;
  let mockIsBlockedUrl: ReturnType<typeof vi.fn>;
  let mockGetConfig: ReturnType<typeof vi.fn>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockTestStore = {
      create: vi.fn().mockReturnValue({ testId: 'test-123', status: 'running', progress: 0 }),
      get: vi.fn(),
      update: vi.fn(),
      cleanup: vi.fn(),
      getOrphanTestIds: vi.fn(),
      startPeriodicCleanup: vi.fn(),
      stopPeriodicCleanup: vi.fn(),
    };

    mockTestServerCapabilities = vi.fn();
    mockIsBlockedUrl = vi.fn();
    mockGetConfig = vi.fn().mockReturnValue({
      capabilityProbe: { allowPrivateNetwork: false },
    });

    (getTestStore as any).mockReturnValue(mockTestStore);
    (testServerCapabilities as any).mockImplementation(mockTestServerCapabilities);
    (isBlockedUrl as any).mockImplementation(mockIsBlockedUrl);
    (getConfigManager as any).mockReturnValue({ getConfig: mockGetConfig });

    mockReq = {
      body: {},
      auth: { apiKey: 'test-key', isAdmin: false },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when url is missing', async () => {
    mockReq.body = {};

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'url is required',
    });
  });

  it('should return 400 when url is not a string', async () => {
    mockReq.body = { url: 123 };

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'url is required',
    });
  });

  it('should return 400 when URL is invalid format', async () => {
    mockReq.body = { url: 'not-a-valid-url' };

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'url is required',
    });
  });

  it('should return 400 when URL is blocked (SSRF - localhost)', async () => {
    mockReq.body = { url: 'http://127.0.0.1:11434' };
    mockIsBlockedUrl.mockResolvedValue({ blocked: true, reason: 'loopback' });

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockIsBlockedUrl).toHaveBeenCalledWith('http://127.0.0.1:11434', {
      allowPrivateNetwork: false,
      isAdmin: false,
    });
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'URL blocked: loopback',
    });
  });

  it('should return 400 when URL is blocked (SSRF - private IP)', async () => {
    mockReq.body = { url: 'http://192.168.1.1:11434' };
    mockIsBlockedUrl.mockResolvedValue({ blocked: true, reason: 'private_ip' });

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'URL blocked: private_ip',
    });
  });

  it('should return 200 with testId for valid URL', async () => {
    mockReq.body = { url: 'http://example.com:11434' };
    mockIsBlockedUrl.mockResolvedValue({ blocked: false });

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockTestStore.create).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        testId: expect.any(String),
        status: 'running',
      })
    );
  });

  it('should create test store entry on valid request', async () => {
    mockReq.body = { url: 'http://example.com:11434', apiKey: 'secret', name: 'test-server' };
    mockIsBlockedUrl.mockResolvedValue({ blocked: false });

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockTestStore.create).toHaveBeenCalledWith(expect.any(String));
  });

  it('should check SSRF with allowPrivateNetwork from config', async () => {
    mockReq.body = { url: 'http://10.0.0.1:11434' };
    mockReq.auth = { apiKey: 'admin-key', isAdmin: true };
    mockGetConfig.mockReturnValue({
      capabilityProbe: { allowPrivateNetwork: true },
    });
    mockIsBlockedUrl.mockResolvedValue({ blocked: false });

    await testConnection(mockReq as Request, mockRes as Response);

    expect(mockIsBlockedUrl).toHaveBeenCalledWith('http://10.0.0.1:11434', {
      allowPrivateNetwork: true,
      isAdmin: true,
    });
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
