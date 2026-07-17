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

## Moving to a different domain later

Add the domain to your Cloudflare account, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\win\setup-named-tunnel.ps1 -Hostname beni.newdomain.com
```

Reuses the same tunnel, only re-points DNS + rewrites `beni-config.yml`.

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
