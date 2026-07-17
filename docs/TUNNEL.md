# Phone access via Cloudflare Tunnel

Goal: `https://beni.yourdomain.com` → your PC's `localhost:3001`, so the PWA installs once on your phone and auto-updates forever.

## 0. Before exposing anything

Open the app → Settings → set an **Access key**. Everything behind the tunnel then requires it (90-day cookie after login).

## 1. Named tunnel (stable URL — recommended)

Prereqs: free Cloudflare account, your domain added to it (nameservers pointed at Cloudflare).

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login                 # opens browser, pick your domain
cloudflared tunnel create beni
cloudflared tunnel route dns beni beni.yourdomain.com
```

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: beni
credentials-file: C:\Users\USER\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: beni.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

Run it:

```powershell
cloudflared tunnel run beni
```

Auto-start both server and tunnel at boot (optional):

```powershell
cloudflared service install     # tunnel as a Windows service
# and for the app, Task Scheduler → run `npm start` in C:\.Beni at logon
```

## 2. Quick tunnel (zero setup, throwaway URL)

```powershell
npm run tunnel:quick
```

Prints a random `https://….trycloudflare.com` URL. Works instantly, but the URL changes every
restart — fine for testing, wrong for installing the PWA.

## 3. Install on your phone

Open `https://beni.yourdomain.com` → log in with your access key →
- **Android/Chrome**: ⋮ → *Add to Home screen* → *Install*
- **iOS/Safari**: Share → *Add to Home Screen*

It launches fullscreen with her face as the icon. Updates ship automatically: rebuild on the PC
(`npm run build`), and the service worker picks it up on the phone's next open.

## Notes

- Streaming (SSE) works through Cloudflare tunnels out of the box.
- The tunnel exposes only port 3001. Your model server (KoboldCpp on 5001) stays private.
- If you ever rotate the access key, phones just re-login once.
