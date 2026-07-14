// Copies pdfjs-dist's worker script into public/ so the PDF viewer can be
// self-hosted (no CDN) — required for the air-gapped/offline deployment
// this app targets. Runs on every `yarn install` so it always matches the
// pdfjs-dist version actually installed.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

if (!fs.existsSync(src)) {
  console.error(`copy-pdf-worker: ${src} not found — is pdfjs-dist installed?`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`copy-pdf-worker: copied to ${path.relative(process.cwd(), dest)}`);
