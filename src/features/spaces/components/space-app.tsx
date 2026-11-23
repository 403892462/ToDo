"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiTaskRepository, type TaskDataRepository } from "@/features/tasks/api-repository";
import { TaskApp } from "@/features/tasks/components/task-app";

import {
  createSpace as requestCreateSpace,
  getCurrentSpace,
  recoverSpace as requestRecoverSpace,
  type SpaceCredential,
} from "../space-client";

type SpaceStatus = "checking" | "onboarding" | "authorized";

export function SpaceApp({
  checkSpace = getCurrentSpace,
  createSpace = requestCreateSpace,
  recoverSpace = requestRecoverSpace,
  taskRepository,
}: {
  checkSpace?: () => Promise<{ spaceId: string } | null>;
  createSpace?: () => Promise<SpaceCredential>;
  recoverSpace?: (accessCode: string) => Promise<{ spaceId: string }>;
  taskRepository?: TaskDataRepository;
}) {
  const [status, setStatus] = useState<SpaceStatus>("checking");
  const [credential, setCredential] = useState<SpaceCredential | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repository = useMemo(() => taskRepository ?? new ApiTaskRepository(), [taskRepository]);

  useEffect(() => {
    let active = true;
    checkSpace()
      .then((space) => active && setStatus(space ? "authorized" : "onboarding"))
      .catch(() => {
        if (active) {
          setStatus("onboarding");
          setError("个人空间读取失败，请检查网络后重试");
        }
      });
    return () => {
      active = false;
    };
  }, [checkSpace]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      setCredential(await createSpace());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "个人空间创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessCode.trim()) {
      setError("请输入访问码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recoverSpace(accessCode.trim());
      setStatus("authorized");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法恢复个人空间");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") {
    return <p className="py-12 text-center text-sm text-slate-500">正在确认个人空间…</p>;
  }

  if (status === "authorized") {
    return <TaskApp repository={repository} />;
  }

  if (credential) {
    return (
      <section className="space-y-5 rounded-3xl border border-amber-200 bg-white p-6 shadow-sm" aria-label="保存个人空间凭证">
        <div>
          <p className="text-sm font-medium text-amber-700">仅本次展示</p>
          <h1 className="mt-1 text-2xl font-semibold">请保存个人空间访问码</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">换手机时需要使用访问码恢复任务。关闭本页后系统不会再次显示完整访问码。</p>
        </div>
        <dl className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
          <div><dt className="text-slate-500">空间 ID</dt><dd className="mt-1 break-all font-mono">{credential.spaceId}</dd></div>
          <div><dt className="text-slate-500">访问码</dt><dd className="mt-1 break-all font-mono text-base font-semibold">{credential.accessCode}</dd></div>
        </dl>
        <Button className="w-full" onClick={() => setStatus("authorized")}>我已保存，进入任务首页</Button>
      </section>
    );
  }

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="个人空间入口">
      <div>
        <p className="text-sm font-medium text-slate-500">Todo · 个人空间</p>
        <h1 className="mt-1 text-2xl font-semibold">随时记录，跨设备继续</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">创建新的个人空间，或使用已有访问码恢复。v1.2 浏览器旧任务不会自动导入。</p>
      </div>
      <Button className="w-full" onClick={() => void handleCreate()} disabled={busy}>
        {busy ? "正在处理…" : "创建个人空间"}
      </Button>
      <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/><span>或</span><span className="h-px flex-1 bg-slate-200"/></div>
      <form className="space-y-3" onSubmit={handleRecover}>
        <label className="block space-y-2 text-sm font-medium">
          <span>访问码</span>
          <input
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            placeholder="TD-…"
            autoComplete="off"
          />
        </label>
        <Button className="w-full" type="submit" variant="outline" disabled={busy}>使用访问码恢复</Button>
      </form>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
