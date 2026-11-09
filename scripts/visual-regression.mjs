// Visual regression stub (C0). Packaging milestone 1 replaces this with Playwright comparisons of the app shell,
// typography specimen and key components against packages/design-tokens/capture/reference/* at 1440/1024/768/390.
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const refDir = resolve(import.meta.dirname, "../packages/design-tokens/capture/reference");
const refs = existsSync(refDir) ? readdirSync(refDir).filter((f) => f.endsWith(".png")) : [];
console.log(`visual-regression (stub): ${refs.length} clniq.com reference screenshots present; comparisons arrive with packaging milestone 1`);
