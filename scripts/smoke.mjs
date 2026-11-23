import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Unable to allocate a smoke-test port"));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(String(address.port))));
  });
});
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", port],
  { stdio: "inherit" },
);

const stop = () => {
  if (!child.killed) child.kill();
};

try {
  const deadline = Date.now() + 20_000;
  let response;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!response?.ok) {
    throw new Error(`Smoke check failed with status ${response?.status ?? "unreachable"}`);
  }
  const body = await response.text();
  if (!body.includes("Todo")) throw new Error("Smoke check did not find the application title");
  console.log("Smoke check passed");
} finally {
  stop();
}
