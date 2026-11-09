import { createRoot, type Root } from "react-dom/client";
import { Card, EmptyState, type Locale } from "@clniq/ui";

export type MountProps = { locale: Locale; apiBase: string; token: () => Promise<string> };

/** Lazy micro-frontend: mounted by the web shell or embedded by a partner with the same tenant scope (R9). */
export const __PASCAL__Home = (_props: MountProps) => (
  <Card aria-labelledby="__KEY__-title">
    <h1 id="__KEY__-title">__NAME__</h1>
    <EmptyState title="Nothing here yet" />
  </Card>
);

export const mount = (el: HTMLElement, props: MountProps): Root => {
  const root = createRoot(el);
  root.render(<__PASCAL__Home {...props} />);
  return root;
};
