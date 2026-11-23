"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RecoveryAudit } from "@/lib/admin";

import {
  checkAdminSession,
  getRecoveryAudits,
  loginAdmin,
  resetAccessCode,
} from "../admin-client";

const inputClass = "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export function AdminApp({
  checkSession = checkAdminSession,
  login = loginAdmin,
  reset = resetAccessCode,
  loadAudits = getRecoveryAudits,
}: {
  checkSession?: () => Promise<boolean>;
  login?: typeof loginAdmin;
  reset?: typeof resetAccessCode;
  loadAudits?: typeof getRecoveryAudits;
}) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [audits, setAudits] = useState<RecoveryAudit[]>([]);

  useEffect(() => {
    checkSession().then(setAuthenticated).catch(() => {
      setAuthenticated(false);
      setError("管理员会话检查失败");
    });
  }, [checkSession]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login({
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        totp: String(form.get("totp") ?? ""),
      });
      setAuthenticated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员验证失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset() {
    setBusy(true);
    setError(null);
    try {
      setNewCode(await reset(spaceId.trim()));
      setConfirming(false);
      setAudits(await loadAudits());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "访问码重置失败，旧访问码保持有效");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function refreshAudits() {
    setBusy(true);
    setError(null);
    try {
      setAudits(await loadAudits());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审计记录读取失败");
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === null) return <p className="py-12 text-center text-sm text-slate-500">正在检查管理员会话…</p>;

  if (!authenticated) {
    return (
      <form onSubmit={handleLogin} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div><p className="text-sm text-slate-500">安全管理入口</p><h1 className="mt-1 text-2xl font-semibold">管理员验证</h1></div>
        <label className="block space-y-1 text-sm"><span>用户名</span><input className={inputClass} name="username" autoComplete="username" required /></label>
        <label className="block space-y-1 text-sm"><span>强密码</span><input className={inputClass} name="password" type="password" autoComplete="current-password" required /></label>
        <label className="block space-y-1 text-sm"><span>动态验证码</span><input className={inputClass} name="totp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required /></label>
        <Button className="w-full" type="submit" disabled={busy}>{busy ? "正在验证…" : "进入恢复管理"}</Button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>
    );
  }

  return (
    <section className="space-y-5" aria-label="访问码恢复管理">
      <div className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">安全管理入口</p><h1 className="mt-1 text-2xl font-semibold">访问码恢复</h1><p className="mt-2 text-sm text-slate-600">根据个人空间 ID 生成新访问码。成功后旧访问码立即失效。</p></div>
      <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <label className="block space-y-1 text-sm"><span>个人空间 ID</span><input className={inputClass} value={spaceId} onChange={(event) => setSpaceId(event.target.value)} /></label>
        <Button className="w-full" disabled={busy || !spaceId.trim()} onClick={() => setConfirming(true)}>重置访问码</Button>
      </div>
      {newCode && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm font-medium text-amber-800">新访问码仅本次展示</p><code className="mt-2 block break-all text-base font-semibold">{newCode}</code><button className="mt-3 text-sm underline" onClick={() => setNewCode(null)}>我已保存并关闭</button></div>}
      <div className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">恢复审计</h2><Button variant="outline" size="sm" onClick={() => void refreshAudits()} disabled={busy}>刷新</Button></div>{audits.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">暂无恢复记录</p> : <ul className="mt-4 space-y-3">{audits.map((audit) => <li key={audit.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-medium">{audit.attemptedSpaceId}</p><p className="mt-1 text-slate-500">{audit.occurredAt} · {audit.result}</p></li>)}</ul>}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {confirming && <div role="dialog" aria-modal="true" aria-label="确认重置访问码" className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4"><div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5"><h2 className="text-lg font-semibold">确认重置访问码</h2><p className="text-sm text-slate-600">新访问码生成后，空间 {spaceId} 的旧访问码立即失效。此操作不可撤销。</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>取消</Button><Button className="bg-red-600 hover:bg-red-700" onClick={() => void confirmReset()} disabled={busy}>确认重置</Button></div></div></div>}
    </section>
  );
}
