import { spawn } from "node:child_process";

const children = [];
const start = (args) => {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !process.exitCode) process.exitCode = code;
  });
};

start(["--watch", "server/index.mjs"]);
start(["node_modules/vite/bin/vite.js", ...process.argv.slice(2)]);

const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
