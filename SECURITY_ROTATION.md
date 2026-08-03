# Security Rotation Runbook

Two secrets were committed to this repository from the initial commit until the
secrets-externalization cleanup, and remain in **git history**:

1. **Kindle root password** — was hardcoded in `generate-and-test.sh`,
   `deploy-kual.sh`, `test-layouts.sh`, and `server/device-stats.js`.
2. **Private iCloud published-calendar URL** (the URL embeds an auth token) —
   was hardcoded in `server/calendar-service.js`.

Scrubbing the files (done) does not un-leak them. Treat both values as
compromised and rotate them.

## 1. Rotate the Kindle root password (do this now)

```sh
# SSH to the Kindle (via the Pi jump host if direct SSH fails)
ssh root@192.168.50.104
passwd    # set a new root password
```

Then make the new password available where it's needed:

- **Dev machine**: `export KINDLE_PASSWORD='...'` in your shell profile
  (or a local untracked `.env` you source). Needed for
  `./generate-and-test.sh --deploy` and `./deploy-kindle.sh`.
- Consider switching to SSH key auth on the Kindle so no password is needed
  at all (USBNetwork/jailbreak supports `/mnt/us/usbnet/etc/authorized_keys`).

## 2. Regenerate the iCloud calendar URL (do this now)

The published-calendar URL contains a capability token — anyone with the old
URL can read the calendar.

1. In iCloud Calendar (or Calendar.app), turn **off** "Public Calendar" for the
   shared calendar, then turn it back **on**. This mints a new URL.
2. Put the new URL in `server/.env` on the Pi:
   ```
   CALENDAR_URL=https://pXX-caldav.icloud.com/published/2/<new-token>
   ```
3. Restart the service: `sudo systemctl restart kindle-dashboard`.

The systemd unit already loads `server/.env` via `EnvironmentFile`
(see `pi/setup-auto-deploy.sh`).

## 3. Optional: purge the old values from git history

Rotation makes the leaked values worthless, so this is optional hygiene.
If you want the strings gone from history (e.g. before making the repo more
widely visible):

```sh
# One-time install
pip install git-filter-repo

# Work on a fresh clone — filter-repo refuses dirty/partial clones
git clone git@github.com:breedy231/e_ink_screen.git eink-rewrite
cd eink-rewrite

# Replace the secret strings everywhere in history
cat > /tmp/replacements.txt <<'EOF'
Eragon23129==>***REMOVED***
regex:https://p131-caldav\.icloud\.com/published/2/[A-Za-z0-9_-]+==>***REMOVED***
EOF
git filter-repo --replace-text /tmp/replacements.txt

# Force-push the rewritten history
git remote add origin git@github.com:breedy231/e_ink_screen.git
git push --force --all origin
git push --force --tags origin
```

**Caveats:**
- Every existing clone (including the Pi's, if it pulls this repo) must be
  re-cloned afterward — old commits will diverge permanently.
- Open PR branches are invalidated; merge or close them first.
- GitHub may retain unreachable objects for a while; contact GitHub support to
  clear cached views, or simply rely on rotation having made the values dead.
- A cheaper alternative: keep the repo **private** and skip the rewrite.

## 4. Guardrails now in place

- `scripts/validate.sh` greps every tracked file for known secret patterns and
  fails the build if any reappear.
- `.gitignore` covers `.env`, `server/.env`, `*.pem`, `*.key`,
  `kindle/config/*password*`.
- All scripts read credentials from the environment and fail loudly when a
  needed credential is unset.
