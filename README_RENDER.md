Render deployment steps

1) Create a Render account (https://render.com) and connect your GitHub account.

2) Import the repository:
   - Click "New" -> "Web Service" -> "Connect a repository" and select `Adurao24874/geo-sparkle-react-06277`.
   - Render will detect the `render.yaml` manifest and propose the `geo-sparkle-react-06277` service.

3) Configure environment variables in the Render dashboard (do NOT store secrets in the repo):
   - `VITE_GOOGLE_MAPS_API_KEY` = <your Google Maps API key>
   - `NASA_PROXY_URL` = (optional) a proxy or leave blank

4) Deploy:
   - Click "Create Web Service". Render will build the Docker image using the `Dockerfile` in the repo and start the service on a public URL.

5) Logs and health:
   - Use the Render dashboard to follow build logs and view runtime logs.

Notes:
- The Dockerfile installs Node and Python, builds the Vite frontend, and runs `server.js` which serves the static build and API endpoints.
- If your Python scripts require extra packages, ensure `requirements.txt` lists them.
- If you need any additional env vars (for Google API restrictions or API keys), add them in the Render UI.

If you want, I can trigger the import and creation directly via the Render API if you provide an API key with the necessary permissions. Otherwise follow these steps in the UI and I can help troubleshoot any build errors you see in Render's logs.
