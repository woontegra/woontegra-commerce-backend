import { parse }     from 'csv-parse';
import { stringify }  from 'csv-stringify';
import { Readable }   from 'stream';

// ─── Parse CSV buffer → rows ──────────────────────────────────────────────────

export async function parseCsv<T = Record<string, string>>(
  buffer: Buffer,
  options?: { columns?: boolean | string[] },
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = [];
    const parser = parse(buffer, {
      columns:           options?.columns ?? true,  // first row = header
      skip_empty_lines:  true,
      trim:              true,
      bom:               true,  // strip UTF-8 BOM (Excel exports)
      relaxColumnCount:  true,
    });

    parser.on('readable', () => {
      let record: T;
      while ((record = parser.read()) !== null) rows.push(record);
    });
    parser.on('error', reject);
    parser.on('end',   () => resolve(rows));
  });
}

// ─── Rows → CSV string ────────────────────────────────────────────────────────

export async function toCsvString(
  rows:    Record<string, unknown>[],
  columns: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    stringify(rows, {
      header:  true,
      columns: columns.map(c => ({ key: c, header: c })),
      cast:    {
        date:    v => v.toISOString(),
        boolean: v => (v ? 'true' : 'false'),
      },
    }, (err, output) => {
      if (err) return reject(err);
      resolve('\uFEFF' + output);   // prepend UTF-8 BOM for Excel
    });
  });
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export interface RowError {
  row:     number;
  field:   string;
  message: string;
  value?:  string;
}

export function requireField(
  row:     Record<string, string>,
  field:   string,
  rowIdx:  number,
  errors:  RowError[],
): boolean {
  if (!row[field]?.trim()) {
    errors.push({ row: rowIdx, field, message: `"${field}" zorunludur`, value: row[field] });
    return false;
  }
  return true;
}

export function parseDecimal(
  raw:    string,
  field:  string,
  rowIdx: number,
  errors: RowError[],
): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n) || n < 0) {
    errors.push({ row: rowIdx, field, message: `"${field}" geçerli bir sayı olmalı`, value: raw });
    return null;
  }
  return n;
}

export function parseInt2(
  raw:    string,
  field:  string,
  rowIdx: number,
  errors: RowError[],
): number | null {
  if (!raw?.trim()) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n)) {
    errors.push({ row: rowIdx, field, message: `"${field}" tam sayı olmalı`, value: raw });
    return null;
  }
  return n;
}

// ─── Column definitions (canonical header names) ─────────────────────────────

export const PRODUCT_COLUMNS = [
  'name', 'slug', 'description', 'price', 'basePrice',
  'sku', 'isActive', 'categoryName', 'unitType',
  'minQuantity', 'maxQuantity', 'images',
];

export const CUSTOMER_COLUMNS = [
  'email', 'firstName', 'lastName',
  'phone', 'address', 'city', 'country', 'zipCode',
];

export const ORDER_EXPORT_COLUMNS = [
  'orderNumber', 'status', 'totalAmount', 'shippingPrice',
  'discountAmount', 'customerEmail', 'customerName',
  'itemCount', 'notes', 'createdAt',
];
