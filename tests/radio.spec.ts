import { test, expect } from "@playwright/test";

const BASE = `http://localhost:${process.env.TEST_PORT || 19737}`;

test.describe("WMEW Radio", () => {
  test("homepage loads with expected structure", async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle("WMEW Radio");
    await expect(page.locator("h1")).toHaveText("WMEW");
    await expect(page.locator(".sub")).toHaveText("all paws, no pause");
    await expect(page.locator("audio#player")).toBeAttached();
    await expect(page.locator("#status")).toBeAttached();
    await expect(page.locator("#track")).toBeAttached();
    await expect(page.locator("#quips")).toBeAttached();
    await expect(page.locator("#listeners")).toBeAttached();
  });

  test("credits section links to Mewgenics and Ridiculon", async ({ page }) => {
    await page.goto(BASE);
    const credits = page.locator(".credits");
    await expect(credits).toBeVisible();
    await expect(credits).toContainText("Mewgenics");
    await expect(credits).toContainText("Edmund McMillen");
    await expect(credits).toContainText("Ridiculon");
    await expect(credits).toContainText("non-commercial fan project");

    const steamLink = credits.locator('a[href*="store.steampowered.com"]').first();
    await expect(steamLink).toHaveAttribute(
      "href",
      "https://store.steampowered.com/app/686060/Mewgenics/",
    );

    const bandcampOst = credits.locator('a[href*="ridiculon.bandcamp.com/album"]');
    await expect(bandcampOst).toHaveAttribute(
      "href",
      "https://ridiculon.bandcamp.com/album/mewgenics-ost",
    );

    const bandcampArtist = credits.locator('a[href="https://ridiculon.bandcamp.com/"]');
    await expect(bandcampArtist).toBeVisible();
  });

  test("/api/now-playing returns valid JSON", async ({ request }) => {
    const res = await request.get(`${BASE}/api/now-playing`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");

    const data = await res.json();
    expect(data).toHaveProperty("track");
    expect(data).toHaveProperty("quips");
    expect(data).toHaveProperty("listeners");
    expect(Array.isArray(data.quips)).toBe(true);
    expect(typeof data.listeners).toBe("number");
  });

  test("/stream returns audio/mpeg", async ({}) => {
    // Use Node http.get since the stream never completes and Playwright
    // request API waits for the full body.
    const http = await import("node:http");
    const headers = await new Promise<{ status: number; contentType: string; icyName: string }>((resolve, reject) => {
      const req = http.get(`${BASE}/stream`, (res) => {
        resolve({
          status: res.statusCode!,
          contentType: res.headers["content-type"]!,
          icyName: res.headers["icy-name"] as string,
        });
        req.destroy();
      });
      req.on("error", (err) => {
        if (err.message.includes("socket hang up")) return; // expected from destroy
        reject(err);
      });
    });

    expect(headers.status).toBe(200);
    expect(headers.contentType).toBe("audio/mpeg");
    expect(headers.icyName).toBe("Radio Vibes");
  });

  test("volume persists in localStorage", async ({ page }) => {
    await page.goto(BASE);

    // Set volume to 0.42
    await page.evaluate(() => {
      const audio = document.getElementById("player") as HTMLAudioElement;
      audio.volume = 0.42;
    });

    // Check it was saved
    const stored = await page.evaluate(() => localStorage.getItem("wmew-volume"));
    expect(stored).toBe("0.42");

    // Reload and verify it's restored
    await page.reload();
    const restored = await page.evaluate(() => {
      const audio = document.getElementById("player") as HTMLAudioElement;
      return audio.volume;
    });
    expect(restored).toBeCloseTo(0.42);
  });

  test("now-playing poll updates the DOM", async ({ page }) => {
    await page.goto(BASE);

    // Wait for first poll (happens immediately on load)
    await page.waitForResponse(`${BASE}/api/now-playing`);

    // The track div should exist (may be empty if nothing played yet, that's ok)
    await expect(page.locator("#track")).toBeAttached();
    // The quips list should exist
    await expect(page.locator("#quips")).toBeAttached();
  });

  test("quips appear in API and on page after crossfade", async ({ page, request }) => {
    // Wait for the server to complete at least one crossfade cycle
    // by polling the API until quips array is non-empty.
    let quips: { text: string }[] = [];
    for (let i = 0; i < 60; i++) {
      const res = await request.get(`${BASE}/api/now-playing`);
      const data = await res.json();
      if (data.quips.length > 0) {
        quips = data.quips;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(quips.length).toBeGreaterThan(0);
    expect(quips[0].text.length).toBeGreaterThan(0);

    // Now verify the quip shows up in the DOM
    await page.goto(BASE);
    await page.waitForResponse(`${BASE}/api/now-playing`);
    const items = page.locator("#quips li");
    await expect(items.first()).toBeVisible();
    const text = await items.first().textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("audio element starts with saved volume from localStorage", async ({ page }) => {
    // Pre-seed localStorage before the page loads
    await page.goto(BASE);
    await page.evaluate(() => localStorage.setItem("wmew-volume", "0.25"));
    await page.reload();

    const volume = await page.evaluate(() => {
      const audio = document.getElementById("player") as HTMLAudioElement;
      return audio.volume;
    });
    expect(volume).toBeCloseTo(0.25);
  });
});
