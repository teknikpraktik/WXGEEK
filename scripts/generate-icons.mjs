// Genererar appikoner från assets/icon-source.webp. Kör: npm run icons
//
// Källbilden är en rundad ruta med vit marginal. Hemskärmsikoner ska vara
// utfallande kvadrater (iOS/Android rundar själva), så vi beskär innanför
// rutans kant tills hörnen ligger helt i bakgrunden.
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

// Rutans gränser i källbilden (uppmätta) och inset som klarar hörnradien.
const BOX = { left: 68, top: 71, right: 1186, bottom: 1185 };
const INSET = 76;
const size = BOX.right - BOX.left - 2 * INSET;
const crop = { left: BOX.left + INSET, top: BOX.top + INSET, width: size, height: size };

// WXGEEK: vitt "WX"-monogram under horisontlinjen (hela namnet är oläsligt i ikonstorlek).
const mono = Buffer.from(
  `<svg width="${size}" height="${size}"><text x="${size / 2}" y="${size * 0.955}" text-anchor="middle" ` +
    `font-family="Segoe UI, Arial, Helvetica, sans-serif" font-weight="800" font-size="${size * 0.2}" ` +
    `letter-spacing="${size * 0.012}" fill="#ffffff">WX</text></svg>`,
);
const square = await sharp(path("assets/icon-source.webp")).extract(crop).composite([{ input: mono }]).png().toBuffer();

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
  ["src/app/icon.png", 64],
];
for (const [p, px] of targets) {
  await sharp(square).resize(px, px, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(path(p));
  console.log("✓", p, px);
}

// Maskable (Android): motivet måste ligga inom den säkra zonen (mittersta 80 %).
// Bakgrund = kraftigt suddad version av ikonen, motivet nedskalat ovanpå med mjuk kant.
const M = 512;
const inner = Math.round(M * 0.8);
const bg = await sharp(square).resize(M, M).blur(48).modulate({ saturation: 1.05 }).png().toBuffer();
const feather = Buffer.from(
  `<svg width="${inner}" height="${inner}"><defs><filter id="f"><feGaussianBlur stdDeviation="${inner * 0.04}"/></filter></defs>` +
    `<rect x="${inner * 0.06}" y="${inner * 0.06}" width="${inner * 0.88}" height="${inner * 0.88}" rx="${inner * 0.12}" fill="#fff" filter="url(#f)"/></svg>`,
);
const fg = await sharp(square).resize(inner, inner).composite([{ input: feather, blend: "dest-in" }]).png().toBuffer();
await sharp(bg)
  .composite([{ input: fg, left: (M - inner) / 2, top: (M - inner) / 2 }])
  .png({ compressionLevel: 9 })
  .toFile(path("public/icon-maskable-512.png"));
console.log("✓ public/icon-maskable-512.png", M);
