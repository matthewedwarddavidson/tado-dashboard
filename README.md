# tado-data-analyser

Better dashboards for your tado° smart thermostat data.

![Dashboard screenshot](docs/dashboard.png)

## Architecture

| Layer | Stack |
|---|---|
| Backend | Clojure, Ring, reitit, clj-http |
| Frontend | React 18, TypeScript, Vite, Recharts, Tailwind CSS |

The Clojure backend acts as an authenticated proxy to the tado API v2, exposing
a clean REST API for the frontend.

## Setup

1. In two separate terminals:

```sh
make backend    # starts the API server on http://localhost:3000
make frontend   # installs deps and starts the dev server on http://localhost:5173
```

On **first run**, `make backend` will print a URL — open it in your browser, log in
with your tado° account, and the server will continue automatically. The resulting
refresh token is saved to `backend/.tado-token.edn` so subsequent restarts skip
this step.

Run `make help` to see all available targets.

### Production build

```sh
make build   # outputs to frontend/dist/
```

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/me` | Current user + home IDs |
| GET | `/api/homes/:id/zones` | List zones (rooms) |
| GET | `/api/homes/:id/zones/:zone-id/state` | Current temperature, humidity, heating |
| GET | `/api/homes/:id/zones/:zone-id/day-report?date=YYYY-MM-DD` | Historical day data |
| GET | `/api/homes/:id/weather` | Outside temperature & weather |
| GET | `/api/homes/:id/state` | Home presence (HOME/AWAY) |

