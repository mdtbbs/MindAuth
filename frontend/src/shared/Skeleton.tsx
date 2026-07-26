import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single shimmering placeholder block. Size it to match the real content
 * it stands in for so swapping in the loaded UI causes no layout shift (CLS).
 * Shimmer is disabled under prefers-reduced-motion (see components.css).
 */
export function Skeleton({ width = '100%', height = '1rem', radius, className = '', style }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, ...(radius ? { borderRadius: radius } : null), ...style }}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  gap?: string;
}

/** A stack of text-line skeletons; the last line is shortened. */
export function SkeletonText({ lines = 3, gap = 'var(--space-2)' }: SkeletonTextProps) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="0.85rem" width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
}

/**
 * Placeholder grid sized like a table body. Wrap in the same container as the
 * real table so column widths and row heights line up.
 */
export function SkeletonTable({ rows = 5, columns = 4 }: SkeletonTableProps) {
  return (
    <div role="status" aria-live="polite" aria-label="加载中" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 'var(--space-4)' }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} height="1rem" width={c === 0 ? '80%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
