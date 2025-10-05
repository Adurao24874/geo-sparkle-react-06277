import { defineConfig } from "vite";
// @ts-ignore: plugin types may not be available in this environment
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Proxy `/api` requests to the local Node.js backend running on port 3000.
    // This lets the React dev server call `/api/proxy` without CORS issues.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // preserve path, so /api/proxy -> http://localhost:3000/api/proxy
      }
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
