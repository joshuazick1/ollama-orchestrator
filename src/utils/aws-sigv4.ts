/**
 * aws-sigv4.ts
 * AWS SigV4 signing utility for Bedrock requests.
 * Pure TypeScript implementation without @aws-sdk dependencies.
 */

import { createHmac, createHash } from 'crypto';

/**
 * AWS SigV4 signing parameters.
 */
export interface SigV4SigningParams {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  payload?: string;
}

/**
 * Signed request with authorization headers.
 */
export interface SignedRequest {
  headers: Record<string, string>;
}

/**
 * Get AWS signature version.
 */
const ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * Hash a string using SHA-256.
 */
function sha256Hash(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Get a sorted list of header names.
 */
function getSortedHeaderNames(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .map(h => h.toLowerCase())
    .sort();
}

/**
 * Create canonical headers string (lowercase, sorted, no extra whitespace).
 */
function canonicalizeHeaders(headers: Record<string, string>): string {
  const sortedNames = getSortedHeaderNames(headers);
  return sortedNames.map(name => `${name}:${headers[name].trim()}`).join('\n');
}

/**
 * Get signed headers string (lowercase, sorted header names).
 */
function getSignedHeadersString(headers: Record<string, string>): string {
  return getSortedHeaderNames(headers).join(';');
}

/**
 * Create canonical request string.
 */
function createCanonicalRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  payloadHash: string
): string {
  const urlObj = new URL(url);
  const canonicalUri =
    urlObj.pathname === '' ? '/' : encodeURIComponent(urlObj.pathname).replace(/%2F/g, '/');
  const canonicalQueryString = urlObj.search.slice(1);

  return [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalizeHeaders(headers) + '\n',
    getSignedHeadersString(headers),
    payloadHash,
  ].join('\n');
}

/**
 * Create string to sign.
 */
function createStringToSign(
  datetime: string,
  credentialScope: string,
  canonicalRequestHash: string
): string {
  return [ALGORITHM, datetime, credentialScope, canonicalRequestHash].join('\n');
}

/**
 * Derive the signing key from secret access key.
 */
function deriveSigningKey(
  secretAccessKey: string,
  region: string,
  service: string,
  date: string
): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

/**
 * Get datetime in YYYYMMDDTHHMMSSZ format.
 */
function getDateTime(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Get date in YYYYMMDD format.
 */
function getDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Sign an AWS request using SigV4.
 *
 * @param params - Signing parameters including credentials and request details
 * @returns Signed request with authorization headers
 */
export function signRequest(params: SigV4SigningParams): SignedRequest {
  const {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service,
    method,
    url,
    headers,
    payload = '',
  } = params;

  const date = new Date();
  const datetime = getDateTime(date);
  const dateStamp = getDate(date);

  const signedHeaders: Record<string, string> = { ...headers };

  if (!signedHeaders['host']) {
    const urlObj = new URL(url);
    signedHeaders['host'] = urlObj.host;
  }
  if (!signedHeaders['x-amz-date']) {
    signedHeaders['x-amz-date'] = datetime;
  }
  if (sessionToken && !signedHeaders['x-amz-security-token']) {
    signedHeaders['x-amz-security-token'] = sessionToken;
  }

  const payloadHash = sha256Hash(payload);
  const canonicalRequest = createCanonicalRequest(method, url, signedHeaders, payloadHash);
  const canonicalRequestHash = sha256Hash(canonicalRequest);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = createStringToSign(datetime, credentialScope, canonicalRequestHash);
  const signingKey = deriveSigningKey(secretAccessKey, region, service, dateStamp);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const signedHeadersStr = getSignedHeadersString(signedHeaders);
  const authorizationHeader = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return {
    headers: {
      ...signedHeaders,
      Authorization: authorizationHeader,
    },
  };
}

/**
 * Get credentials from environment variables or direct values.
 */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

/**
 * Resolve AWS credentials from various sources.
 * Priority: 1. Direct values, 2. Environment variables.
 *
 * Environment variables:
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - AWS_SESSION_TOKEN (optional)
 * - AWS_DEFAULT_REGION or AWS_REGION
 */
export function resolveAwsCredentials(
  accessKeyId?: string,
  secretAccessKey?: string,
  sessionToken?: string,
  region?: string
): AwsCredentials {
  return {
    accessKeyId: accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
    sessionToken: sessionToken ?? process.env.AWS_SESSION_TOKEN,
    region: region ?? process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  };
}

/**
 * Build Bedrock URL for a given model and endpoint.
 */
export function buildBedrockUrl(
  region: string,
  modelId: string,
  endpoint: 'invoke' | 'invokeStream'
): string {
  const baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;
  const endpointPath =
    endpoint === 'invoke'
      ? `/model/${modelId}/invoke`
      : `/model/${modelId}/invoke-with-response-stream`;
  return `${baseUrl}${endpointPath}`;
}
