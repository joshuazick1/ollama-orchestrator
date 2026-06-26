import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { buildBedrockUrl, resolveAwsCredentials, signRequest } from '../utils/aws-sigv4.js';
import { fetchWithTimeout, parseResponse } from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';

const UPSTREAM_REQUEST_TIMEOUT_MS = 60000;

async function invokeBedrock(
  modelId: string,
  body: Record<string, unknown>,
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
  }
): Promise<globalThis.Response> {
  const url = buildBedrockUrl(credentials.region, modelId, 'invoke');
  const payload = JSON.stringify(body);

  const signed = signRequest({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    region: credentials.region,
    service: 'bedrock',
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    payload,
  });

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: signed.headers,
    body: payload,
    timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
  });

  return response;
}

export async function handleBedrockInvoke(req: Request, res: Response): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const bedrockConfig = config.bedrock;

  const modelIdParam = req.params.modelId;
  const modelId = Array.isArray(modelIdParam) ? modelIdParam[0] : modelIdParam;
  if (!modelId) {
    res.status(400).json({ error: { message: 'modelId is required' } });
    return;
  }

  const body = req.body as Record<string, unknown>;

  const credentials = resolveAwsCredentials(
    bedrockConfig.accessKeyId,
    bedrockConfig.secretAccessKey,
    bedrockConfig.sessionToken,
    bedrockConfig.region
  );

  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    res.status(500).json({
      error: {
        message:
          'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables or configure bedrock.accessKeyId and bedrock.secretAccessKey in config.',
      },
    });
    return;
  }

  logger.info('Bedrock invoke request', { modelId, region: credentials.region });

  try {
    const response = await invokeBedrock(modelId, body, credentials);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Bedrock invoke failed', { modelId, status: response.status, error: errorText });
      res.status(response.status).json({ error: { message: errorText } });
      return;
    }

    const result = (await parseResponse<Record<string, unknown>>(response))!;
    res.json(result);
  } catch (error) {
    logger.error('Bedrock invoke error', { error, modelId });
    res
      .status(500)
      .json({ error: { message: error instanceof Error ? error.message : 'Request failed' } });
  }
}

export async function handleBedrockInvokeStream(req: Request, res: Response): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const bedrockConfig = config.bedrock;

  const modelIdParam = req.params.modelId;
  const modelId = Array.isArray(modelIdParam) ? modelIdParam[0] : modelIdParam;
  if (!modelId) {
    res.status(400).json({ error: { message: 'modelId is required' } });
    return;
  }

  const body = req.body as Record<string, unknown>;

  const credentials = resolveAwsCredentials(
    bedrockConfig.accessKeyId,
    bedrockConfig.secretAccessKey,
    bedrockConfig.sessionToken,
    bedrockConfig.region
  );

  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    res.status(500).json({
      error: {
        message:
          'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables or configure bedrock.accessKeyId and bedrock.secretAccessKey in config.',
      },
    });
    return;
  }

  logger.info('Bedrock invoke stream request', { modelId, region: credentials.region });

  try {
    const url = buildBedrockUrl(credentials.region, modelId, 'invokeStream');
    const payload = JSON.stringify(body);

    const signed = signRequest({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      region: credentials.region,
      service: 'bedrock',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.amazon.eventstream',
      },
      payload,
    });

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: signed.headers,
      body: payload,
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Bedrock invoke stream failed', {
        modelId,
        status: response.status,
        error: errorText,
      });
      res.status(response.status).json({ error: { message: errorText } });
      return;
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: { message: 'No response body' } });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) {
            res.write(`${line}\n`);
          }
        }
      }

      if (buffer.trim()) {
        res.write(`${buffer}\n`);
      }

      res.end();
    } catch (error) {
      logger.error('Bedrock stream error', { error, modelId });
      if (!res.headersSent) {
        res.status(500).json({ error: { message: 'Stream failed' } });
      } else {
        res.end();
      }
    }
  } catch (error) {
    logger.error('Bedrock invoke stream error', { error, modelId });
    res
      .status(500)
      .json({ error: { message: error instanceof Error ? error.message : 'Request failed' } });
  }
}
