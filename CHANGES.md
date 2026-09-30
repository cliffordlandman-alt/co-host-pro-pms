# YallaPMS changes (30 September 2026, Dubai time)

One entry per commit, oldest first. Every change was checked with the full build, all automated tests,
the smoke test and the end-to-end booking to owner statement check (guest total AED 3,300 gives an owner
payout of AED 1,805.71).

## Getting started
- **e50847f Baseline.** The code exactly as received, so every later change can be seen and undone.
- **f57d70a Install fix.** A leftover reference in the package list stopped installation; removed.
- **b727e82 Build checks.** The whole project now passes its type check, and an end-to-end booking to owner statement check was added.
- **2332760 Tidy-up.** Generated build files are no longer stored in version control.

## Earlier fixes
- **c0a0c4e Channel calendar sync.** Stops duplicate bookings, invented guest names and silent drift when Airbnb, Booking.com or Vrbo calendars sync.
- **dd95de6 Payments.** When a booking's balance changes, a matching payment or reversal is recorded, so payments always add up.
- **a559b7f Reports.** Channel and profit-and-loss revenue only count verified booking amounts, kept separate per currency.
- **1f39c7d Dubai dates.** Payments, statements, reports and the dashboard use the Dubai calendar day.
- **d2aa86f Safe deletes.** Properties, owners and staff that have history cannot be deleted; owner and staff edits are checked.
- **9107818 Password reset.** Administrators can reset a staff member's password.
- **cd45bb7 Speed.** Database indexes for date and property lookups.
- **23c469f Staff login.** Cleaners and maintenance staff are matched to their profile whatever the capitalisation of their email.
- **2275ab6 Calendar.** Channels are shown in distinct colours; blocked dates are shown as blocks and do not count as occupancy.
- **bb88bbd Cleaning board.** The fake "Mark Done" button was replaced with real assign, complete and approve steps.
- **9eaeb38 No fake buttons.** Call, Email and Lock Price buttons that did nothing were removed; real phone and email links are used.
- **511822e Calendar colours.** Vrbo is purple so it cannot be confused with Booking.com blue.

## This round
- **52de840 Rates come from the server.** A booking's management %, channel fee, VAT and tourism fee always come from the property's fee settings, never from the browser. Verified bookings keep the rates they were saved with unless you tick "Re-apply current fee settings". Vrbo has its own channel fee.
- **e599185 Cleaning costs.** The cleaning fee on a booking is company income. The cleaning company's charge is a company expense: one per checkout clean, at the rate card price for the unit size (Studio 140, 1BR 180, 2BR 250, 3BR 290, 4BR 350 AED), or at a property's own override. It is recorded once, when the clean is first marked completed or approved. The company statement shows cleaning income against cleaning cost. A backfill (in Fee settings, or as a command) records costs for past checkouts, with a preview first. It never creates duplicates. The owner is not charged for the cleaning company.
- **c09738a Label.** Automatic cleaning costs show as "Cleaning (automatic)" on the company statement.
- **c71f643 One place for fees.** Each property's management % and cleaning fee now live only in its fee settings. The property screen, the add-property form and bulk import all edit that same record. Existing values were moved across unchanged. Settings → Property Defaults are only starting values for new properties. The duplicate management fee field in Financial Defaults was removed.
- **3d72577 One owner statement per property per month.** A second statement can no longer be created. If the database already holds duplicates, nothing is deleted. They are listed in a warning on the Owner Statements tab and cannot be sent or paid until resolved.
- **1cc8e6a Cleaning cost scope and Airbnb reservations import.** Each property is either on the cleaning company's rate card (Dubai units by default), has its own override in its own currency (for example ZAR), or has "no rate set". Properties with no rate set are skipped and flagged, never guessed. The backfill can run for a calendar month. Past checkouts that have no cleaning task (such as imported Airbnb history) are costed once per booking. The Airbnb import now also accepts Airbnb's Reservations export. Cancelled stays are kept as cancelled, Airbnb's "Earnings" is stored as expected earnings, and the bookings stay marked unverified until the guest total and fees are entered.
- **cd1c99f Wording.** Clearer "no rate set" messages in the preview, the command and notifications.
- **This file.** Plain-language change list. Private channel data folders are excluded from version control.
