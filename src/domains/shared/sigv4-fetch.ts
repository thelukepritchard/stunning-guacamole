import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-provider-node';

/**
 * Sends an HTTP request signed with AWS SigV4 for `execute-api` service.
 *
 * Uses the Lambda's IAM role credentials (via the default credential chain)
 * to sign requests to IAM-authenticated API Gateway endpoints.
 *
 * @param url - The full URL of the API Gateway endpoint.
 * @param init - Standard RequestInit options (method, headers, body).
 * @returns The fetch Response.
 */
export async function sigv4Fetch(url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  const region = process.env.AWS_REGION ?? 'ap-southeast-2';

  const headers: Record<string, string> = { host: parsed.hostname };
  if (init.headers) {
    const rawHeaders = init.headers as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key.toLowerCase()] = value;
    }
  }

  const request = new HttpRequest({
    method: (init.method ?? 'GET').toUpperCase(),
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    headers,
    body: init.body as string | undefined,
  });

  const signer = new SignatureV4({
    service: 'execute-api',
    region,
    credentials: fromNodeProviderChain(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  const signedUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}${parsed.search}`;

  return fetch(signedUrl, {
    method: signed.method,
    headers: signed.headers as Record<string, string>,
    body: signed.body as string | undefined,
  });
}
