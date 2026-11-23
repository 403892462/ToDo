import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { decideNextAction, loadOrchestratorFacts } from "./project-orchestrator.mjs";

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
}

function within(root, path) {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && !value.startsWith(`..${sep}`) && value !== "..";
}

export function projectStateSnapshot(root) {
  const statePath = join(root, ".project", "state.md");
  const content = readFileSync(statePath, "utf8");
  const scalar = (name) => content.match(new RegExp(`^${name}:\\s*(?:"([^"]*)"|([^\\r\\n]+))$`, "m"))?.slice(1).find((item) => item !== undefined)?.trim() ?? null;
  return {
    digest: createHash("sha256").update(content).digest("hex"),
    currentStage: scalar("current_stage"),
    activeRun: scalar("active_run") === "null" ? null : scalar("active_run"),
    activeWorkItem: scalar("active_work_item") === "null" ? null : scalar("active_work_item"),
  };
}

export function createFileActionLog(root, cycleId) {
  if (!/^CYCLE-v\d+\.\d+$/.test(cycleId)) throw new Error("周期编号格式无效。");
  const directory = join(root, ".project", "cycles", cycleId, "actions");
  const pathFor = (key) => join(directory, `${key}.json`);
  return {
    async get(key) {
      const path = pathFor(key);
      if (!existsSync(path)) return null;
      const record = JSON.parse(readFileSync(path, "utf8"));
      return record.events.at(-1) ?? null;
    },
    async append(event) {
      const path = pathFor(event.key);
      const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { schemaVersion: 1, key: event.key, events: [] };
      record.events.push(event);
      atomicJson(path, record);
    },
  };
}

export function createFileOrchestratorLock(root) {
  const path = join(root, ".project", "orchestrator.lock.json");
  return {
    async exists() { return existsSync(path); },
    async acquire(value) {
      mkdirSync(dirname(path), { recursive: true });
      const descriptor = openSync(path, "wx");
      try { writeFileSync(descriptor, `${JSON.stringify({ ...value, heartbeatAt: value.startedAt }, null, 2)}\n`, "utf8"); } finally { closeSync(descriptor); }
    },
    async release(key) {
      if (!existsSync(path)) return;
      const current = JSON.parse(readFileSync(path, "utf8"));
      if (current.key !== key) throw new Error("编排锁不属于当前动作，禁止释放。");
      unlinkSync(path);
    },
  };
}

function spawnCommand(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

export function createRuntimePorts(root, cycleId) {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const commands = {
    "project-control-advance": async (_params, options) => spawnCommand("pwsh.exe", ["-NoProfile", "-File", join(root, "scripts", "project-control.ps1"), "-Action", "advance"], { cwd: root, ...options }),
    "work-item-control": async ({ workItem, runId }, options) => spawnCommand("pwsh.exe", ["-NoProfile", "-File", join(root, "scripts", "work-item-control.ps1"), "-Action", "start", "-WorkItem", workItem, "-RunId", runId], { cwd: root, ...options }),
    "project-verify": async (_params, options) => {
      const result = await spawnCommand(process.execPath, [npmCli, "run", "verify"], { cwd: root, ...options });
      return { ...result, state: { verification: result.exitCode === 0 ? "PASS" : "FAIL" } };
    },
    "acceptance-audit": async ({ auditId }, options) => {
      if (!/^AUDIT-\d{8}-\d{6}$/.test(auditId)) throw new Error("审计编号格式无效。");
      const manifest = join(root, "acceptance", `${auditId}.json`);
      const report = join(root, ".project", "audits", `${auditId}.md`);
      if (!within(root, manifest) || !within(root, report)) throw new Error("审计路径越界。");
      const result = await spawnCommand(process.execPath, [join(root, "scripts", "acceptance-audit.mjs"), "audit", manifest, report], { cwd: root, ...options });
      return { ...result, state: { acceptanceAudit: result.exitCode === 0 ? "PASS" : "FAIL" } };
    },
  };
  return {
    logs: createFileActionLog(root, cycleId),
    lock: createFileOrchestratorLock(root),
    readState: async () => projectStateSnapshot(root),
    contractCheck: async () => {
      const result = await spawnCommand(process.execPath, [npmCli, "run", "contract:check"], { cwd: root });
      if (result.exitCode !== 0) throw Object.assign(new Error(`项目契约检查失败：${(result.stderr || result.stdout).trim().slice(0, 500)}`), { code: "CONTRACT_CHECK_FAILED" });
      const protocol = await spawnCommand("pwsh.exe", ["-NoProfile", "-File", join(root, "scripts", "project-control.ps1"), "-Action", "check"], { cwd: root });
      if (protocol.exitCode !== 0) throw Object.assign(new Error(`项目协议检查失败：${(protocol.stderr || protocol.stdout).trim().slice(0, 500)}`), { code: "PROTOCOL_CHECK_FAILED" });
    },
    invoke: async (command, params, options) => {
      if (!Object.hasOwn(commands, command)) throw new Error(`运行时命令不在白名单：${command}`);
      return commands[command](params, options);
    },
    nextAction: async () => decideNextAction(loadOrchestratorFacts(root)),
    now: () => new Date().toISOString(),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer),
  };
}
