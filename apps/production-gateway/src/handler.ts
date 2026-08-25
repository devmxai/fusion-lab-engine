import type { IncomingMessage, ServerResponse } from "node:http";
import { routeProductionGateway } from "./gateway.js";

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function requestBody(request: IncomingMessage): Promise<{ body: unknown; rawBody: Uint8Array }> {
  if (request.method === "GET" || request.method === "HEAD") return { body: undefined, rawBody: new Uint8Array() };
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 65_536) throw new Error("request_body_too_large");
    chunks.push(value);
  }
  const rawBody = Buffer.concat(chunks);
  if (!rawBody.length) return { body: {}, rawBody };
  return { body: JSON.parse(rawBody.toString("utf8")) as unknown, rawBody };
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "https://fusionlab.invalid");
  const rewrittenPath = requestUrl.searchParams.get("enginePath");
  const pathname = rewrittenPath
    ? `/${rewrittenPath.replace(/^\/+/, "")}`
    : requestUrl.pathname.replace(/^\/api\/engine/, "") || "/";
  let result;
  try {
    const parsedBody = await requestBody(request);
    result = await routeProductionGateway({
      method: request.method ?? "GET",
      path: pathname,
      authorization: header(request, "authorization"),
      idempotencyKey: header(request, "idempotency-key"),
      assetGrant: header(request, "x-fusion-asset-grant"),
      webhookTimestamp: header(request, "x-webhook-timestamp"),
      webhookSignature: header(request, "x-webhook-signature"),
      body: parsedBody.body,
      rawBody: parsedBody.rawBody,
      query: {
        expiresAt: requestUrl.searchParams.get("expiresAt") ?? undefined,
        signature: requestUrl.searchParams.get("signature") ?? undefined,
      },
    });
  } catch {
    result = { status: 400, body: { error: { code: "INVALID_JSON_BODY", message: "Request body must be valid JSON within the size limit." } } };
  }
  response.statusCode = result.status;
  response.setHeader("content-type", result.contentType ?? "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.end(result.bytes ? Buffer.from(result.bytes) : JSON.stringify(result.body ?? {}));
}
