# Operational readiness — focused session

Scope: existing single-operator application, preserving YallaStay UI. Synced references and imported source data stay unchanged.

## P0
- [x] Gate all business APIs; restrict account creation and role changes; owner data isolation.
- [x] Finish inclusive reservation finance; validate dates, amounts and overlaps; synchronize checkout cleaning.
- [x] Correct owner statements: no double VAT, no repeated cross-month bookings, saved fee snapshots, locked paid statements.
- [x] Fix broken pricing API path and dashboard occupancy/month bounds.
- [x] Build and isolated operational/security regression test; preserve imported data.

## P1
- [x] Property fee defaults, channel deductions, guest contacts/ID verification state.
- [x] Cleaning proof and completion; maintenance approval and expense allocation.
- [x] Action centre for unpaid bookings, guest ID, cleaning, maintenance, owner payouts.
- [x] Desktop/mobile walkthrough and key dead controls repaired; exhaustive every-button coverage remains outstanding.

## Remaining launch requirements
- Live channel connectivity, cancellation/reconciliation and full booking totals are not established by importing co-host earnings.
- Tenant isolation is not implemented; this database is one operator. Public subscriber onboarding must remain closed.
- Production database, backups/restore exercise, HTTPS, email delivery and secure document storage need deployment configuration.
- Full guest passport vault, signed contracts and automated external messaging require further verification.
- Cosmetic redesign deferred.

Audit evidence: API route inventory (all modules), schema inventory, page/control static scan. Runtime coverage recorded after tests; static inspection is not a claim that every button has been exercised.

## Verification completed (2026-09-30)
- API and frontend production bundles build. Frontend TypeScript check passes.
- scripts/smoke-test.mjs passes against a disposable database: sample owner/property, inclusive booking, fees, date/overlap rejection, ID/contact edits, partial/full payments, checkout task creation/reschedule/cancel, cleaning proof, maintenance approval, monthly recognition, statement locks and idempotent payout recording.
- Access tests cover anonymous denial, reservations-role denial of finance/admin, and owner isolation. Cleaner/maintenance scope is implemented; a complete adversarial security review is still required before internet deployment.
- Live desktop page walkthrough: properties, calendars, reservations, reports, platforms, pricing, inbox, reviews, documents, automations, settings, staff, owners, accounting. No new console errors in the final walkthrough.
- Mobile checks at 390×844: booking form, dashboard, owner/staff/payment/guest/task/cleaning/maintenance/accounting pages. Fixed bottom navigation overflow and wrapping finance tabs.
- Imported source data remains visible: 73 Airbnb bookings, 79 earnings entries, USD 10,358.99 paid settlements. Existing operator-entered bookings preserved. Future missing checkout tasks backfilled.
- Local database backup: .local-backups/pre-readiness-20260929-190203 (private). A tested off-device restore process is still required.

## Targeted next batch
P0 before sole operational use: reconcile full booking totals and currency handling across legacy reports; add a controlled financial-correction workflow for imported/legacy bookings; harden authentication concurrency and remaining write validation; complete regression coverage for every mutable control. Do not treat metadata-only documents, manual message notes or configured automation rules as connected external services.
P1: secure passport/contract storage and retention, owner email delivery/recovery, reconciliation/cancellations across channels, tenant isolation and deployment/restore testing. Never onboard separate subscribers into this shared operator database.

Final mobile accounting check: 390px viewport, 390px document width, wrapped tabs, five-item bottom navigation, no console errors in the fresh test tab. Temporary viewport and tab cleaned up.


## Connected PMS handoff — 2026-09-30 (usage stop at 4% remaining)
- Live URL: http://127.0.0.1:5173. Local API port 3001; current dev session 27804.
- Shared reservation financial projection links imported earnings by exact confirmation code/property. Unknown gross amounts remain null; co-host shares never become gross guest revenue. Existing imported records are linked on read without destructive rewriting.
- Reservation list/detail/calendar, property cards and payment balances now use linked financial facts. Dashboard/report aggregate calculations use shared verified totals. All successful API writes invalidate dependent queries.
- Added financial verification/editor; no unverified gross totals or management rates guessed for old bookings.
- Draft owner statements refresh from current source records; publication validates again; published financial fields and posted owner expenses protected. Currency-aware owner/transaction summaries. Company maintenance expenses flow into company statements; manual entries optionally link reservations.
- 18 editable message templates, company/property overrides, property variables, configurable trigger offsets and dynamic booking-linked draft queue. Missing fields and cancelled stays blocked. No outbound delivery is connected; rules default off. No message sent.
- Tests passed: frontend typecheck/build, API build, reservation financial model, company statement model, automation rendering/scheduling, expanded isolated operational suite including import linking, draft statement refresh, payment balances, owner isolation, cancellation, template migration and schedules.
- Live UI verified: imported Airbnb amounts displayed correctly, Kariem's recorded AED 7,500 retained (breakdown unverified), 18 templates and scheduling controls loaded, mobile width 390 without horizontal overflow. No new browser errors in checked views.
- Backup: .local-backups/pre-connected-pms-20260930 (pre-migration); earlier finance backups retained. No git repository; changes saved directly to existing project.
- Remaining: full financial verification/allocation for legacy bookings; actual external channel sync and automated sending; complete every-button/runtime audit; persistent execution/delivery history and retry worker for external automations; tenant isolation; secure documents/contracts; production hosting, HTTPS, backups/restore and email configuration. No deployment configuration discovered; do not expose the local development server publicly.
- Templates preparation is a derived schedule, not a background external delivery worker. Existing operational rules remain explicitly disconnected.
