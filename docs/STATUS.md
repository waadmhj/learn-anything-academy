# Status

## Verified

| Area | How |
|---|---|
| Course creation from subject, pasted syllabus or uploaded file (PDF, Word, Markdown, text); size limits with clear errors | API tests |
| Build without AI: syllabus headings/numbering/bullets → modules and lessons; no syllabus → Wikipedia article structure | API tests + live run ("Music theory" with a syllabus, "Linear algebra" without) |
| Build with AI: outline → resource matching → first lesson written; invalid prerequisites dropped; out-of-range picks ignored | API tests with a fake Claude provider |
| Lesson writing on demand and "write all"; lessons that fail the standard are marked failed with the reason and can be retried | API tests |
| Resource discovery: HN stories (points/comments), HN "Ask HN" recommendations (commenter counts), Open Library (ratings), Semantic Scholar (citations) / arXiv fallback, Wikipedia | Live calls against the real services |
| Ownership: other learners' courses, lessons, modules, annotations and search results return 404 | API tests |
| Deleting a course removes its content and your progress, notes and activity for it | API tests |
| Learning loop on generated lessons: knowledge check, mastery, flashcards, revision and exam modes, projects with rubric, course tutor | API tests |
| Highlights, sticky notes, pen/marker, notebook (carried over) | API tests |
| UI: home, new course, build progress, course dashboard, curriculum with syllabus coverage, lesson, resources with quality badges, tutor; desktop, dark mode, 390 px mobile; no console errors | Headless browser screenshots |

## Not verified

* **Real Claude calls.** No API key was available in this session. The Claude integration follows the current SDK
  (2.8: `beta.messages.parse` with structured outputs and server-side refusal fallbacks), and every code path is
  tested with a fake provider. The first real run will show actual lesson quality and cost.
* **YouTube.** Ranked videos need `YOUTUBE_API_KEY`. Without it, YouTube links still appear when Hacker News recommends them.
* **PostgreSQL and Docker** for this project. The models are the same kind as in the deployed original.

## Known limitations

* **Background work runs inside the API process.** Course builds and lesson writing are background threads. If the
  server restarts mid-build, the course is marked failed (with a retry button) and interrupted lessons go back to outline.
* **Quality of the no-AI fallback.** Without AI, a Wikipedia-derived outline follows the article's sections, which
  aren't always the best teaching order (e.g. "History" first). Uploading a syllabus or enabling AI gives a much better plan.
* **Semantic Scholar rate limits.** It rate-limits unauthenticated requests heavily. When that happens, arXiv is
  searched instead (no citation counts).
