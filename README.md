# Astro Bookshop - Docker Learning Project

Small Astro bookstore project built to practise Docker development and production workflows.

## Development

Start with Docker Compose Watch:

```bash
docker compose -f compose.dev.yaml up --watch
```

Open:

http://localhost:4321

Stop development:

```bash
docker compose -f compose.dev.yaml down
```

## Production

Build and start:

```bash
docker compose up -d --build
```

Open:

http://localhost:8080

## Check container

```bash
docker compose ps
```

## View logs

```bash
docker compose logs --tail 100 bookshop
```

## Health check

```bash
curl.exe http://localhost:8080/health.txt
```

Expected response:

```text
ok
```

## Stop production

```bash
docker compose down
```

## Clean rebuild

```bash
docker compose down
docker image rm astro-bookshop:1.0
docker compose up -d --build
```

## Docker concepts practised

- Development containers
- Docker Compose
- Compose Watch
- Port mapping
- Build caching
- Multi-stage builds
- Nginx production runtime
- Health checks
- Image inspection
- Container logs
- Clean reproducible builds
