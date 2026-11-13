"use client";

import { GraduationCap } from "lucide-react";
import { useState } from "react";
import { Button, Card, Tabs } from "@/components/ui";
import { api, setToken } from "@/lib/api";

const inputCls = "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm focus:border-accent focus:outline-none";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      const { token } = await api<{ token: string }>(`/auth/${mode}`, { method: "POST", json: body });
      setToken(token);
      location.href = "/";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white"><GraduationCap className="size-4" /></span>
          <span className="font-semibold">Learn Anything Academy</span>
        </div>
        <Tabs value={mode} onChange={setMode} items={[{ value: "login", label: "Sign in" }, { value: "register", label: "Create account" }]} className="mb-5" />
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <label className="block text-sm">Name<input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={`${inputCls} mt-1`} /></label>
          )}
          <label className="block text-sm">Email<input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${inputCls} mt-1`} /></label>
          <label className="block text-sm">Password
            <input type="password" required minLength={mode === "register" ? 10 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={`${inputCls} mt-1`} />
            {mode === "register" && <span className="mt-1 block text-xs text-fg-3">At least 10 characters.</span>}
          </label>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
      </Card>
    </div>
  );
}
