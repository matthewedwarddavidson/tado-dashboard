# tado-dashboard

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

### Option A — combined server (recommended)

```sh
make start   # builds frontend, starts server at http://localhost:3000
```

On first run, open `http://localhost:3000` in your browser. You'll be prompted to
connect your tado° account — click **Connect tado°**, approve in the new tab, and
the dashboard loads automatically. The refresh token is saved to
`backend/.tado-token.edn` so subsequent starts need no browser interaction.

### Option B — development (hot-reload frontend)

Run in two separate terminals:

```sh
make backend    # API server on http://localhost:3000
make frontend   # Vite dev server on http://localhost:5173
```

### Option C — standalone uberjar

```sh
make jar
java -Djavax.net.ssl.trustStoreType=KeychainStore \
     -jar backend/target/tado-dashboard-0.1.0.jar
```

Run `make help` to see all available targets.

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/me` | Current user + home IDs |
| GET | `/api/homes/:id/zones` | List zones (rooms) |
| GET | `/api/homes/:id/zones/:zone-id/state` | Current temperature, humidity, heating |
| GET | `/api/homes/:id/zones/:zone-id/day-report?date=YYYY-MM-DD` | Historical day data |
| GET | `/api/homes/:id/weather` | Outside temperature & weather |
| GET | `/api/homes/:id/state` | Home presence (HOME/AWAY) |
