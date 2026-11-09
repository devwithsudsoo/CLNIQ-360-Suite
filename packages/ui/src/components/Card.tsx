import type { HTMLAttributes } from "react";

export const Card = ({ className, ...rest }: HTMLAttributes<HTMLElement>) => (
  <section className={["clniq-card", className].filter(Boolean).join(" ")} {...rest} />
);
