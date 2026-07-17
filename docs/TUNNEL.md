# Phone access via Cloudflare Tunnel

**Live: `https://beni.quert.site`** → this PC's `localhost:3001`. Named tunnel `beni`
(id `8ba48a4e-5eed-4bc2-a51c-1e66c368084d`) on the quert.site zone (cut over from
beni.revelator.site on 2026-07-17). The quert.site apex + `www` stay on Vercel (portfolio,
DNS-only records); mail keeps its Namecheap eforward MX records — **test @quert.site
forwarding once**; if it broke off Namecheap DNS, Cloudflare Email Routing (dashboard →
Email, free) is the drop-in replacement.

## How it runs

- **`start-tunnel.bat`** (or the `start-all.bat` bundle) serves the permanent URL.
- Its config lives in **`%USERPROFILE%\.cloudflared\beni-config.yml`** — deliberately a separate
  file. `config.yml` in the same folder belongs to the **Revelator** tunnel; neither project
  touches the other's file.
- `cert.pem` is now scoped to the quert.site zone (login 2026-07-17). The old revelator-scoped
  cert is `cert-backup-revelator-20260717.pem` — swap back (or re-login) only if Revelator ever
  needs new DNS routes; running tunnels don't need cert.pem at all.
- Access key required for everything under `/api` (90-day cookie after login). Set/rotate it in
  Settings; phones just re-login once after a rotation.

## Dashboard leftovers (delete whenever, both in revelator.site → DNS)

- CNAME `beni` (old beni.revelator.site route — retired, serves 404)
- CNAME `quert.site.revelator.site` (junk from a mis-scoped route attempt)

## Install on your phone

Open `https://beni.quert.site` → log in with your access key →
- **Android/Chrome**: ⋮ → *Add to Home screen* → *Install*
- **iOS/Safari**: Share → *Add to Home Screen*

Launches fullscreen with her face as the icon. Updates ship automatically: rebuild on the PC
(`npm run build`), and the service worker picks it up on the phone's next open.
(Phones that installed from the old beni.revelator.site URL: remove that icon and reinstall
from the new URL once — different origin, the old install can't be migrated.)

## Optional: survive reboots

`tools\cloudflared.exe service install` as admin installs the tunnel as a Windows service, plus
Task Scheduler → `start-all.bat` at logon for the app + model.

## Moving domains again later

```powershell
powershell -ExecutionPolicy Bypass -File scripts\win\setup-named-tunnel.ps1 -Hostname beni.newdomain.com -Relogin
```

`-Relogin` backs up the current cert and opens the browser once to authorize the new zone.

## Gotchas that cost real time once

- `cloudflared` **auto-loads `%USERPROFILE%\.cloudflared\config.yml`** for any command without
  `--config`. On this machine that file defines the Revelator tunnel, so bare commands get
  hijacked (quick tunnels 404 via foreign ingress; `tunnel route dns` once pointed our CNAME at
  the wrong tunnel). Rule: every Beni cloudflared command passes `--config beni-config.yml`.
- `tunnel route dns` with a hostname outside the cert's zone doesn't fail — it silently
  **appends the hostname to the cert's zone** (that's where the junk CNAME came from). Route
  with the raw tunnel UUID + `--overwrite-dns`, and read the output's zone/tunnelID.
- Proxying (orange cloud) only turns on when a zone reaches **Active**; pending zones serve
  DNS-only, so tunnel hostnames 000/fail until activation even though DNS already resolves.

## Notes

- Streaming (SSE) works through Cloudflare tunnels out of the box.
- The tunnel exposes only port 3001. The model server (KoboldCpp on 5001) stays private.
- A quick throwaway tunnel is still available anytime: `npm run tunnel:quick`
  (random `https://….trycloudflare.com` URL, changes every restart).
