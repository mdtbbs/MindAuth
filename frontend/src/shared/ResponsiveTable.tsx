import type { ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Column<T> {
  /** Column header label */
  header: string;
  /** Key used for `data-label` on mobile card view */
  accessor: string;
  /** Render the cell content */
  render: (row: T) => ReactNode;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
}

/**
 * Table that degrades to a card-stack on mobile (<640px).
 * Each cell gets a `data-label` attribute so the mobile view shows labels
 * without the header row.
 */
export function ResponsiveTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = '暂无数据',
}: ResponsiveTableProps<T>) {
  if (data.length === 0) {
    return (
      <p className="text-center" style={{ padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="rtable-wrap">
      <table className="rtable">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.accessor}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={keyExtractor(row)}>
              {columns.map((col) => (
                <td key={col.accessor} data-label={col.header}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
