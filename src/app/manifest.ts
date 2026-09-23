import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GeekWX",
    short_name: "GeekWX",
    description: "Observed weather, now and forecast on one timeline.",
    lang: "en",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f1ec",
    theme_color: "#f2f1ec",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Motivet ligger inom den säkra zonen (80 %) och tål rund/squircle-maskning.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
