import { readdirSync } from "node:fs";
import { launch, startServer, summary } from "./harness.mjs";

const only = process.argv[2];
const server = await startServer();
const browser = await launch();
try {
  const files = readdirSync(new URL("./scenarios", import.meta.url))
    .filter((f) => f.endsWith(".mjs") && (!only || f.includes(only)))
    .sort();
  for (const file of files) {
    console.log(`\n${file}`);
    const mod = await import(`./scenarios/${file}`);
    await mod.default(browser);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(summary() ? 1 : 0);
