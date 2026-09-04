import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "web/architecture-view.html"), "utf8");
const bundle = await build({
  entryPoints: [resolve(root, "web/app.js")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  target: ["es2022"],
});
const html = source.replace("/*__APP_BUNDLE__*/", () => bundle.outputFiles[0].text);
const output = resolve(root, "dist/architecture-view.html");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Built ${output}`);
