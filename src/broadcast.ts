import { createServer, type ServerResponse } from "node:http";
import { log } from "./log.js";
import { config } from "./config.js";

const clients = new Set<ServerResponse>();

export function broadcast(chunk: Buffer): void {
  for (const res of clients) {
    if (!res.writable) {
      clients.delete(res);
      continue;
    }
    const ok = res.write(chunk);
    if (!ok) {
      // Back-pressure: drop slow client
      clients.delete(res);
      res.destroy();
      log.warn(`Dropped slow client (${clients.size} remaining)`);
    }
  }
}

export function startServer(): void {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/stream")) {
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache, no-store",
        Connection: "close",
        "icy-name": "Radio Vibes",
      });
      clients.add(res);
      log.info(`Listener connected (${clients.size} total)`);

      req.on("close", () => {
        clients.delete(res);
        log.info(`Listener disconnected (${clients.size} remaining)`);
      });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WMEW Radio</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #111; color: #eee; font-family: system-ui, sans-serif;
  }
  .wrap { text-align: center; }
  h1 { font-size: 2.5rem; margin-bottom: .3rem; }
  .sub { color: #888; margin-bottom: 1.5rem; font-size: .9rem; }
  audio { display: block; margin: 0 auto 1rem; }
  .status {
    font-size: .85rem; padding: .4rem .8rem; border-radius: 999px;
    display: inline-block; transition: all .3s;
  }
  .status.live { background: #1a3a1a; color: #4f4; }
  .status.off  { background: #3a1a1a; color: #f44; }
</style>
</head><body>
<div class="wrap">
  <h1>WMEW</h1>
  <p class="sub">all paws, no pause</p>
  <audio id="player" controls></audio>
  <div id="status" class="status off">connecting...</div>
</div>
<script>
(function() {
  const audio = document.getElementById("player");
  const status = document.getElementById("status");
  let retryDelay = 1000;
  let retryTimer = null;

  function setStatus(text, live) {
    status.textContent = text;
    status.className = "status " + (live ? "live" : "off");
  }

  function connect() {
    clearTimeout(retryTimer);
    // cache-bust so browser doesn't serve stale stream
    audio.src = "/stream?t=" + Date.now();
    audio.load();
    audio.play().catch(function() {});
  }

  audio.addEventListener("playing", function() {
    retryDelay = 1000;
    setStatus("live", true);
  });

  audio.addEventListener("waiting", function() {
    setStatus("buffering...", true);
  });

  audio.addEventListener("error", function() {
    setStatus("offline — retrying in " + (retryDelay / 1000) + "s", false);
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  });

  audio.addEventListener("stalled", function() {
    setStatus("stream stalled — reconnecting...", false);
    retryTimer = setTimeout(connect, 2000);
  });

  // Watchdog: if currentTime stops advancing for 3s, reconnect
  var lastTime = 0;
  var stallCount = 0;
  setInterval(function() {
    if (audio.currentTime === lastTime && !audio.paused) {
      stallCount++;
      if (stallCount >= 3) {
        stallCount = 0;
        setStatus("stream lost — reconnecting...", false);
        connect();
      }
    } else {
      stallCount = 0;
    }
    lastTime = audio.currentTime;
  }, 1000);

  connect();
})();
</script>
</body></html>`);
  });

  server.listen(config.port, () => {
    log.info(`Streaming on http://localhost:${config.port}/stream`);
  });
}
