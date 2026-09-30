import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dataAppDirectory = resolve(appDirectory, "../data-app");
const services = [
  { name: "data", cwd: dataAppDirectory, command: process.execPath, args: ["--watch", "server.mjs"] },
  { name: "app", cwd: appDirectory, command: process.execPath, args: [resolve(appDirectory, "node_modules/next/dist/bin/next"), "dev"] },
];
const children = [];
let shuttingDown = false;

const writeOutput = (name, chunk, stream) => {
  const lines = chunk.toString().split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line || index < lines.length - 1) stream.write(`[${name}] ${line}\n`);
  });
};

const stopChildren = (signal = "SIGTERM") => {
  children.forEach((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      child.kill();
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  });
};

const shutdown = (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildren();
  setTimeout(() => process.exit(exitCode), 250);
};

services.forEach(({ name, cwd, command, args }) => {
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => writeOutput(name, chunk, process.stdout));
  child.stderr.on("data", (chunk) => writeOutput(name, chunk, process.stderr));
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = code ?? (signal ? 1 : 0);
    if (exitCode !== 0) {
      console.error(`[${name}] stopped unexpectedly.`);
      shutdown(exitCode);
    }
  });
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
