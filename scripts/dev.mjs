import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const apiPort = process.env.API_PORT || "3001";
const env = { ...process.env, API_PORT: apiPort, NODE_ENV: "development", LOCAL_DATA_DIR: path.join(root, ".local-data"), MIGRATIONS_DIR: path.join(root, "drizzle") };
const build = spawn(process.execPath, ["artifacts/api-server/build.mjs"], { env, stdio: "inherit" });
build.on("exit", code => {
  if (code) return process.exit(code);
  const children = [
    spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { env: { ...env, PORT: apiPort }, stdio: "inherit" }),
    spawn(process.execPath, ["artifacts/yallastay/node_modules/vite/bin/vite.js", "--config", "artifacts/yallastay/vite.config.ts"], { env, stdio: "inherit" })
  ];
  const stop = () => children.forEach(child => child.kill());
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  children.forEach(child => child.on("exit", code => { stop(); process.exit(code || 0); }));
});
