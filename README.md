# Learn Anything Academy

Give it **any subject** and, if you have one, **your syllabus or material** (paste it, or upload a PDF, Word,
Markdown or text file). It builds a structured course and gathers the best-rated material for it:

* **A prerequisite-aware course plan:** stages → modules → lessons with objectives, mapped back to every topic in
  your syllabus (coverage check), plus mini projects and a capstone.
* **The best-evaluated resources**, matched to each lesson:
  * **Hacker News:** top-voted stories (points and comments) and links that several commenters recommend in
    "Ask HN: how do I learn X?" threads
  * **Open Library:** books ranked by reader ratings
  * **Semantic Scholar:** papers ranked by citations, with arXiv as a fallback
  * **Wikipedia:** an overview for each lesson
  * **YouTube** (optional key): videos ranked by likes

  Every link is real; nothing is invented.
* **Full lessons written by Claude** (when an AI key is set), on the same standard as the hand-written original:
  * a concept ladder: simple → technical → worked example → diagram, maths or code → real world → common mistakes → when to use it
  * a practice task with hints and a model solution
  * a 7-question knowledge check, and flashcards
* **Everything from AI Engineering Academy**, per course:
  * dashboard, learning path, curriculum, mastery rules
  * spaced-repetition flashcards, revision and exam modes, projects with milestones and a rubric
  * progress analytics, and a course tutor that cites your lessons
  * Notability-style highlights, sticky notes, pen, marker and a notebook

```
learn-anything/
  api/   FastAPI + SQLAlchemy (SQLite locally, PostgreSQL in production)
         app/services/builder.py   plan → find resources → write lessons
         app/services/sources.py   Hacker News, Open Library, Semantic Scholar/arXiv, Wikipedia, YouTube
         app/services/llm.py       Claude (structured outputs, refusal fallbacks), optional
  web/   Next.js 15 + TypeScript + Tailwind v4
  docs/  STATUS.md, DEPLOYMENT.md
```

## Run it locally (Windows PowerShell)

```powershell
# Terminal 1: API
cd api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# Terminal 2: web
cd web
npm install
npm run dev                        # http://localhost:3000
```

**AI is optional.** To have Claude plan courses and write lessons, put your key in `api/.env`
(copy `api/.env.example`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then restart the API.

Without a key:
* Courses are built from your syllabus's headings, numbering and bullets. With no syllabus, the subject's Wikipedia article structure is used.
* Lessons are guided outlines with real resources and a self-check.
* The tutor answers with the most relevant passages instead of writing an explanation.

**Cost with AI.** The default model is Claude Opus 5.5 at `AI_EFFORT=medium`:
* Planning a course is one request.
* Each lesson is one request, roughly 10–15k output tokens.
* Matching resources is one small request per module.

Lessons are written only when you open them (or click **Write the remaining…**), so you pay only for lessons you use.

## Tests and checks

```powershell
cd api;  .\.venv\Scripts\python.exe -m pytest      # 22 tests, fake Claude and fake sources: no network, no cost
cd web;  npx tsc --noEmit; npm run lint; npm run build
```

## How a course is built

1. **Plan.**
   * With AI: Claude designs the stages, modules (with prerequisites), lessons (objectives, search queries, which syllabus topics each covers) and projects from your goal, level, weekly hours and material.
   * Without AI: your syllabus's structure, or Wikipedia's.
2. **Find.** The searches above run in parallel for the subject, each module and each lesson.
3. **Match.**
   * With AI: Claude picks 1–2 required and up to 3 supplementary resources per lesson, relevance first and rating second.
   * Without AI: keyword relevance × quality signal.
4. **Write.**
   * The first lesson is written during the build; the rest when opened.
   * Each lesson must pass the lesson standard (`app/content/schemas.py`), or it is retried once and then marked "not written" with the reason.
   * AI-drawn diagrams are sanitised (only basic SVG shapes survive).

Your material is treated as content, not instructions, in every prompt. Uploads are limited to 15 MB, and course
material to 300,000 characters. If material is over the limit, you're told; it is never silently cut.
