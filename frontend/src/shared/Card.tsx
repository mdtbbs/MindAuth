import type { ReactNode } from 'react';

type CardPadding = 'sm' | 'md' | 'lg';

interface CardProps {
  children: ReactNode;
  padding?: CardPadding;
  className?: string;
  header?: ReactNode;
  footer?: ReactNode;
}

const PADDING_CLASS: Record<CardPadding, string> = {
  sm: 'card--padding-sm',
  md: 'card--padding-md',
  lg: 'card--padding-lg',
};

export function Card({ children, padding = 'md', className = '', header, footer }: CardProps) {
  return (
    <div className={`card ${PADDING_CLASS[padding]} ${className}`.trim()}>
      {header && <div className="card__header">{header}</div>}
      <div className="card__body">{children}</div>
      {footer && <div className="card__footer">{footer}</div>}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="card__title">{children}</h2>;
}
