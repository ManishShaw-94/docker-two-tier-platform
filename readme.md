# Docker Containerised Two-Tier Web Platform

A working reference implementation of a **Multi-container web platform** where a Node.js presentation tier and a Python API tier are built, networked, configured and operated entirely through Docker Compose.

The problem this repository solves is not "how do I write a web app" — it is the one that actually
breaks deployments: **how do independently built services find each other, stay configurable across
environments, and remain reproducible on any machine.** This repository is the smallest complete answer to that
question that still exercises every moving part.

---

## The Case

A typical delivery team ends up with two services owned by two different skill sets:

* a **frontend** team shipping Node.js/Express with server-side rendering, and
* a **backend** team shipping a Python HTTP API.

They run fine on a developer laptop and fall over the moment they leave it. The recurring failures are
always the same four:

| Failure in the wild | What causes it | How it is solved here |
| --- | --- | --- |
| `ECONNREFUSED 127.0.0.1:8000` once containerised | `localhost` inside a container is the *container itself*, not the host or a sibling service | Services join a user-defined bridge network and address each other by **DNS hostname** (`backend-host`), never by loopback |
| Endpoint changes require a code change and redeploy | Upstream URL hardcoded in source | Upstream is injected as the **`BACKEND_URL` environment variable**, with a safe local-development fallback baked into the code |
| "Works on my machine" drift | Python/Node versions and transitive dependencies differ per developer | Each tier pins its **own base image and dependency manifest**; the image *is* the environment |
| Frontend boots before the API exists | No declared start ordering | `depends_on` establishes **startup ordering** in the dependency graph |

Everything below is that solution, in code.

---

## Architecture

```
                  host :3000                         host :8000
                       |                                  |
+----------------------|----------------------------------|---------------------+
|  Compose-managed user-defined bridge network            |                     |
|                      |                                  |                     |
|         +------------v------------+        +------------v------------+        |
|         |  frontend-host          |        |  backend-host           |        |
|         |  node:18-alpine         |        |  python:3.8-slim-buster |        |
|         |  Express 5 + EJS        | -----> |  Flask                  |        |
|         |  listens :3000          |  HTTP  |  listens :8000          |        |
|         |                         |  GET   |                         |        |
|         |  BACKEND_URL=           |  /api  |  GET /      health ping |        |
|         |   http://backend-host   |        |  GET /api   JSON data   |        |
|         |        :8000/api        |        |                         |        |
|         +-------------------------+        +------------+------------+        |
|                                                         |                     |
+---------------------------------------------------------|---------------------+
                                                          |
                                                   names.txt (data source)
```

**Service discovery is the centrepiece.** Compose registers each service in the embedded DNS resolver
under its `hostname`. The frontend resolves `backend-host` to the backend container's current IP on
every request, so the API can be rebuilt, restarted or rescheduled onto a new address without the
frontend knowing or caring.

---

## Request Lifecycle

1. A browser requests `GET http://localhost:3000/`.
2. Express resolves `process.env.BACKEND_URL` — supplied by Compose as
   `http://backend-host:8000/api`. If the variable is absent (bare `node app.js` outside Docker), it
   falls back to `http://localhost:8000/api`, so the same source runs in both contexts.
3. Docker's embedded DNS resolves `backend-host` to the backend container on the shared bridge network.
4. Flask's `/api` handler calls `get_data()`, which reads `names.txt` and returns a JSON payload
   `{"data1": [...]}`.
5. Express passes that payload straight into the EJS view, which renders it server-side.
6. On any upstream failure the frontend returns **HTTP 500** with a JSON error body rather than
   leaking a stack trace or hanging the request.

---

## Tech Stack

| Tier | Runtime | Framework | Base image | Port |
| --- | --- | --- | --- | --- |
| Presentation | Node.js 18 | Express 5, EJS 5, node-fetch 3 | `node:18-alpine` | 3000 |
| API | Python 3.8 | Flask | `python:3.8-slim-buster` | 8000 |
| Orchestration | Docker Compose file format 3.6 | — | — | — |

Alpine and slim base images are deliberate: they keep the attack surface and image size down compared
with the full-fat distributions.

---

## Repository Layout

```
.
├── docker-compose.yml          # Service topology, network, port and env wiring
├── backend/
│   ├── Dockerfile-backend      # Python image: deps layer, then source layer
│   ├── app.py                  # Flask routes: / (health) and /api (data)
│   ├── business.py             # Domain logic, isolated from the transport layer
│   ├── names.txt               # Data source
│   └── requirements.txt        # Dependency manifest
└── frontend/
    ├── Dockerfile-frontend     # Node image
    ├── .dockerignore           # Keeps host node_modules out of the build context
    ├── app.js                  # Express server, env-driven upstream, error handling
    ├── package.json            # Dependency manifest
    ├── views/index.ejs         # Server-rendered template
    └── public/index.html       # Static fallback page
```

Two deliberate separations are worth calling out:

* **`business.py` is not `app.py`.** Domain logic has no knowledge of Flask, so it can be unit tested,
  reused or moved behind a different transport without rewriting it.
* **Each service owns its own Dockerfile and build context.** Neither tier can accidentally take a
  build dependency on the other, which keeps the services independently releasable.

---

## Quick Start

**Prerequisites:** Docker Engine 20.10+ and Docker Compose v2 (`docker compose`) or v1
(`docker-compose`). No local Node.js or Python installation is required.

```bash
git clone <your-repository-url>
cd <repository-directory>

# Build both images and start the platform
docker compose up --build

# Or run detached
docker compose up --build -d
```

| Surface | URL |
| --- | --- |
| Web application | http://localhost:3000 |
| API — data endpoint | http://localhost:8000/api |
| API — health ping | http://localhost:8000 |

Tear down:

```bash
docker compose down            # stop and remove containers + network
docker compose down --rmi all  # also remove the built images
```

---

## Configuration

| Variable | Service | Value in Compose | Fallback in code | Purpose |
| --- | --- | --- | --- | --- |
| `BACKEND_URL` | frontend | `http://backend-host:8000/api` | `http://localhost:8000/api` | Upstream API endpoint |

Precedence is **Compose environment → Dockerfile `ENV` → in-code default**. The Compose value wins at
runtime, which is exactly what lets the same image be promoted unchanged across dev, staging and
production — you re-point the variable, you don't rebuild the artefact.

To target a different API — a shared staging instance, for example — override it without editing a
single file:

```bash
BACKEND_URL=https://api.staging.internal/api docker compose up
```

---

## Verification

After `docker compose up`, confirm each layer independently rather than trusting the browser alone.

```bash
# 1. Both containers are up and the ports are published
docker compose ps

# 2. The API answers directly from the host
curl http://localhost:8000/api

# 3. The frontend renders the API payload server-side
curl http://localhost:3000

# 4. Service discovery works container-to-container (the real test)
docker compose exec frontend wget -qO- http://backend-host:8000/api
```

Step 4 is the one that matters. If steps 2 and 3 pass but step 4 fails, the problem is the network or
DNS, not the application code.

---

## Operations Runbook

```bash
# Follow logs for all services, or one
docker compose logs -f
docker compose logs -f backend

# Rebuild after a dependency manifest change
docker compose up --build

# Restart a single tier without disturbing the other
docker compose restart backend

# Open a shell inside a running container
docker compose exec backend sh
docker compose exec frontend sh

# Show which network each container is attached to
docker inspect -f '{{.Name}} {{json .NetworkSettings.Networks}}' $(docker compose ps -q)

# Confirm the frontend can resolve the backend by hostname
docker compose exec frontend nslookup backend-host
```

### Troubleshooting

| Symptom | Diagnosis | Fix |
| --- | --- | --- |
| Frontend returns `{"msg":"Internal Server Error."}` | Backend unreachable or returned a non-JSON body | `docker compose logs backend`; confirm with verification step 4 |
| `ECONNREFUSED` referencing `127.0.0.1` | `BACKEND_URL` never reached the container, so the code fell back to localhost | `docker compose exec frontend printenv BACKEND_URL` |
| `getaddrinfo ENOTFOUND backend-host` | Services are not on the same network | Compare the network list from the runbook `docker inspect` command across both containers |
| Port already allocated on 3000/8000 | Another process holds the host port | Change the host side of the mapping in `docker-compose.yml` |
| Source edits not reflected | Dependency layer changed, or a stale image | `docker compose up --build` |

---

## Known Constraints and Hardening Roadmap

This repository is an honest reference architecture, not a production deployment. The gaps below are
known and deliberate — each is the natural next increment.

**Runtime**

* The backend runs Flask's built-in development server with `debug=True`. Production requires a WSGI
  server (Gunicorn or uWSGI) behind a reverse proxy, and debug mode off — the debugger is a remote
  code execution surface.
* Bind mounts (`./backend:/app1`, `./frontend:/app2`) give an instant edit-reload loop but overlay the
  image's own source. That is a development affordance; production images should be immutable, with
  the mounts removed.

**Orchestration**

* `depends_on` orders *startup*, not *readiness*. The frontend can issue its first request before Flask
  is accepting connections. Container healthchecks with `condition: service_healthy`, or retry with
  backoff in the client, close this gap.
* `links` in the Compose file is legacy and redundant once services share a user-defined network. It is
  retained only for backward compatibility and can be dropped.
* `version: '3.6'` is obsolete under Compose v2 and may emit a warning; the key can be removed.

**Supply chain**

* `requirements.txt` and `package.json` use unpinned or range versions. Exact pinning plus a committed
  lockfile is what makes a build genuinely reproducible six months from now.
* `python:3.8-slim-buster` is end-of-life. A supported base image (3.11+ on Bookworm) is the first
  security upgrade to make.
* Containers run as root. Add a non-root `USER` to both images.

**Data and delivery**

* `names.txt` stands in for a real datastore. Substituting a database service is an additive change to
  `docker-compose.yml` — the network and discovery model already accommodate it.
* Neither tier has automated tests or a CI pipeline. Build-test-scan on every push is the next step.
* No TLS termination, request logging, metrics or centralised log aggregation.

---

## What This Repository Demonstrates

* Multi-container orchestration with Docker Compose across two different language runtimes
* Container-to-container service discovery over a user-defined bridge network with DNS hostnames
* Environment-driven configuration that keeps one build artefact valid across every environment
* Layer-ordered Dockerfiles that cache dependency installation separately from source
* Separation of domain logic from transport, and of build contexts from each other
* Explicit upstream failure handling at the service boundary
* A verification path that isolates faults to a specific layer instead of guessing

---

## Author

**Manish Shaw** · [manish.shaw@powertechconsulting.com.au](mailto:manish.shaw@powertechconsulting.com.au)

Issues and pull requests are welcome.
