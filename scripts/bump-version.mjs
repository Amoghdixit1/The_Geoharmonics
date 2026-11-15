// Cache-busting for static hosting (GitHub Pages caches files for ~10 min).
// Stamps a new version into index.html (CSS, entry script, import map, meta
// tag) and version.json. Run before every push:  npm run bump
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDhhmm

const MODULES = [
  "js/main.js", "js/analysis.js", "js/color.js", "js/geo.js", "js/music.js", "js/composers.js",
  "js/tracks.js", "js/describe.js", "js/audio/engine.js", "js/audio/voices.js",
];

const htmlPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

const importMap = `<script type="importmap" id="versioned-modules">
  { "imports": {
${MODULES.map((m) => `    "./${m}": "./${m}?v=${version}"`).join(",\n")}
  } }
  </script>`;

html = html
  .replace(/<meta name="app-version" content="[^"]*">/, `<meta name="app-version" content="${version}">`)
  .replace(/href="css\/app\.css(\?v=[^"]*)?"/, `href="css/app.css?v=${version}"`)
  .replace(/src="js\/main\.js(\?v=[^"]*)?"/, `src="js/main.js?v=${version}"`)
  .replace(/<script type="importmap" id="versioned-modules">[\s\S]*?<\/script>/, importMap);

if (!html.includes('name="app-version"')) {
  html = html.replace("</head>", `  <meta name="app-version" content="${version}">\n</head>`);
}
if (!html.includes('id="versioned-modules"')) {
  // The import map must come before any module script.
  html = html.replace('<script type="module"', `${importMap}\n  <script type="module"`);
}

fs.writeFileSync(htmlPath, html);
fs.writeFileSync(path.join(ROOT, "version.json"), JSON.stringify({ version }) + "\n");
console.log(`Version stamped: ${version}`);
