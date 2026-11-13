"use client";

import { useParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApi } from "./api";
import type { Course } from "./types";

export interface CourseRef {
  id: number;
  title: string;
}

const KEY = "academy.course";
const Ctx = createContext<{ course: CourseRef | null; setCourse: (c: CourseRef | null) => void }>({ course: null, setCourse: () => {} });

/** Remembers which course the learner is in, so the sidebar can show that course's sections everywhere. */
export function CourseProvider({ children }: { children: ReactNode }) {
  const [course, setState] = useState<CourseRef | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* no saved course */
    }
  }, []);
  const setCourse = useCallback((c: CourseRef | null) => {
    setState(c);
    try {
      if (c) localStorage.setItem(KEY, JSON.stringify(c));
      else localStorage.removeItem(KEY);
    } catch {
      /* not persisted */
    }
  }, []);
  return <Ctx.Provider value={{ course, setCourse }}>{children}</Ctx.Provider>;
}

export const useCurrentCourse = () => useContext(Ctx);

/** Mark a course as current once its id and title are known. */
export function useMarkCourse(c: { id: number; title: string } | null | undefined) {
  const { course, setCourse } = useCurrentCourse();
  useEffect(() => {
    if (c && (course?.id !== c.id || course?.title !== c.title)) setCourse({ id: c.id, title: c.title });
  }, [c, course, setCourse]);
}

/** For pages under /courses/[cid]: the course id from the URL, plus the course itself (marked as current). */
export function useCoursePage() {
  const { cid } = useParams<{ cid: string }>();
  const res = useApi<Course>(`/courses/${cid}`);
  useMarkCourse(res.data);
  return { cid, base: `/courses/${cid}`, ...res };
}
