# Nodecast TV: hosting and playlist integration

Research only; no launcher or replacement player is installed. Reviewed upstream **v2.2.8**, commit **`aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7`**, on 2026-11-19. The hosting choice remains pending. The application is GPL-3.0-only; retain its license and corresponding source when distributing it. [Pinned package](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/package.json), [license](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/LICENSE).

## Recommended choice

Host actual Nodecast on an owner-operated HTTPS service and open it in a new browser tab from WebPC once its URL and operational owner are agreed. This preserves upstream authentication and playback. GitHub Pages cannot run its Node/FFmpeg backend. A browser-only alternative would be a different application and needs the user's explicit choice.

Embedding is conditional, not a verified capability: a same-site HTTPS deployment may work, but an independently hosted cross-site iframe conflicts with the shipped cookie policy. Changing only frame headers will not fix authentication. No deployment was started and no hosted instance's headers, login, or playback were tested.

## Actual frontend/backend boundary

- The frontend fetches root-relative `/api…` with `credentials: 'same-origin'` and redirects unauthorized users to `/login.html`. It has no configurable remote API base. Serve the complete app at its own origin root; copying `public/` into WebPC or mounting it under `/pc/apps/nodecast/` alone does not work. [API client, lines 9–38](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/public/js/api.js#L9).
- Sources, channels, favorites, history, settings, provider proxies, probing, subtitles, transcoding and remuxing depend on authenticated server routes. Source mutations require an administrator. Playback builds `/api/proxy/stream`, `/api/transcode` and `/api/remux` URLs; these are actual server operations. [Route registration, lines 181–212](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/index.js#L181), [player, lines 1085–1101](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/public/js/components/VideoPlayer.js#L1085).

## Iframe, HTTPS and session constraints

The pinned server and shipped frontend contain no `X-Frame-Options`, CSP `frame-ancestors`, frame-busting script or parent `postMessage` bridge. That source inspection does **not** establish the headers of a future reverse proxy. An iframe deployment must check the actual HTML/login responses, permit only the intended WebPC ancestor, and satisfy any parent `frame-src` policy. An HTTPS WebPC page also needs an HTTPS child.

Both authentication cookies and the OIDC session use `SameSite=Lax`; authentication cookies are HttpOnly and expire after 24 hours. Lax excludes cross-site iframe requests, so signing in in a separate tab does not make a cross-site embedded session reliable. `AUTH_COOKIE_SECURE=true` changes Secure, not SameSite. Browser third-party-cookie restrictions add another constraint. Same-site sibling HTTPS origins are a different case and require verification with the actual domain arrangement. [Auth cookie implementation, lines 399–408](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/auth.js#L399), [session options, lines 27–36](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/index.js#L27), [cookie behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value).

The API additionally rejects `Sec-Fetch-Site: cross-site` and mismatched Origin/Referer values, except its OIDC paths. `APP_ORIGIN` must be **Nodecast's external origin**, not WebPC's. Direct WebPC-to-Nodecast API calls are not an integration contract; the few media routes emitting permissive CORS headers do not bypass the earlier authentication/origin middleware. A complete framed app would normally call its own API, but still faces the cookie constraint above. [Origin check, lines 410–420](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/auth.js#L410).

OIDC would also need top-level login and provider-specific redirect/frame checks. There is no upstream WebPC focus, close or pause message API: a cached hidden cross-origin iframe could keep playing. An iframe implementation would need an explicit lifecycle solution; an external launcher avoids claiming shell-controlled playback.

## Pinned deployment recipe for a future host

The upstream release workflow publishes versioned amd64/arm64 images. Read-only GHCR manifest verification returned HTTP 200 for `2.2.8` and the immutable multi-platform digest below. This configuration is an adapted upstream Compose recipe, **not deployed**; replace the example hostname and set proxy trust for the actual topology before use. [Release workflow](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/.github/workflows/docker-publish.yml), [upstream Compose](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/docker-compose.yml).

```yaml
services:
  nodecast-tv:
    image: ghcr.io/technomancer702/nodecast-tv:2.2.8@sha256:92eab8088e88cfaca81422e139471b17b0ec178f8ffa428a7a4be35eb078100d
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3000"
      APP_ORIGIN: https://tv.example.com
      AUTH_COOKIE_SECURE: "true"
```

This assumes a host-local HTTPS reverse proxy forwarding the original Host and scheme to port 3000. Configure `TRUST_PROXY` to the proxy IP/CIDR appropriate to that host; the upstream default trusts loopback, link-local and private networks. Do not expose an uninitialized instance before its owner completes setup. The shipped Dockerfile supplies Node 20 and FFmpeg; the source package declares Node >=18. Rebuilding that Dockerfile is not bit-reproducible because its OS/package feeds float; using the verified image digest fixes the deployed artifact. [Proxy options, lines 18–21](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/index.js#L18), [Dockerfile](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/Dockerfile).

Persist and back up the entire `/app/data` volume: it contains source/user settings in `db.json`, the SQLite content database and persisted authentication secrets. No generated credentials or private configuration are needed in WebPC. Keep upstream notices/source with any redistributed image modifications. [Data storage](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/db.js#L6), [SQLite storage](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/db/sqlite.js#L5), [security persistence](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/config/security.js).

## Requested default playlist

1. Open the hosted Nodecast login/setup page directly. Its initial setup creates the first administrator; there are no supplied default credentials. Existing installations use normal login, including 2FA when configured. [Setup route, lines 88–136](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/routes/auth.js#L88).
2. As administrator, use **Add M3U Playlist**, name it `IPTV-org`, and enter `https://iptv-org.github.io/iptv/index.m3u`. The equivalent supported request is **POST `/api/sources` on the authenticated Nodecast origin**, with JSON Content-Type and this body:

   ```json
   {"type":"m3u","name":"IPTV-org","url":"https://iptv-org.github.io/iptv/index.m3u"}
   ```

3. The endpoint returns **201** with the created source and starts asynchronous sync; 201 does not mean channel import finished. Sources default to enabled. Check **GET `/api/sources/status`** for progress and use **POST `/api/sources/{id}/sync`** for a later manual refresh. Check **GET `/api/sources`** for an existing matching URL before automating creation, to avoid duplicates. [UI](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/public/js/components/SourceManager.js#L174), [create route, lines 68–84](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/routes/sources.js#L68), [status route](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/routes/sources.js#L29), [manual sync](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/routes/sources.js#L174).

No default-playlist environment variable or startup seed hook was found in the pinned server. Use the native UI/API after setup, not hand-edited database files. The server streams M3U parsing into channel batches; the browser does not fetch this source list itself. EPG is a separate source type; supplying this M3U alone does not configure an EPG feed. [M3U sync, lines 636–684](https://github.com/technomancer702/nodecast-tv/blob/aa9ca6d3543ac26a0e2cecfae3ac76b92cd2d6e7/server/services/syncService.js#L636).

Validation limits: source inspection and public release/registry reads only. The playlist HTTPS fetch timed out during TLS negotiation in this environment, so current reachability, channel count and individual stream playback are unverified. No server, container, login, playlist mutation or deployment was run. The pending decision is whether the user wants actual Nodecast on a separately operated host (recommended external launch), a specifically validated iframe deployment, or a separately identified browser-only alternative.
