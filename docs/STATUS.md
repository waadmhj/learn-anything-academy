# Status

## Verified

| Area | How |
|---|---|
| Course creation from subject, pasted syllabus or uploaded file (PDF, Word, Markdown, text); size limits with clear errors | API tests |
| Build without AI: syllabus headings/numbering/bullets → modules and lessons; no syllabus → Wikipedia article structure | API tests + live run ("Music theory" with a syllabus, "Linear algebra" without) |
| Build with AI: outline → resource matching → first lesson written; invalid prerequisites dropped; out-of-range picks ignored | API tests with a fake Claude provider |
| Lesson writing on demand and "write all"; lessons that fail the standard are marked failed with the reason and can be retried | API tests |
| Resource discovery: HN stories (points/comments), HN "Ask HN" recommendations (commenter counts), Open Library (ratings), Semantic Scholar (citations) / arXiv fallback, Wikipedia | Live calls against the real services |
| Videos for every lesson (Internet Archive lectures, HN-voted videos, YouTube channels and playlists); off-topic matches filtered by subject | API tests + live run ("Linear algebra": 3Blue1Brown, MIT 18.06; "Music theory": HN videos and recommended channels) |
| Resources open inside the site: video players, embedded pages, sanitised reading views (Wikipedia with formulas, GitHub, HN threads, pages that block embedding), arXiv PDFs | API tests + live checks + headless browser screenshots (desktop, mobile, dark mode) |
| Ownership: other learners' courses, lessons, modules, annotations and search results return 404 | API tests |
| Deleting a course removes its content and your progress, notes and activity for it | API tests |
| Learning loop on generated lessons: knowledge check, mastery, flashcards, revision and exam modes, projects with rubric, course tutor | API tests |
| Highlights, sticky notes, pen/marker, notebook (carried over) | API tests |
| UI: home, new course, build progress, course dashboard, curriculum with syllabus coverage, lesson, resources with quality badges, tutor; desktop, dark mode, 390 px mobile; no console errors | Headless browser screenshots |

## Not verified

* **Real Claude calls.** No API key was available in this session. The Claude integration follows the current SDK
  (2.8: `beta.messages.parse` with structured outputs and server-side refusal fallbacks), and every code path is
  tested with a fake provider. The first real run will show actual lesson quality and cost.
* **YouTube search.** Ranked YouTube results need `YOUTUBE_API_KEY`. Without it, videos come from the Internet Archive and
  Hacker News. That's strong for academic subjects (e.g. MIT lectures) and thinner for niche ones.
* **PostgreSQL and Docker** for this project. The models are the same kind as in the deployed original.

## Known limitations

* **Reading views of other sites.** A page that refuses embedding is shown as a reading view of its main text (like a
  browser's reader mode), fetched live and never stored, with a credit and a link to the original. Interactive pages
  (apps that need their own JavaScript) can't be reproduced and fall back to a link.

* **Background work runs inside the API process.** Course builds and lesson writing are background threads. If the
  server restarts mid-build, the course is marked failed (with a retry button) and interrupted lessons go back to outline.
* **Quality of the no-AI fallback.** Without AI, a Wikipedia-derived outline follows the article's sections, which
  aren't always the best teaching order (e.g. "History" first). Uploading a syllabus or enabling AI gives a much better plan.
* **Semantic Scholar rate limits.** It rate-limits unauthenticated requests heavily. When that happens, arXiv is
  searched instead (no citation counts).
