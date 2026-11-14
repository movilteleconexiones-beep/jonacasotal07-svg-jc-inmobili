/**
 * Fully scoped PostgREST pagination for financial and inventory screens.
 *
 * The default Data API row cap may be 1,000, independently of the frontend
 * .limit() value. Count every page and fail closed on changes/partial results:
 * an incomplete dataset must never authorize contracts, receipts or reports.
 *
 * Callers MUST apply tenant and permission filters, then a stable order
 * (prefer an immutable unique key) before range(from, to).
 */
export interface CountedPage<Row> {
  data: Row[] | null;
  error: { message: string } | null;
  count: number | null;
}
export interface PageOptions<Row> {
  pageSize?: number;
  maxRows?: number;
  key?: (row: Row) => string;
}
const failure = () => new Error(
  'No se pudo comprobar la totalidad de registros de esta inmobiliaria. Actualiza antes de continuar.',
);

export async function readCompletePages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<CountedPage<Row>>,
  { pageSize = 250, maxRows = 30000, key }: PageOptions<Row> = {},
): Promise<Row[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 ||
      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 50000)
    throw failure();
  let expected: number | null = null;
  let offset = 0;
  const output: Row[] = [];
  const seen = key ? new Set<string>() : null;
  do {
    const result = await fetchPage(offset, offset + pageSize - 1);
    if (result.error || !Array.isArray(result.data) ||
      !Number.isSafeInteger(result.count) || result.count === null || result.count < 0)
      throw failure();
    if (expected === null) {
      expected = result.count;
      if (expected > maxRows) throw new Error(
        'Esta consulta supera el límite operativo de registros. Reduce el período o consulta al administrador.',
      );
    }
    if (result.count !== expected ||
        result.data.length !== Math.min(pageSize, expected - offset))
      throw failure();
    if (seen) {
      for (const row of result.data) {
        const identifier = key!(row);
        if (typeof identifier !== 'string' || !identifier || seen.has(identifier))
          throw failure();
        seen.add(identifier);
      }
    }
    output.push(...result.data);
    offset += result.data.length;
  } while (expected !== null && offset < expected);
  return output;
}
