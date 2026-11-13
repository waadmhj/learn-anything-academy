"use client";

import { useEffect, useState } from "react";
import { applyTheme } from "@/components/app-shell";
import { Button, Card, CardHeader, ErrorState, PageHeader, PageSkeleton, Tabs } from "@/components/ui";
import { api, setToken, useApi } from "@/lib/api";

interface SettingsData {
  display_name: string;
  email: string;
  daily_goal_minutes: number;
  auth_mode: "local" | "jwt";
}
const inputCls = "h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm focus:border-accent focus:outline-none";

export default function SettingsPage() {
  const { data, error, loading, reload, setData } = useApi<SettingsData>("/settings");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(45);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.display_name);
      setGoal(data.daily_goal_minutes);
    }
    try {
      setTheme((localStorage.getItem("academy.theme") as typeof theme) || "system");
    } catch {
      /* ignore */
    }
  }, [data]);

  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<SettingsData>("/settings", { method: "PUT", json: { display_name: name, daily_goal_minutes: goal } }));
      setMsg("Saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await api("/settings/reset-progress", { method: "POST", json: { confirm } });
      setConfirm("");
      setMsg("All progress was deleted.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in max-w-2xl space-y-6">
      <PageHeader eyebrow="Settings" title="Settings" />
      <Card>
        <CardHeader title="Profile" />
        <div className="space-y-4 px-5 pb-5">
          <label className="block text-sm">
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1`} maxLength={120} />
          </label>
          <label className="block text-sm">
            Daily study goal (minutes)
            <input type="number" min={5} max={600} value={goal} onChange={(e) => setGoal(Number(e.target.value))} className={`${inputCls} mt-1 w-32`} />
          </label>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save} loading={busy}>Save changes</Button>
            {msg && <span role="status" className="text-sm text-fg-2">{msg}</span>}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Appearance" />
        <div className="px-5 pb-5">
          <Tabs value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }} items={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Account" subtitle={data.auth_mode === "local" ? "Local mode: single learner, no login. Set AUTH_MODE=jwt on the API to enable accounts." : `Signed in as ${data.email}`} />
        {data.auth_mode === "jwt" && (
          <div className="px-5 pb-5">
            <Button onClick={() => { setToken(null); location.href = "/login"; }}>Sign out</Button>
          </div>
        )}
      </Card>
      <Card className="border-danger/30">
        <CardHeader title="Reset progress" subtitle="Permanently deletes your lesson progress, quiz attempts, flashcard schedule, projects, study time and workshop results. Course content isn't affected." />
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5">
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type "RESET"' aria-label="Type RESET to confirm" className={`${inputCls} w-40`} />
          <Button variant="danger" disabled={confirm !== "RESET"} onClick={reset} loading={busy}>Delete all progress</Button>
        </div>
      </Card>
    </div>
  );
}
