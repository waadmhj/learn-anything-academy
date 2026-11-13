"use client";

import { CheckCircle2, Circle, Link2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { api, useApi } from "@/lib/api";
import { useMarkCourse } from "@/lib/course";
import type { Course, ProjectDetail } from "@/lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, PageSkeleton, ProgressBar, cn, pct } from "@/components/ui";

const inputCls = "h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm focus:border-accent focus:outline-none";

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((x) => (
        <li key={x} className="flex gap-2 text-sm text-fg-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" />
          {x}
        </li>
      ))}
    </ul>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload, setData } = useApi<ProjectDetail>(`/projects/${id}`);
  const { data: course } = useApi<Course>(data ? `/courses/${data.course_id}` : null);
  useMarkCourse(course);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ repo_url?: string; demo_url?: string; notes?: string } | null>(null);
  const [adr, setAdr] = useState({ title: "", decision: "", rationale: "" });

  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const isCap = data.level === "capstone" || data.level === "portfolio";
  const spec = data.spec as Record<string, unknown>;
  const pr = data.progress;
  const form = { repo_url: pr?.repo_url ?? "", demo_url: pr?.demo_url ?? "", notes: pr?.notes ?? "", ...draft };
  const done = data.milestones.filter((m) => m.done).length;

  const update = async (body: Record<string, unknown>) => {
    setSaving(true);
    setErr(null);
    try {
      setData(await api<ProjectDetail>(`/projects/${id}/progress`, { method: "PUT", json: body }));
      setDraft(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (mid: string, doneNow: boolean) => {
    setErr(null);
    try {
      const ev = evidence[mid]?.trim();
      setData(await api<ProjectDetail>(`/projects/${id}/milestones/${encodeURIComponent(mid)}`, { method: "PUT", json: { done: doneNow, evidence_url: ev || null } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={<Link href={`/courses/${data.course_id}/projects`} className="hover:text-fg">{course ? `${course.title} · Projects` : "Projects"}</Link>}
        title={data.title}
        description={data.summary}
        actions={<Badge tone={isCap ? "accent" : "neutral"}>{data.level} · ~{data.hours}h</Badge>}
      />
      {err && <p role="alert" className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">{err}</p>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {((spec.requirements as string[] | undefined)?.length ?? 0) > 0 && (
            <Card className="p-5">
              <p className="mb-2 text-sm font-semibold">What to produce</p>
              <List items={spec.requirements as string[]} />
            </Card>
          )}

          <Card>
            <CardHeader title="Milestones" subtitle={isCap ? "Each milestone needs evidence: a link to a document, photo, recording, repository or demo" : "Check each one off as you meet it"} />
            <ol className="space-y-2 px-5 pb-5">
              {data.milestones.map((m, i) => (
                <li key={m.id} className={cn("rounded-lg border p-3", m.done ? "border-success/40 bg-success-soft/40" : "border-border")}>
                  <div className="flex items-start gap-3">
                    <button onClick={() => toggle(m.id, !m.done)} aria-label={m.done ? `Mark "${m.title}" not done` : `Mark "${m.title}" done`} className="mt-0.5">
                      {m.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-fg-3 hover:text-accent" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{isCap && `${i + 1}. `}{m.title}</p>
                      {m.deliverables.length > 0 && <div className="mt-1"><List items={m.deliverables} /></div>}
                      {m.evidence_url && <a href={m.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-xs text-accent-text hover:underline">{m.evidence_url}</a>}
                      {isCap && !m.done && (
                        <input value={evidence[m.id] ?? ""} onChange={(e) => setEvidence({ ...evidence, [m.id]: e.target.value })} placeholder="https://… (doc, photo album, video, repo)" aria-label={`Evidence link for ${m.title}`} className={cn(inputCls, "mt-2 h-8 text-xs")} />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {isCap && (
            <Card>
              <CardHeader title="Key decisions and reflections" subtitle="Record at least two before submitting: what you chose, the alternatives, and why." />
              <div className="space-y-3 px-5 pb-5">
                {(pr?.decisions ?? []).map((d, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{i + 1}. {d.title}</p>
                      <button onClick={() => update({ decisions: pr!.decisions.filter((_, j) => j !== i) })} aria-label="Delete decision" className="text-fg-3 hover:text-danger">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-sm"><span className="text-fg-3">Decision:</span> {d.decision}</p>
                    <p className="mt-1 text-sm text-fg-2"><span className="text-fg-3">Rationale:</span> {d.rationale}</p>
                  </div>
                ))}
                <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                  <input value={adr.title} onChange={(e) => setAdr({ ...adr, title: e.target.value })} placeholder="Title, e.g. Chose a narrower topic for depth" className={inputCls} aria-label="Decision title" />
                  <textarea value={adr.decision} onChange={(e) => setAdr({ ...adr, decision: e.target.value })} placeholder="Decision and alternatives considered" rows={2} className={cn(inputCls, "h-auto py-2")} aria-label="Decision" />
                  <textarea value={adr.rationale} onChange={(e) => setAdr({ ...adr, rationale: e.target.value })} placeholder="Why, and what evidence or feedback supports it" rows={2} className={cn(inputCls, "h-auto py-2")} aria-label="Rationale" />
                  <Button size="sm" disabled={adr.title.length < 3 || adr.decision.length < 3 || adr.rationale.length < 3} loading={saving} onClick={async () => { await update({ decisions: [...(pr?.decisions ?? []), adr] }); setAdr({ title: "", decision: "", rationale: "" }); }}>
                    <Plus className="size-3.5" /> Add decision
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Workspace</span>
              <Badge>{pr?.status?.replace("_", " ") ?? "not started"}</Badge>
            </div>
            <ProgressBar value={data.milestones.length ? (done / data.milestones.length) * 100 : 0} tone={pr?.status === "completed" ? "success" : "accent"} label="Milestones" />
            <p className="text-xs text-fg-3">{done}/{data.milestones.length} complete</p>
            <label className="block text-xs text-fg-3">
              <span className="flex items-center gap-1"><Link2 className="size-3" /> Link to your work</span>
              <input value={form.repo_url} onChange={(e) => setDraft({ ...form, repo_url: e.target.value })} placeholder="https://… (document, repository, video, portfolio)" className={cn(inputCls, "mt-1")} />
            </label>
            <label className="block text-xs text-fg-3">
              Second link (optional)
              <input value={form.demo_url} onChange={(e) => setDraft({ ...form, demo_url: e.target.value })} placeholder="https://…" className={cn(inputCls, "mt-1")} />
            </label>
            <label className="block text-xs text-fg-3">
              Notes
              <textarea value={form.notes} onChange={(e) => setDraft({ ...form, notes: e.target.value })} rows={4} className={cn(inputCls, "mt-1 h-auto py-2")} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!draft} loading={saving} onClick={() => update({ repo_url: form.repo_url || null, demo_url: form.demo_url || null, notes: form.notes })}>Save</Button>
              {(!pr || pr.status === "not_started") && <Button size="sm" variant="primary" onClick={() => update({ status: "in_progress" })}>Start project</Button>}
              {pr?.status === "in_progress" && <Button size="sm" variant="primary" onClick={() => update({ status: "submitted" })}>Submit</Button>}
              {pr?.status === "submitted" && <Button size="sm" variant="primary" onClick={() => update({ status: "completed" })}>Mark complete</Button>}
            </div>
          </Card>

          {data.rubric.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Evaluation rubric</p>
                {pr?.rubric_score != null && <span className="text-sm font-semibold tabular-nums">{pct(pr.rubric_score)}</span>}
              </div>
              <p className="mt-1 text-xs text-fg-3">Self-assess honestly, ideally after a peer review. Scores are weighted.</p>
              <div className="mt-3 space-y-3">
                {data.rubric.map((c) => (
                  <div key={c.id}>
                    <p className="text-[13px] font-medium">{c.criterion} <span className="font-normal text-fg-3">· {c.weight}%</span></p>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {(["developing", "proficient", "exemplary"] as const).map((lvl) => (
                        <button key={lvl} title={c.levels[lvl]} onClick={() => update({ rubric_scores: { ...(pr?.rubric_scores ?? {}), [c.id]: lvl } })} className={cn("rounded-md border px-1.5 py-1 text-[11px] capitalize", pr?.rubric_scores?.[c.id] === lvl ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg-2 hover:bg-surface-2")}>
                          {lvl}
                        </button>
                      ))}
                    </div>
                    {pr?.rubric_scores?.[c.id] && <p className="mt-1 text-[11px] text-fg-3">{c.levels[pr.rubric_scores[c.id]]}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {data.prerequisites.length > 0 && (
            <Card className="p-5">
              <p className="text-sm font-semibold">Prerequisite modules</p>
              <ul className="mt-2 space-y-1 text-sm">
                {data.prerequisites.map((p) => <li key={p.id}><Link href={`/modules/${p.id}`} className="text-accent-text hover:underline">{p.title}</Link></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
