import { createServer, type ServerResponse } from "node:http";
import { log } from "./log.js";
import { config } from "./config.js";
import { getNowPlaying, setListeners } from "./nowplaying.js";

const clients = new Set<ServerResponse>();

export function getListenerCount(): number {
  return clients.size;
}

let listenerWaiter: (() => void) | null = null;

export function waitForListeners(): Promise<void> {
  if (clients.size > 0) return Promise.resolve();
  return new Promise<void>((resolve) => { listenerWaiter = resolve; });
}

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
      setListeners(clients.size);
      log.info(`Listener connected (${clients.size} total)`);
      if (listenerWaiter) {
        listenerWaiter();
        listenerWaiter = null;
      }

      req.on("close", () => {
        clients.delete(res);
        setListeners(clients.size);
        log.info(`Listener disconnected (${clients.size} remaining)`);
      });
      return;
    }

    if (req.url?.startsWith("/api/now-playing")) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(getNowPlaying()));
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
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #111; color: #eee; font-family: system-ui, sans-serif;
    padding: 2rem;
  }
  .wrap { text-align: center; max-width: 720px; width: 100%; }
  h1 { font-size: 2.5rem; margin-bottom: .3rem; }
  .sub { color: #888; margin-bottom: 1.5rem; font-size: .9rem; }
  audio { display: block; margin: 0 auto 1rem; }
  .status {
    font-size: .85rem; padding: .4rem .8rem; border-radius: 999px;
    display: inline-block; transition: all .3s;
  }
  .status.live { background: #1a3a1a; color: #4f4; }
  .status.off  { background: #3a1a1a; color: #f44; }
  .columns {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;
    margin-top: 1.5rem; text-align: left;
  }
  @media (max-width: 600px) {
    .columns { grid-template-columns: 1fr; }
  }
  .col-header { font-size: .75rem; text-transform: uppercase; letter-spacing: .1em; color: #666; margin-bottom: .6rem; }
  #timeline { list-style: none; padding: 0; font-size: .85rem; }
  #timeline li { padding: .4rem .6rem; border-radius: .3rem; }
  #timeline li .track-title { display: block; }
  #timeline li .track-artist { display: block; color: #999; font-size: .8em; }
  #timeline li.history { opacity: 0.4; font-size: .82rem; }
  #timeline li.current { opacity: 1; font-weight: bold; background: #1a2a1a; border-left: 3px solid #4f4; }
  #timeline li.upcoming { opacity: 0.7; font-size: .85rem; }
  #timeline li.current .track-artist { color: #8b8; }
  #quips { list-style: none; padding: 0; font-size: .85rem; color: #aaa; }
  #quips li { padding: .4rem 0; border-top: 1px solid #222; }
  #quips li:first-child { border-top: none; }
  #quips .quip-time { color: #666; font-size: .8em; margin-right: .4rem; font-variant-numeric: tabular-nums; }
  .meta { color: #555; font-size: .75rem; margin-top: .8rem; text-align: center; }
  .credits { margin-top: 2rem; padding: 1.2rem; background: #1a1a1a; border-radius: .5rem; color: #ccc; font-size: .85rem; line-height: 1.8; text-align: center; }
  .credits strong { color: #eee; }
  .credits a { color: #6cf; text-decoration: none; }
  .credits a:hover { text-decoration: underline; }
  .credits .disclaimer { margin-top: .6rem; color: #888; font-size: .75rem; }
</style>
</head><body>
<div class="wrap">
  <h1>WMEW</h1>
  <p class="sub">all paws, no pause</p>
  <audio id="player" controls></audio>
  <div id="status" class="status off">connecting...</div>
  <div class="columns">
    <div>
      <div class="col-header">Track timeline</div>
      <ul id="timeline"></ul>
    </div>
    <div>
      <div class="col-header">Latest news</div>
      <ul id="quips"></ul>
    </div>
  </div>
  <div id="listeners" class="meta"></div>
  <div class="credits">
    All music is from <strong><a href="https://store.steampowered.com/app/686060/Mewgenics/" target="_blank">Mewgenics</a></strong>
    by Edmund McMillen.<br>
    Soundtrack by <strong><a href="https://ridiculon.bandcamp.com/album/mewgenics-ost" target="_blank">Ridiculon</a></strong>
    — <a href="https://ridiculon.bandcamp.com/" target="_blank">buy the OST on Bandcamp</a>
    and <a href="https://store.steampowered.com/app/686060/Mewgenics/" target="_blank">get the game on Steam</a>!
    <div class="disclaimer">
      This is a non-commercial fan project. All music rights belong to their respective owners.
    </div>
  </div>
</div>
<script>
(function() {
  const audio = document.getElementById("player");
  const status = document.getElementById("status");
  var saved = localStorage.getItem("wmew-volume");
  if (saved !== null) audio.volume = parseFloat(saved);
  audio.addEventListener("volumechange", function() {
    localStorage.setItem("wmew-volume", String(audio.volume));
  });

  let retryDelay = 1000;
  let retryTimer = null;

  function setStatus(text, live) {
    status.textContent = text;
    status.className = "status " + (live ? "live" : "off");
  }

  function connect() {
    clearTimeout(retryTimer);
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

  var timelineEl = document.getElementById("timeline");
  var quipsEl = document.getElementById("quips");
  var listenersEl = document.getElementById("listeners");
  var knownVersion = null;

  function renderTrack(t, cls, prefix) {
    return '<li class="' + cls + '">'
      + '<span class="track-title">' + prefix + ' ' + esc(t.title) + '</span>'
      + (t.artist ? '<span class="track-artist">' + esc(t.artist) + '</span>' : '')
      + '</li>';
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }

  function poll() {
    fetch("/api/now-playing").then(function(r) { return r.json(); }).then(function(data) {
      if (knownVersion && data.version && data.version !== knownVersion) {
        location.reload();
        return;
      }
      knownVersion = data.version || null;

      var html = '';
      var hist = data.history || [];
      // Show history in reverse (oldest first)
      for (var i = hist.length - 1; i >= 0; i--) {
        html += renderTrack(hist[i], 'history', '\\u266a');
      }
      if (data.track) {
        html += renderTrack(data.track, 'current', '\\u25b6');
      }
      var up = data.upcoming || [];
      for (var j = 0; j < up.length; j++) {
        html += renderTrack(up[j], 'upcoming', '\\u266a');
      }
      timelineEl.innerHTML = html;

      quipsEl.innerHTML = data.quips.map(function(q) {
        return '<li><span class="quip-time">' + esc(formatTime(q.at)) + '</span>' + esc(q.text) + '</li>';
      }).join('');
      listenersEl.textContent = data.listeners ? data.listeners + ' listening' : '';
    }).catch(function() {});
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  poll();
  setInterval(poll, 5000);
})();
</script>
</body></html>`);
  });

  server.listen(config.port, () => {
    log.info(`Streaming on http://localhost:${config.port}/stream`);
  });
}
