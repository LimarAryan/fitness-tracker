# Fitness Tracker

Fitness Tracker is a local full-stack app for logging meals, calories, macros, and simple workout exercises. It includes barcode lookup through Open Food Facts so scanned food products can automatically populate calories, protein, fat, and carbohydrates while still leaving those fields editable.

## Features

- Daily meal and macro tracking
- Barcode scanning from the browser camera
- Manual barcode lookup fallback
- Open Food Facts product lookup and local food caching
- Editable calories, proteins, fats, and carbs after lookup
- Simple exercise logging with reps and sets
- Login, registration, and local profile support
- SQLite-backed local data store
- Docker Compose setup for frontend and backend

## Project Structure

```text
Fitness/
  docker-compose.yml
  fitness-backend/
    db.js
    index.js
    package.json
  fitness-frontend/
    public/
    src/
    package.json
```

## Tech Stack

- Frontend: React, React Scripts, Axios, ZXing browser barcode scanning
- Backend: Node.js, Express, SQLite, JWT auth
- External API: Open Food Facts API v2
- Runtime: Docker Compose or local Node processes

## Prerequisites

- Node.js
- npm
- Docker Desktop, optional

## Local Development

Install backend dependencies:

```powershell
cd fitness-backend
npm install
```

Start the backend:

```powershell
npm start
```

Install frontend dependencies:

```powershell
cd ..\fitness-frontend
npm install
```

Start the frontend:

```powershell
npm start
```

Open the app at:

```text
http://localhost:3000
```

The API runs at:

```text
http://localhost:5000
```

## Docker

From the project root:

```powershell
docker compose up --build
```

This starts:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5000`

## Barcode Scanning

The scanner asks for a high-resolution camera stream and supports common food barcode formats such as UPC-A, UPC-E, EAN-13, EAN-8, Code 128, Code 39, ITF, Codabar, and QR codes.

For webcams, barcode focus can be difficult because many desktop webcams are fixed-focus. If scanning is unreliable:

- Hold the barcode farther from the camera.
- Add more light.
- Keep the barcode flat and steady.
- Use the `Capture frame` button after the barcode looks sharp in the preview.
- Use manual barcode `Lookup` as a fallback.

## Open Food Facts

Product reads use:

```text
GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json
```

The backend sends a custom User-Agent and keeps product lookup traffic under the Open Food Facts documented read limit. Product data is cached locally in SQLite after lookup.

For production, set:

```powershell
$env:OPEN_FOOD_FACTS_USER_AGENT="FitnessTracker/1.0 (contact@example.com)"
```

## Environment Variables

Backend:

- `PORT`: API port, defaults to `5000`
- `JWT_SECRET`: JWT signing secret
- `OPEN_FOOD_FACTS_USER_AGENT`: Open Food Facts User-Agent string
- `OPEN_FOOD_FACTS_MAX_REQUESTS_PER_MINUTE`: local product lookup ceiling, defaults to `95`

Frontend:

- `GENERATE_SOURCEMAP=false` is set in `fitness-frontend/.env` to avoid third-party source map warnings during production builds.

## Verification

Frontend:

```powershell
cd fitness-frontend
npm test -- --watchAll=false
npm run build
```

Backend:

```powershell
cd fitness-backend
node --check index.js
node --check db.js
```

## Data

SQLite data is stored under:

```text
fitness-backend/data/fitness.db
```

This file is ignored by git because it is local runtime data.
