import { toCsvRow } from "@/lib/csv";

/** Streams CSV so large exports never sit fully in memory. */
export function csvStreamResponse(filename: string, headers: string[], rows: AsyncIterable<unknown[][]>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("\uFEFF" + toCsvRow(headers)));
        for await (const batch of rows) {
          controller.enqueue(encoder.encode(batch.map(toCsvRow).join("")));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  const safeName = filename.replace(/[^\w.-]+/g, "_");
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function* single<T>(rows: T[]): AsyncIterable<T[]> {
  yield rows;
}
