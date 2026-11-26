import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solidPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/crates/**"],
    },
  },
  build: {
    // 兼容 Windows WebView2、macOS WKWebView 与 Linux WebKitGTK
    target: ["es2021", "chrome105", "safari14"],
    cssTarget: ["chrome105", "safari14"],
    minify: "esbuild",
  },
});
