# Co-Host Pro PMS

Property-management application for Co-Host Pro. Some internal folders still use the older names YallaPMS and yallastay.

This repository is the application source. The marketing site is a separate project.

## Install

Use Node.js 24 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the API on port 3001 and the web app on port 5173 unless `API_PORT` and `WEB_PORT` are set. The copy on Clifford's Mac runs the API on port 3002 and the web app on port 5174.

The first local start creates an empty database. Register the first administrator in the app, and leave the terminal open while you use it.

## Live data

Guest records, finances, iCal links, and environment secrets stay on the Mac. This repository does not contain them.
