# Phone access via Cloudflare Tunnel

**Live now: `https://beni.revelator.site`** → this PC's `localhost:3001`. Named tunnel `beni`
(id `8ba48a4e-5eed-4bc2-a51c-1e66c368084d`), reusing the Cloudflare login you already had for
revelator.site — no new domain needed.

## How it runs

- **`start-tunnel.bat`** (or the `start-all.bat` bundle) serves the permanent URL.
- Its config lives in **`%USERPROFILE%\.cloudflared\beni-config.yml`** — deliberately a separate
  file. `config.yml` in the same folder belongs to the **Revelator** tunnel; neither project
  touches the other's file.
- Access key required for everything under `/api` (90-day cookie after login). Set/rotate it in
  Settings; phones just re-login once after a rotation.

## Install on your phone

Open `https://beni.revelator.site` → log in with your access key →
- **Android/Chrome**: ⋮ → *Add to Home screen* → *Install*
- **iOS/Safari**: Share → *Add to Home Screen*

Launches fullscreen with her face as the icon. Updates ship automatically: rebuild on the PC
(`npm run build`), and the service worker picks it up on the phone's next open.

## Optional: survive reboots

`tools\cloudflared.exe service install` as admin installs the tunnel as a Windows service, plus
Task Scheduler → `start-all.bat` at logon for the app + model.

## Moving to beni.quert.site (planned 2026-07-17)

quert.site stays the Vercel portfolio — Beni takes **only the `beni` subdomain**. The
apex A (76.76.21.21) and `www` CNAME (Vercel) are never touched.

1. **Cloudflare** → finish *Add a domain* for quert.site (Continue to activation, keep
   the imported records). Recommended: flip the two Vercel records (A apex + CNAME www)
   to **DNS only** (gray cloud) — that reproduces today's behavior 1:1; proxied-orange in
   front of Vercel works only with SSL mode Full (strict) and buys nothing for a portfolio.
2. **Namecheap** → quert.site → *Nameservers: Custom DNS* → the two `*.ns.cloudflare.com`
   names Cloudflare shows → wait for the "site active" email.
   ⚠ The `eforward*` MX records are Namecheap email forwarding, which officially requires
   Namecheap DNS. If @quert.site mail forwarding matters, test it after the switch —
   Cloudflare **Email Routing** (free, dashboard → Email) is the drop-in replacement.
3. One command (opens browser once — pick quert.site):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\win\setup-named-tunnel.ps1 -Hostname beni.quert.site -Relogin
```

It backs up the revelator-scoped cert, logs in for the new zone, routes the subdomain,
rewrites `beni-config.yml`, and restarts the tunnel. Old URL beni.revelator.site works
until step 3, then serves 404 — afterwards delete its DNS record plus the junk
`quert.site.revelator.site` CNAME (dashboard → revelator.site → DNS).

⚠ Phones with the PWA installed on the old URL must reinstall from the new one (new origin).

## Gotcha worth remembering (cost an hour once)

`cloudflared` **auto-loads `%USERPROFILE%\.cloudflared\config.yml`** for any command that doesn't
pass `--config`. On this machine that file defines the Revelator tunnel, so bare commands get
hijacked: quick tunnels answer 404 from Revelator's ingress catchall, and `tunnel route dns` once
pointed our CNAME at the wrong tunnel. Rule: **every Beni cloudflared command passes
`--config beni-config.yml`**, and DNS routing uses the raw tunnel UUID + `--overwrite-dns`.

## Notes

- Streaming (SSE) works through Cloudflare tunnels out of the box.
- The tunnel exposes only port 3001. The model server (KoboldCpp on 5001) stays private.
- A quick throwaway tunnel is still available anytime: `npm run tunnel:quick`
  (random `https://….trycloudflare.com` URL, changes every restart).
