(fitness-app-img.png)

# Fitness Tracker

Fitness Tracker is a full-stack web app for tracking meals, calories, macros, and simple workout exercises. It includes browser-based barcode scanning with Open Food Facts integration, so food products can be scanned or looked up by barcode and automatically fill in nutrition fields.

The app is designed for local use and personal tracking. Nutrition values from the API stay editable, so users can correct calories, protein, fat, or carbs before saving a meal entry.

## What It Does

- Tracks daily food entries by date.
- Calculates daily totals for calories, protein, fat, and carbohydrates.
- Scans food barcodes from the browser camera.
- Looks up product nutrition data from Open Food Facts.
- Lets users manually edit API-filled nutrition values before saving.
- Logs simple workout exercises with reps and sets.
- Supports password-backed accounts and quick local profiles.
- Stores data locally in SQLite.

## Features

### Nutrition Tracking

- Add foods manually or by barcode.
- Track calories, protein, fat, and carbs.
- View totals for the selected day.
- Edit or delete saved meal entries.
- Preserve zero-value nutrition data, such as bottled water with `0` calories and `0` macros.

### Barcode Scanning

- Uses the browser camera for barcode detection.
- Supports common food barcode formats including UPC-A, UPC-E, EAN-13, EAN-8, Code 128, Code 39, ITF, Codabar, and QR.
- Includes a manual barcode lookup fallback.
- Includes a capture-frame option for difficult webcams or blurry barcode previews.
- Allows camera switching and zoom controls when supported by the browser/device.

### Open Food Facts Integration

- Uses the Open Food Facts API v2 product endpoint.
- Sends a custom User-Agent.
- Requests only the fields needed by the app.
- Caches product results locally in SQLite.
- Keeps product lookup requests under the documented Open Food Facts rate limit.

### Exercise Tracking

- Add simple exercises with reps and sets.
- View saved exercise entries.
- Delete exercises from the list.

### Accounts and Local Profiles

- Register and log in with email/password.
- Use a local profile without creating a password-backed account.
- Store session/profile data in browser local storage for convenience.

### Deployment and Development

- Run frontend and backend separately with npm.
- Run the full stack with Docker Compose.
- Keep local SQLite data out of git.

## How to Run

### Option 1: Run with Docker Compose

From the project root:

```powershell
docker compose up --build
```

Then open:

```text
http://localhost:3000
```

The backend API will run at:

```text
http://localhost:5000
```

### Option 2: Run Locally with npm

Install and start the backend:

```powershell
cd fitness-backend
npm install
npm start
```

In a second terminal, install and start the frontend:

```powershell
cd fitness-frontend
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

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
