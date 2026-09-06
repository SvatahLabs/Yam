import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { baseCss as css, expand } from "./macros.mjs";

for (const f of readdirSync("artboards").filter((n) => n.endsWith(".html"))) {
  const body = expand(readFileSync(`artboards/${f}`, "utf8"));
  const out = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  <style>\n${css}\n  </style>\n</helmet>\n${body}\n</x-dc>\n</body>\n</html>\n`;
  writeFileSync(f.replace(".html", ".dc.html"), out);
  console.log("wrote", f.replace(".html", ".dc.html"));
}
