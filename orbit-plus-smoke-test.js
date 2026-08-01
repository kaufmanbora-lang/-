const baseUrl = process.env.ORBIT_TEST_BASE || "http://127.0.0.1:8790";
const adminPassword = String(process.env.ORBIT_ADMIN_PASSWORD || "").trim();
if (adminPassword.length < 16) {
  throw new Error("Set ORBIT_ADMIN_PASSWORD to the current administrator password (at least 16 characters).");
}
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function createSession() {
  return { cookie: "", csrfToken: "" };
}

async function request(path, options = {}, session = null) {
  const method = options.method || "GET";
  const modifiesState = !["GET", "HEAD", "OPTIONS"].includes(method);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(session?.cookie ? { cookie: session.cookie } : {}),
      ...(modifiesState && session?.csrfToken ? { "x-orbit-csrf": session.csrfToken } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (session) {
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    const cookie = setCookies[0]?.split(";", 1)[0];
    if (cookie) session.cookie = cookie;
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(data)}`);
  }
  if (session && data?.csrfToken) session.csrfToken = data.csrfToken;
  return data;
}

async function register(label, session) {
  return request("/api/register", {
    method: "POST",
    body: {
      email: `orbit-smoke-${label}-${runId}@test.local`,
      nickname: `Smoke${label}${runId.slice(-5)}`,
      password: "StrongPass123!",
      legalAccepted: true
    }
  }, session);
}

async function cleanup(users) {
  try {
    const adminSession = createSession();
    const admin = await request("/api/admin-login", {
      method: "POST",
      body: { adminPassword }
    }, adminSession);
    for (const user of users) {
      if (!user?.id) continue;
      await request("/api/admin/delete-account", {
        method: "POST",
        body: { userId: user.id, reason: `Orbit smoke cleanup ${runId}` }
      }, adminSession).catch(() => {});
    }
  } catch (error) {
    console.warn(`Cleanup skipped: ${error.message}`);
  }
}

async function main() {
  const createdUsers = [];
  try {
    const firstSession = createSession();
    const secondSession = createSession();
    const first = await register("a", firstSession);
    const second = await register("b", secondSession);
    createdUsers.push(first.user, second.user);

    await request("/api/orbit-plus", {}, firstSession);
    const friend = await request("/api/friends/request", {
      method: "POST",
      body: { query: second.user.nickname, message: "Smoke friend request" }
    }, firstSession);
    await request("/api/friends/action", {
      method: "POST",
      body: { requestId: friend.request.id, action: "accept" }
    }, secondSession);

    const story = await request("/api/stories", {
      method: "POST",
      body: { text: `Smoke story ${runId}` }
    }, firstSession);
    const fakeMp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom"),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])
    ]).toString("base64");
    await request("/api/stories", {
      method: "POST",
      body: {
        text: `Smoke video story ${runId}`,
        attachment: {
          name: "smoke-video.mp4",
          mimeType: "video/mp4",
          size: Buffer.byteLength(fakeMp4, "base64"),
          data: `data:video/mp4;base64,${fakeMp4}`
        }
      }
    }, firstSession);
    await request("/api/stories/view", {
      method: "POST",
      body: { storyId: story.story.id }
    }, secondSession);
    await request("/api/stories/react", {
      method: "POST",
      body: { storyId: story.story.id, reaction: "spark" }
    }, secondSession);

    await request("/api/customization/equip", {
      method: "POST",
      body: { itemId: "theme-midnight" }
    }, firstSession);
    const game = await request("/api/minigames/play", {
      method: "POST",
      body: { game: "reactor", score: 150 }
    }, firstSession);
    const pair = await request("/api/pair-games/create", {
      method: "POST",
      body: { game: "duel", opponent: second.user.nickname, message: "Smoke pair game" }
    }, firstSession);
    await request("/api/pair-games/play", {
      method: "POST",
      body: { challengeId: pair.challenge.id, score: 180 }
    }, firstSession);
    await request("/api/pair-games/play", {
      method: "POST",
      body: { challengeId: pair.challenge.id, score: 120 }
    }, secondSession);
    const clan = await request("/api/clans", {
      method: "POST",
      body: { action: "create", name: `SmokeClan${runId.slice(-4)}`, description: "Smoke clan" }
    }, firstSession);
    await request("/api/preferences", {
      method: "POST",
      body: {
        onboardingComplete: true,
        safeMode: true,
        notificationPrefs: { messages: true, friends: true, stories: true, gifts: true, clan: true, security: true }
      }
    }, firstSession);
    await request("/api/messages", {
      method: "POST",
      body: { toUserId: second.user.id, text: `Smoke DM ${runId}` }
    }, firstSession);

    const plus = await request("/api/orbit-plus", {}, firstSession);
    const unlocked = plus.orbitPlus.achievements.filter((item) => item.unlocked).map((item) => item.id);
    const requiredAchievements = ["first-message", "story-maker", "story-spark", "friendly", "style-maker", "clan-founder", "game-streak", "arcade-rookie", "reactor-master", "pair-player", "pair-winner"];
    for (const achievement of requiredAchievements) {
      if (!unlocked.includes(achievement)) throw new Error(`Achievement did not unlock: ${achievement}`);
    }
    if (!clan.orbitPlus.myClan?.name) throw new Error("Clan was not created.");
    if (game.round?.result?.score < 150) throw new Error("Arcade score was not saved.");
    if (!plus.orbitPlus.pairGames?.some((item) => item.status === "completed" && item.iWon)) throw new Error("Pair game was not completed for the winner.");

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      runId,
      level: plus.user.level,
      achievements: unlocked,
      clan: clan.orbitPlus.myClan.name,
      game: game.round
    }, null, 2));
  } finally {
    await cleanup(createdUsers);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
