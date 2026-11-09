// Local/CI Postgres for RLS and run-alone tests without Docker (clinic machines never need Docker either).
// up: initdb into .pgdata and start on PGPORT (default 54329); down: stop. Prints DATABASE_URL.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const data = join(root, ".pgdata");
const port = process.env.PGPORT ?? "54329";
const binDir = process.env.PG_BIN ?? (() => {
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return "";
  const v = readdirSync(base).sort().pop();
  return v ? join(base, v, "bin") : "";
})();
const bin = (n) => (binDir ? join(binDir, n) : n);
const asPg = process.getuid?.() === 0 ? ["runuser", ["-u", "postgres", "--"]] : null;
const run = (cmd, args) => (asPg ? execFileSync(asPg[0], [...asPg[1], cmd, ...args], { stdio: "inherit" }) : execFileSync(cmd, args, { stdio: "inherit" }));

if (process.argv[2] === "up") {
  if (!existsSync(join(data, "PG_VERSION"))) {
    execFileSync("mkdir", ["-p", data]);
    if (asPg) execFileSync("chown", ["postgres:postgres", data]);
    run(bin("initdb"), ["-D", data, "-U", "clniq", "--auth=trust", "-E", "UTF8"]);
  }
  run(bin("pg_ctl"), ["-D", data, "-o", `-p ${port} -k /tmp -c listen_addresses=localhost`, "-l", join(data, "server.log"), "-w", "start"]);
  console.log(`DATABASE_URL=postgres://clniq@localhost:${port}/postgres`);
} else if (process.argv[2] === "down") {
  run(bin("pg_ctl"), ["-D", data, "-w", "stop"]);
} else {
  console.error("usage: dev-postgres.mjs up|down");
  process.exit(2);
}
