/**
 * Read a response body into memory, giving up once it exceeds `maxBytes`.
 *
 * Content-Length alone can't bound a body: it may be absent (chunked), and for
 * compressed responses it counts encoded bytes while fetch yields decoded ones.
 * So bytes are counted as they arrive and the upstream is cancelled on overflow.
 *
 * Returns null when the body is over the cap.
 */
export async function readCappedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** True when a Content-Length header already declares a body over the cap. */
export function declaresOversizeBody(
  contentLength: string | null,
  maxBytes: number,
): boolean {
  if (contentLength === null) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > maxBytes;
}
