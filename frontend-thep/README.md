# DetectSteel Frontend (Vite + React)

Frontend for steel surface defect detection, designed to call a FastAPI backend.

## Environment Variable

Create a `.env` file for local development:

```env
VITE_API_BASE_URL=http://localhost:8000
```

For production on Vercel, set:

```env
VITE_API_BASE_URL=https://<your-render-backend>.onrender.com
```

## Run Locally

```bash
npm install
npm run dev
```

## Deploy Backend on Render

This repository includes `render.yaml` at project root for backend deployment.

1. Push repository to GitHub.
2. In Render Dashboard, create a new **Blueprint** from this repo.
3. Deploy service `detectsteel-backend`.
4. Copy backend URL from Render (example: `https://detectsteel-backend.onrender.com`).

## Deploy Frontend on Vercel

Existing production project:
- `steel_fault_detector` -> `https://steelfaultdetector.vercel.app`

Set env in Vercel:

```bash
vercel env add VITE_API_BASE_URL production
vercel env add VITE_API_BASE_URL preview
```

When prompted, paste your Render backend URL.

Redeploy frontend:

```bash
vercel --prod --yes --archive=tgz
```

## Notes

- Frontend reads API URL from `VITE_API_BASE_URL`.
- If the backend URL changes, update the Vercel env and redeploy frontend.
