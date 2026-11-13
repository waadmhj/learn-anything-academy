# Deployment

The same shape as the original academy: **Netlify** (web) + **Render** (API, Docker) + **Neon** (PostgreSQL).

## API on Render

1. Create a Web Service from this repository:
   * Language: Docker
   * Dockerfile path: `api/Dockerfile`
   * Root directory: empty
2. Set these environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon connection string with `postgresql://` changed to `postgresql+psycopg://` |
| `AUTH_MODE` | `jwt` (accounts, so every learner sees only their own courses) |
| `JWT_SECRET` | a long random string (Render's **Generate**) |
| `CORS_ORIGINS` | your Netlify URL |
| `PUBLIC_URL` | your Netlify URL (used as the contact address in API requests; Wikipedia requires one) |
| `PORT` | `8000` |
| `ANTHROPIC_API_KEY` | optional: enables AI-written courses and lessons |
| `YOUTUBE_API_KEY` | optional: ranked YouTube videos |

3. Set **Health check path** to `/api/health`.

The tables are created on first start.

## Web on Netlify

* `netlify.toml` already sets the base directory (`web`) and the Next.js adapter.
* Add `API_URL=https://<your-api>.onrender.com`, then deploy.
* `API_URL` is read when the site is built, so redeploy after changing it.

## Production notes

* **Builds and lesson writing run in background threads** inside the API process.
  * On Render's free plan the service sleeps after about 15 minutes idle. A build that's running keeps it awake, but a restart interrupts it; the course then shows **Try again**.
  * For heavy use, move the jobs to a worker queue.
* **Keep `ANTHROPIC_API_KEY` in Render's environment settings only**, never in the repository.
* **Per-learner limits:** 50 courses, 300,000 characters of material per course, 15 MB per upload.
