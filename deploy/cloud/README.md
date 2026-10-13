# Put LaunchRiot for Holiday Homes online for $0 (Oracle Cloud Always Free)

What runs: one Oracle "Always Free" Arm VM (Ubuntu 24.04) with Docker: Postgres 17 + the API + Caddy (automatic HTTPS).
Nothing sleeps. Outgoing guest/owner messages stay OFF (OUTBOUND_DELIVERY=off).

## You do (about 1 hour)
1. Sign up at oracle.com/cloud/free. Needs: email, mobile number, and a debit/credit card **for identity only**
   (a temporary authorization hold of about $1 may appear and is released; no charge unless you click "Upgrade").
   Home region: **UAE East (Dubai)** (keeps guest data in the UAE). It cannot be changed later.
2. Create the VM: Compute → Instances → Create. Image **Canonical Ubuntu 24.04**, shape **VM.Standard.A1.Flex, 1 OCPU, 6 GB**
   (shows "Always Free-eligible"). Download the SSH key it offers. If it says "Out of capacity", try again later or another
   availability domain; this is common and costs nothing.
3. Open the web ports: the VM's subnet → Security list → add Ingress rules TCP 80 and TCP 443 from 0.0.0.0/0.
4. On the Mac run `zsh ~/YallaPMS-backups/mac-export-data.sh` (stops the app ~1 min,
   makes one private data file in ~/YallaPMS-backups).
5. Copy the code package and the data file to the VM:
   `scp -i key.pem launchriot-src-*.tgz launchriot-data-*.tgz* ubuntu@<VM-IP>:`
6. On the VM: `mkdir launchriot && tar xzf launchriot-src-*.tgz -C launchriot && cd launchriot && bash deploy/cloud/server-setup.sh`
   (press Enter for the free `<ip>.sslip.io` address), then log out and in once, then
   `bash deploy/cloud/restore-mac-data.sh ~/launchriot-data-*.tgz`.
7. Open the https address, sign in with your usual login, check bookings and September/October figures.
8. Backups: `crontab -e` and add the line from `deploy/cloud/backup.sh`. Copy a backup to your Mac now and then.
9. After a week of using the online copy, stop the Mac copy (keep its folder as a backup). Then paste the new
   https calendar links into Airbnb/Booking.com/Vrbo (Calendar sync page).

## Catches
- Card required for verification (no charge). Account must stay in use: Oracle may close accounts idle 30+ days.
- Idle VMs can be reclaimed if CPU, network AND memory all stay under 20% for 7 days. 1 OCPU / 6 GB keeps memory share
  higher; if Oracle ever emails about reclaim, reply/act within the notice. Nightly backups guard against losing data.
- Arm "Out of capacity" in popular regions is common: retry.
- sslip.io is a free public naming service; for a nicer address later, buy a domain (optional, ~$10/yr) and set SITE_DOMAIN.
