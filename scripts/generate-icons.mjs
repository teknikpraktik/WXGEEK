// Genererar appikoner från assets/logo.svg. Kör: node scripts/generate-icons.mjs
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(new URL("../assets/logo.svg", import.meta.url));
const out = (p) => new URL(`../${p}`, import.meta.url);

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
  ["src/app/icon.png", 64],
];

for (const [path, size] of targets) {
  await sharp(svg, { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out(path).pathname.replace(/^\/([A-Z]:)/, "$1"));
  console.log("✓", path, size);
}
await writeFile(out("src/app/icon.svg"), svg);
console.log("✓ src/app/icon.svg");
