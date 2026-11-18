# Paceline plan server

A small web server so a team captain can upload the zwiftgopher TTT planner export once, and every
rider's Paceline mod fetches the plan without loading any files.

- The captain logs in (one fixed user and password), uploads the planner's JSON export and,
  optionally, the text export. The server validates them with the mod's own `plan.mjs`, so
  validation, error messages and the 6-character plan code are identical to the mod.
- Each team name is its own slot. Uploading replaces only that team's plan; the page lists the
  stored teams with a delete button each.
- Reading is open: anyone who knows the team name (or a Zwift ID in the plan) can fetch the plan.
  Plans are not secret: rider names, weights, order, pull times, colours and the bench are public to anyone
  who knows the team name or a Zwift ID (weight stays because the mod shows other riders' targets in W/kg;
  the planner takes it from public ZwiftPower profiles). Height, FTP, the power profile and every other
  planner field are dropped on upload and never served (an allowlist, `stripPlanJson`; plans stored
  earlier are stripped on the way out).
- Node 22, `node:http` only, no npm dependencies. Plans are stored as one JSON file per team in
  `DATA_DIR/plans/` (atomic writes), so they survive restarts when `/data` is a volume.

## Deploy (single host, Docker Compose)

From this folder (`server/`):

```sh
cp .env.example .env
$EDITOR .env                 # set UPLOAD_USER and a long UPLOAD_PASS
mkdir -p data && chown 1000:1000 data    # the container runs as uid 1000 (user "node")
docker compose up -d --build
docker compose logs -f
```

Docker Compose interpolates `$` in `.env` values: write a literal `$` in `UPLOAD_PASS` as `$$` (or quote the
value, or avoid `$`).

The server refuses to start without `UPLOAD_USER` and `UPLOAD_PASS`, and refuses the placeholder
password from `.env.example`. The image is built with the repo root (`paceline/`) as build context
so it can copy `pages/src/engine/plan.mjs` and `colors.mjs`; run compose from `server/` as above.

### DNS and Traefik

The compose file has no published ports; Traefik reaches the container over a shared Docker network.
Point a DNS record for the host (default `ttt.mafl.net`) at the Traefik machine. Names that depend on
your Traefik setup are variables in `.env`, with these defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PACELINE_HOST` | `ttt.mafl.net` | host name in the router rule `Host(...)` |
| `TRAEFIK_ENTRYPOINT` | `websecure` | HTTPS entrypoint |
| `TRAEFIK_CERTRESOLVER` | `letsencrypt` | certificate resolver name from Traefik's static config |
| `TRAEFIK_NETWORK` | `traefik` | existing (external) Docker network Traefik is attached to |

The service port is 8080. HTTP Basic auth sends the password with every request, so only expose the
server over HTTPS (Traefik terminates TLS). Check the merged config with `docker compose config`.

### Without Docker

```sh
UPLOAD_USER=captain UPLOAD_PASS='a long password' DATA_DIR=./data PORT=8080 node server/server.mjs
```

From a checkout it reads the engine from `../pages/src/engine/`; in the image it is `./engine/`.

## Docker Swarm

The maintainers run the server as a Docker Swarm stack behind a shared Traefik, built and deployed
by their own CI. That setup lives in internal files that are not part of the public copy. For
your own server, the Docker Compose setup above is the place to start.

## How the captain uploads

1. Open `https://ttt.mafl.net/` and log in.
2. Optionally type a team name (empty uses the team name inside the JSON).
3. Choose the planner's JSON export, and the text export if you have it (it adds the pull watts).
4. Press Upload plan. The result page shows the team, the plan code and the rider table, plus any
   warnings. Errors show the same messages as the mod and store nothing.

A changed plan is live straight away, also mid-race. Uploading again with the same team name replaces
that team's plan. Maximum upload size is 1 MB.

## API

No auth, CORS open (`Access-Control-Allow-Origin: *`), `Cache-Control: no-cache`,
`ETag: "<plan code>-<8 hex>"` (the hex is a hash of the stored content, so a rename-only re-upload changes
it; `uploadedAt` is not part of it) and `Access-Control-Expose-Headers: ETag`. A matching `If-None-Match`
gets `304`.

| Request | Result |
| --- | --- |
| `GET /api/plan/<team>` | the stored record `{team, slug, sig, json, text, uploadedAt, etag}` (`etag` is the same value as the header); `<team>` is the slug (team name lower-cased, runs of non-alphanumerics become `-`, leading and trailing `-` dropped) and is slugified again on lookup, so `Rollers` works too |
| `GET /api/plan/by-athlete/<zwiftId>` | the newest stored plan whose riders or bench contain that Zwift ID, `404` if none, so riders need no setup |
| `GET /healthz` | `ok` |

`json` is the planner JSON as uploaded, `text` the parsed text-export rows (or `null`).

Login-protected: `GET /` (page), `POST /upload` (multipart fields `team`, `json`, `text`) and
`POST /delete` (form field `slug`). Cross-site posts are refused.

Upload from the command line:

```sh
curl -u captain -F team= -F json=@plan.json -F text=@plan.txt https://ttt.mafl.net/upload
```

## Recordings

When the rider has switched it on, the mod uploads a recording of the session (one gzip file per
rider and session) after the recording has stopped, never during the ride. The captain downloads
them from the admin page for analysis.

- Endpoint: `POST /api/log/<slug>?session=<ms>&athlete=<zwiftId>` with the gzip file as the request
  body. It is open like the plan endpoints (CORS) and only works for a team that has a plan.
  `<slug>` is the team name lower-cased, runs of other characters turned into `-`, leading and
  trailing `-` dropped (`(Team A)` becomes `team-a`; the admin page's Download links contain it). Unlike `/api/plan/<team>`, this endpoint does not slugify: `Zone 23` gives `400`,
  `zone-23` works. `session` is the session start in ms (digits), `athlete` the Zwift ID (digits).
- The body must start with the gzip header; it is not unpacked or checked further and is stored as is.
- Uploading the same session and athlete again replaces that file, so anyone who knows the team slug,
  session id and athlete id can overwrite a recording. Accepted for the test stub.
- Results: `201` stored, `400` bad names or not gzip, `404` no plan for that team, `413` file larger
  than `LOG_MAX_FILE_MB`, `507` all recordings together would pass `LOG_MAX_TOTAL_MB`.
- Caps (environment variables): `LOG_MAX_FILE_MB` per file, default 20; `LOG_MAX_TOTAL_MB` for all
  recordings together, default 2000. Both are in `docker-compose.yml` and `.env.example` (and in the internal Swarm files).
- Files land in `DATA_DIR/logs/<slug>/<session>-<athlete>.jsonl.gz` (`/data/paceline/logs/...` in the
  Swarm stack).
- The captain logs in at `/`: each team lists its recordings with rider, session start and size.
  Download gives the `.jsonl.gz` file (`gunzip` it for the JSON lines); each file also has a delete
  button. Direct links: `GET /logs/<slug>/<file>` and `POST /logs/delete`, both behind the login.

Privacy: a recording holds power, draft, speed and position of the uploader and of the plan riders
the uploader saw. The mod drops heart rate (everyone's), cadence, the plan's weight and FTP, and
any watched rider outside the plan before sending. Anyone who knows a
team name can upload (not read) recordings, so keep an eye on the total size, and delete files you
no longer need.

## Tests

From the repo root: `node --test server/tests/server.test.mjs`. It starts the server in-process on a
random port with a temporary data directory.
