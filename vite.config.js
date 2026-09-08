import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/Adris/",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        home: resolve(__dirname, "home.html"),
        chat: resolve(__dirname, "chat.html"),
        sources: resolve(__dirname, "sources.html"),
        studio: resolve(__dirname, "studio.html"),
        transcribe: resolve(__dirname, "transcribe.html")
      }
    }
  }
});
