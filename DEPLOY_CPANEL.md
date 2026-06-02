# Deploy server_bun on cPanel (CloudLinux Node.js)

## Node modules location

CloudLinux stores `node_modules` in a virtualenv (symlink). **Do not** keep a real `node_modules` folder in the app root — remove it before `npm install` in the venv:

```bash
rm -rf node_modules package-lock.json
source /home/carsure/nodevenv/backEnd/20/bin/activate
npm install
```

## Environment variables (required)

In cPanel → Node.js app → **Environment variables**, set at least:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `REDIS_ENABLED` | `false` (unless you run Redis on the host) |
| `PORT` | (set by cPanel) |
| `MONGODB_URI` | your Mongo connection string |
| … | other vars from `.env` |

If `NODE_ENV` is missing, the app still starts (no `pino-pretty`), but set `production` for correct security and log levels.

## Build and start

On the server (after uploading source):

```bash
source /home/carsure/nodevenv/backEnd/20/bin/activate
cd ~/backEnd
npm run build:cpanel
npm run start:cpanel
```

Or set **Application startup file** / start command to `npm run start:cpanel` with `NODE_ENV=production`.

## pino-pretty error

`unable to determine transport target for "pino-pretty"` happens when:

- `NODE_ENV` was treated as development (old code defaulted unset → development), and
- `pino-pretty` is not installed in the production venv (devDependency).

**Fix:** pull latest `utils/logger.ts`, rebuild `dist`, set `NODE_ENV=production`. Pretty logs are only used when `NODE_ENV=development` explicitly.

## Local development

In `.env` add:

```
NODE_ENV=development
```

Then `npm run dev` / `bun --watch` gets readable logs via `pino-pretty`.
