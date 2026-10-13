import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
    "/api": {
      target: env.RELAYER_PROXY_TARGET || "http://127.0.0.1:3000",
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
    "/rpc": {
      target: env.RPC_PROXY_TARGET || "http://127.0.0.1:8545",
      rewrite: () => "/",
    },
  };
  return {
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
    build: {
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: { ethereum: ["ethers"], react: ["react", "react-dom"] },
        },
      },
    },
  };
});
