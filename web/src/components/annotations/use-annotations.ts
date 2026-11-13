"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AnnColor, Annotation } from "@/lib/types";

export type NewAnnotation = Pick<Annotation, "kind" | "color" | "data"> & { text?: string; pinned?: boolean };
type Patch = Partial<{ color: AnnColor; text: string; pinned: boolean; data: Annotation["data"] }>;

/**
 * Annotation state for one lesson with optimistic updates. New items get a temporary negative id until the server
 * answers; edits made in the meantime wait for the real id.
 */
export function useAnnotations(lessonId: string) {
  const [items, setItems] = useState<Annotation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Map<number, Promise<number | null>>());
  const nextTemp = useRef(-1);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const reload = useCallback(async () => {
    try {
      setItems(await api<Annotation[]>(`/lessons/${lessonId}/annotations`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [lessonId]);

  useEffect(() => {
    setLoaded(false);
    setItems([]);
    reload();
  }, [reload]);

  const realId = useCallback(async (id: number) => (id > 0 ? id : ((await pending.current.get(id)) ?? null)), []);

  const create = useCallback(
    (body: NewAnnotation): number => {
      const temp = nextTemp.current--;
      const now = new Date().toISOString();
      const optimistic = { text: "", pinned: false, ...body, id: temp, _key: temp, lesson_id: lessonId, created_at: now, updated_at: now } as Annotation;
      setItems((xs) => [...xs, optimistic]);
      const p = api<Annotation>(`/lessons/${lessonId}/annotations`, { method: "POST", json: body })
        .then((saved) => {
          // Keep any edits made locally while the request was in flight.
          setItems((xs) => xs.map((x) => (x.id === temp ? ({ ...x, id: saved.id, created_at: saved.created_at } as Annotation) : x)));
          return saved.id;
        })
        .catch((e) => {
          setItems((xs) => xs.filter((x) => x.id !== temp));
          setError(`Couldn't save: ${(e as Error).message}`);
          return null;
        });
      pending.current.set(temp, p);
      return temp;
    },
    [lessonId],
  );

  const update = useCallback(
    async (id: number, patch: Patch) => {
      setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Annotation) : x)));
      const rid = await realId(id);
      if (rid == null) return;
      try {
        await api(`/annotations/${rid}`, { method: "PATCH", json: patch });
      } catch (e) {
        setError(`Couldn't save: ${(e as Error).message}`);
        reload();
      }
    },
    [realId, reload],
  );

  /** Removes items and returns them so the caller can offer "Undo". */
  const remove = useCallback(
    (ids: number[]): Annotation[] => {
      const gone = itemsRef.current.filter((x) => ids.includes(x.id));
      if (!gone.length) return [];
      setItems((xs) => xs.filter((x) => !ids.includes(x.id)));
      (async () => {
        const real = (await Promise.all(ids.map(realId))).filter((x): x is number => x != null);
        if (!real.length) return;
        try {
          await api(`/annotations/delete`, { method: "POST", json: { ids: real } });
        } catch (e) {
          setError(`Couldn't delete: ${(e as Error).message}`);
          reload();
        }
      })();
      return gone;
    },
    [realId, reload],
  );

  /** Undo a deletion by recreating the items (they get new ids). */
  const restore = useCallback(
    (gone: Annotation[]) => gone.forEach((a) => create({ kind: a.kind, color: a.color, data: a.data, text: a.text, pinned: a.pinned } as NewAnnotation)),
    [create],
  );

  const clearError = useCallback(() => setError(null), []);
  return { items, loaded, error, clearError, create, update, remove, restore, reload, resolve: realId };
}

export type AnnotationsApi = ReturnType<typeof useAnnotations>;

/** Stable React key: survives the swap from temporary to server id. */
export const keyOf = (a: Annotation) => (a as Annotation & { _key?: number })._key ?? a.id;
