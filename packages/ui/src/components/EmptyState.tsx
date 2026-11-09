import type { ReactNode } from "react";

export type EmptyStateProps = { title: string; children?: ReactNode; action?: ReactNode };

export const EmptyState = ({ title, children, action }: EmptyStateProps) => (
  <div className="clniq-empty" role="status">
    <p className="clniq-empty__title">{title}</p>
    {children}
    {action && <div>{action}</div>}
  </div>
);
