export type Status = "not_started" | "in_progress" | "completed" | "needs_revision" | "mastered";
export type Level = "beginner" | "intermediate" | "advanced";

export interface LessonBrief {
  id: string;
  title: string;
  module_id: string;
  minutes: number;
  level: Level;
  content_status: ContentStatus;
  status: Status;
  mastery: number;
}

export type ContentStatus = "authored" | "outline" | "generating" | "failed";

export interface Course {
  id: number;
  title: string;
  subject: string;
  summary: string;
  goal: string;
  level: Level;
  hours_per_week: number;
  source_name: string;
  has_material: boolean;
  status: "building" | "ready" | "failed";
  step: string;
  progress: number;
  error: string | null;
  used_ai: boolean;
  created_at: string | null;
  lessons: number;
  lessons_written: number;
  lessons_writing: number;
  lessons_failed: number;
  resources: number;
  completed?: number;
  percent?: number;
}

export interface ModuleState {
  total: number;
  completed: number;
  mastered: number;
  started: boolean;
  mastery: number;
  complete: boolean;
}

export interface CurriculumModule {
  id: string;
  title: string;
  summary: string;
  prerequisites: string[];
  project_id: string | null;
  prerequisites_met: boolean;
  missing_prerequisites: string[];
  state: ModuleState;
  hours: number;
  lessons: LessonBrief[];
}

export interface CurriculumStage {
  id: string;
  order: number;
  title: string;
  summary: string;
  modules: CurriculumModule[];
}

export interface Resource {
  id: string;
  title: string;
  provider: string;
  type: "video" | "book" | "docs" | "course" | "paper" | "interactive" | "article" | "discussion";
  level: Level;
  duration: string;
  language: string;
  cost: "free" | "paid" | "audit" | "freemium" | "";
  url: string;
  why: string;
  authors: string | null;
  year: number | null;
  isbn: string | null;
  embed: { youtube?: string; iframe?: string };
  chapters: (string | { t: string; label: string })[];
  summary: string | null;
  impact: string | null;
  source: "hackernews" | "wikipedia" | "openlibrary" | "semanticscholar" | "arxiv" | "youtube" | "web";
  score: number | null;
  comments: number | null;
  discussion_url: string | null;
  rating: number | null;
  recommended_by: number | null;
  role?: "required" | "supplementary";
  lessons?: { id: string; title: string; role: string }[];
}

export interface Section {
  kind: "simple" | "technical" | "example" | "diagram" | "math" | "code" | "real_world" | "mistakes" | "when";
  title: string;
  body?: string;
  svg?: string;
  caption?: string;
}

export interface QuizQuestion {
  id: string;
  kind: "mcq" | "multi" | "short" | "technical" | "practical" | "scenario";
  prompt: string;
  options: string[];
  lesson_id?: string | null;
  lesson_title?: string | null;
  track?: string | null;
}

export interface GradeResult {
  question_id: string;
  kind: QuizQuestion["kind"];
  score: number | null;
  correct: boolean | null;
  explanation: string | null;
  correct_answer: number | number[] | null;
  model_answer: string | null;
  keyword_coverage: number | null;
  matched_ideas: string[];
  missed_ideas: string[];
}

export interface LessonProgress {
  status: Status;
  mastery: number;
  quiz_best: number | null;
  quiz_last: number | null;
  exercise_done: boolean;
  objectives_checked: number[];
  seconds_spent: number;
  can_complete: boolean;
  can_master: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  level: Level;
  minutes: number;
  content_status: ContentStatus;
  gen_error: string | null;
  can_write: boolean;
  course: { id: number; title: string; subject: string };
  covers: string[];
  objectives: string[];
  overview: { what?: string; why?: string; where?: string; prerequisites?: string };
  sections: Section[];
  module: { id: string; title: string };
  stage: { id: string; title: string; order: number };
  exercise: null | {
    title: string;
    prompt: string;
    starter?: string | null;
    expected: string;
    hints: string[];
    advanced?: string | null;
    submitted: boolean;
  };
  quiz: QuizQuestion[];
  flashcards: number;
  resources: Resource[];
  progress: LessonProgress;
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

export interface ModuleDetail {
  id: string;
  course_id: number;
  title: string;
  summary: string;
  stage: { id: string; title: string; order: number };
  prerequisites: { id: string; title: string; complete: boolean }[];
  prerequisites_met: boolean;
  state: ModuleState;
  project: { id: string; title: string; level: string; summary: string } | null;
  lessons: (LessonBrief & { objectives: string[]; covers: string[] })[];
}

export interface Dashboard {
  course: Course;
  user: { name: string; daily_goal_minutes: number };
  totals: {
    lessons: number;
    completed: number;
    mastered: number;
    modules: number;
    modules_completed: number;
    percent: number;
    study_hours: number;
    today_minutes: number;
    streak: number;
    longest_streak: number;
    avg_quiz: number | null;
    due_cards: number;
  };
  stages: { id: string; order: number; title: string; lessons: number; completed: number; modules: number; modules_completed: number }[];
  current_stage: Dashboard["stages"][number] | null;
  continue: LessonBrief | null;
  next: LessonBrief | null;
  revision_queue: (LessonBrief & { reason: string })[];
  weak_areas: { module_id: string; title: string; accuracy: number; attempts: number }[];
  pending_projects: { id: string; status: string }[];
  capstones: { total: number; started: number; completed: number };
  upcoming_assessments: { lesson_id: string; title: string; best: number | null }[];
  activity: { kind: string; ref_id: string | null; detail: string; at: string }[];
}

export interface ProjectSummary {
  id: string;
  level: "mini" | "module" | "capstone" | "portfolio";
  title: string;
  summary: string;
  hours: number;
  module_id: string | null;
  module_title: string | null;
  prerequisites: string[];
  ready: boolean;
  status: "not_started" | "in_progress" | "submitted" | "completed";
  milestones: number;
  milestones_done: number;
}

export interface ProjectDetail {
  id: string;
  course_id: number;
  level: ProjectSummary["level"];
  title: string;
  summary: string;
  hours: number;
  covers: string[];
  spec: Record<string, unknown>;
  module: { id: string; title: string } | null;
  prerequisites: { id: string; title: string }[];
  milestones: { id: string; title: string; deliverables: string[]; done: boolean; evidence_url: string | null }[];
  rubric: { id: string; criterion: string; weight: number; levels: Record<string, string> }[];
  progress: null | {
    status: ProjectSummary["status"];
    repo_url: string | null;
    demo_url: string | null;
    notes: string;
    decisions: { title: string; decision: string; rationale: string }[];
    rubric_scores: Record<string, string>;
    rubric_score: number | null;
    started_at: string | null;
    submitted_at: string | null;
  };
}

export interface FlashcardItem {
  id: string;
  front: string;
  back: string;
  lesson_id: string;
  lesson_title: string;
  reviews: number;
  lapses: number;
  interval_days: number;
}

// ───────────── Annotations ─────────────
export type AnnKind = "highlight" | "note" | "ink";
export type AnnColor = "yellow" | "green" | "blue" | "pink" | "purple" | "orange" | "red" | "ink";
export interface HighlightData { scope: string; quote: string; prefix: string; suffix: string; start: number }
export interface NoteData { scope: string; x: number; dy: number; collapsed?: boolean }
export interface InkData { scope: string; tool: "pen" | "marker"; size: number; points: [number, number, number][] }
interface AnnBase { id: number; lesson_id: string; color: AnnColor; text: string; pinned: boolean; created_at: string; updated_at: string }
export type Annotation =
  | (AnnBase & { kind: "highlight"; data: HighlightData })
  | (AnnBase & { kind: "note"; data: NoteData })
  | (AnnBase & { kind: "ink"; data: InkData });
export type NotebookEntry = Annotation & { lesson_title: string; module_title: string; course_title: string };
