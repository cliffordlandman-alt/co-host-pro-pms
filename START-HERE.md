# YallaPMS — current project

## Start on your computer

1. Extract this ZIP.
2. Install Node.js 24 and pnpm 11.
3. Open a terminal in the extracted YallaPMS folder.
4. Run `pnpm install --frozen-lockfile`.
5. Run `pnpm dev`.
6. Open http://127.0.0.1:5173 in your browser.

The first local start creates a fresh database. Register the initial administrator through the app. Keep the terminal open while using the app.

## What is included

Current application source, database migrations, public property photographs, configuration, and workflow tests. See docs/production-audit.md for the implementation handoff and known limitations.

This is a source package, not a backup of the live business database. Guest records, financial records, passwords, environment secrets, local backups, captured Airbnb exports, and installed dependencies are excluded. Public property photographs alone do not restore property records.

## Hostinger

Do not simply extract this ZIP into public_html: it requires a Node.js server, a configured PostgreSQL database, environment settings, and frontend deployment configuration. The current API does not serve the frontend build automatically. No public website or database has been provisioned by creating this ZIP.

## Current limits

Live channel synchronization and external automatic message delivery are not complete. Historical booking totals that were not supplied by Airbnb remain unverified. Review the handoff before operating or deploying the system.

Existing development builds and focused workflow tests passed during the working session. A fresh installation from this archive has not been tested.
