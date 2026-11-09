import type { ReactNode } from "react";
import { t, type Locale } from "../i18n/index.js";

export type NavItem = { key: string; label: string; href: string };

export type AppShellProps = {
  locale: Locale;
  brand: ReactNode;
  /** Already filtered by entitlement (R4: UI hides unentitled modules; the gateway still enforces). */
  nav: NavItem[];
  activeKey?: string;
  children: ReactNode;
};

export const AppShell = ({ locale, brand, nav, activeKey, children }: AppShellProps) => (
  <div className="clniq-root clniq-shell" lang={locale}>
    <a className="clniq-skip" href="#clniq-main">{t(locale, "shell.skip")}</a>
    <nav className="clniq-shell__nav" aria-label={t(locale, "shell.nav")}>
      <div>{brand}</div>
      <ul className="clniq-nav">
        {nav.map((item) => (
          <li key={item.key}>
            <a href={item.href} aria-current={item.key === activeKey ? "page" : undefined}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
    <main id="clniq-main" className="clniq-shell__main" tabIndex={-1}>{children}</main>
  </div>
);
