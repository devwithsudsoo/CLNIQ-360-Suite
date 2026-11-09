// packaging.md Part A step 1: capture clniq.com computed styles + full-page references at 1440/1024/768/390, light and dark.
// Runs in CI (scheduled monthly) from a runner that can reach clniq.com; writes capture/reference/*.png and capture/captured.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const out = resolve(import.meta.dirname, "reference");
mkdirSync(out, { recursive: true });
const WIDTHS = [1440, 1024, 768, 390];
const browser = await chromium.launch();
const captured = { url: "https://clniq.com", at: new Date().toISOString(), schemes: {} };

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const page = await ctx.newPage();
  captured.schemes[scheme] = {};
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("https://clniq.com", { waitUntil: "networkidle" });
    await page.screenshot({ path: join(out, `clniq-${scheme}-${width}.png`), fullPage: true });
    captured.schemes[scheme][width] = await page.evaluate(() => {
      const props = ["color", "backgroundColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "borderRadius", "borderColor", "borderWidth", "boxShadow", "backgroundImage", "paddingTop", "paddingLeft", "gap", "transitionDuration", "transitionTimingFunction"];
      const seen = {};
      for (const el of document.querySelectorAll("body *")) {
        const tag = el.tagName.toLowerCase() + (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "");
        if (seen[tag]) continue;
        const cs = getComputedStyle(el);
        seen[tag] = Object.fromEntries(props.map((p) => [p, cs[p]]));
      }
      const root = getComputedStyle(document.documentElement);
      const vars = {};
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) if (rule.selectorText === ":root") for (const name of rule.style) if (name.startsWith("--")) vars[name] = root.getPropertyValue(name).trim();
        } catch { /* cross-origin sheet */ }
      }
      return { elements: seen, rootVars: vars, themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null };
    });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(resolve(import.meta.dirname), "captured.json"), JSON.stringify(captured, null, 2));
console.log("captured clniq.com references");
