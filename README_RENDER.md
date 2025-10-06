Deploying to Render (Docker)

This project includes a `render.yaml` manifest and a production `Dockerfile` that builds the Vite app and packages a small Node server.

Quick checklist before deploying:

- Ensure `.env` is NOT committed (this repo's `.gitignore` now includes `.env`).
- Create the following secrets in the Render dashboard (Service → Environment → Secrets):
  - `EARTHDATA_USER` — your Earthdata username
  - `EARTHDATA_PASS` — your Earthdata password
  - `NASA_API_KEY` — (optional) NASA API key to ease requests to NASA endpoints
  - `GOOGLE_MAPS_API_KEY` — (optional) server-side geocoding/autocomplete fallback

Deploy steps (two options):

1) Let Render build from your repo (recommended for smaller teams):
   - In Render, choose "New → Web Service" and connect the `Adurao24874/geo-sparkle-react-06277` repo.
   - Render should detect `render.yaml` and create the `geo-sparkle-react-06277` service using the `Dockerfile` in the repo.
   - Set the secrets listed above using Render's UI and click "Create Web Service".

2) Push a pre-built image to a registry (recommended if you want faster deploys):
   - Build and push to GHCR/DockerHub:

```powershell
docker build -t ghcr.io/<OWNER>/geo-sparkle:latest .
docker push ghcr.io/<OWNER>/geo-sparkle:latest
```

   - In Render, create a new Docker service and point it to your registry image.

Validation and health checks
- The service exposes `/health` which returns { ok: true } when healthy. The `render.yaml` uses `/health` as the health check path.
- Server serves the SPA at `/` and static assets from `/assets`.

Troubleshooting notes
- If builds fail on Render while installing Python packages (pandas/scipy), try temporarily increasing the instance size to allow the build to complete, or build the image locally and push to a registry.
- If the client reports reload.js / ws errors in console: open the site in an Incognito window (extensions disabled) to confirm whether a browser extension is probing your origin. The server is production-ready and won't serve the dev websocket.

Security
- Do not commit `.env`.
- Use Render secrets to keep credentials safe and rotate them if exposed.

If you want, I can also add a small GitHub Actions workflow that builds the Docker image and pushes it to GHCR automatically on merge to `main`.
