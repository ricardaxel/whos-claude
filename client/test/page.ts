import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Charge le vrai index.html : les écrans retrouvent leurs éléments par id. */
export function loadPage() {
  // (pas de new URL(import.meta.url) : happy-dom remplace URL par la sienne)
  const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, "");
}
