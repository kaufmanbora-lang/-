const baseUrl = process.env.ORBIT_TEST_BASE || "http://127.0.0.1:8790";
const adminPassword = process.env.ORBIT_ADMIN_PASSWORD || "123487";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function request(path, options = {}, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
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
  return data;
}

async function register(label) {
  return request("/api/register", {
    method: "POST",
    body: {
      email: `orbit-smoke-${label}-${runId}@test.local`,
      nickname: `Smoke${label}${runId.slice(-5)}`,
      password: "StrongPass123!",
      legalAccepted: true
    }
  });
}

async function cleanup(users) {
  try {
    const admin = await request("/api/admin-login", {
      method: "POST",
      body: { adminPassword }
    });
    for (const user of users) {
      if (!user?.id) continue;
      await request("/api/admin/delete-account", {
        method: "POST",
        body: { userId: user.id, reason: `Orbit smoke cleanup ${runId}` }
      }, admin.token).catch(() => {});
    }
  } catch (error) {
    console.warn(`Cleanup skipped: ${error.message}`);
  }
}

async function main() {
  const createdUsers = [];
  try {
    const first = await register("a");
    const second = await register("b");
    createdUsers.push(first.user, second.user);

    const firstToken = first.token;
    const secondToken = second.token;

    await request("/api/orbit-plus", {}, firstToken);
    const friend = await request("/api/friends/request", {
      method: "POST",
      body: { query: second.user.nickname, message: "Smoke friend request" }
    }, firstToken);
    await request("/api/friends/action", {
      method: "POST",
      body: { requestId: friend.request.id, action: "accept" }
    }, secondToken);

    const story = await request("/api/stories", {
      method: "POST",
      body: { text: `Smoke story ${runId}` }
    }, firstToken);
    await request("/api/stories/view", {
      method: "POST",
      body: { storyId: story.story.id }
    }, secondToken);
    await request("/api/stories/react", {
      method: "POST",
      body: { storyId: story.story.id, reaction: "spark" }
    }, secondToken);

    await request("/api/customization/equip", {
      method: "POST",
      body: { itemId: "theme-midnight" }
    }, firstToken);
    const game = await request("/api/minigames/play", {
      method: "POST",
      body: { game: "reactor", score: 150 }
    }, firstToken);
    const clan = await request("/api/clans", {
      method: "POST",
      body: { action: "create", name: `SmokeClan${runId.slice(-4)}`, description: "Smoke clan" }
    }, firstToken);
    await request("/api/preferences", {
      method: "POST",
      body: {
        onboardingComplete: true,
        safeMode: true,
        notificationPrefs: { messages: true, friends: true, stories: true, gifts: true, clan: true, security: true }
      }
    }, firstToken);
    await request("/api/messages", {
      method: "POST",
      body: { toUserId: second.user.id, text: `Smoke DM ${runId}` }
    }, firstToken);

    const plus = await request("/api/orbit-plus", {}, firstToken);
    const unlocked = plus.orbitPlus.achievements.filter((item) => item.unlocked).map((item) => item.id);
    const requiredAchievements = ["first-message", "story-maker", "story-spark", "friendly", "style-maker", "clan-founder", "game-streak", "arcade-rookie", "reactor-master"];
    for (const achievement of requiredAchievements) {
      if (!unlocked.includes(achievement)) throw new Error(`Achievement did not unlock: ${achievement}`);
    }
    if (!clan.orbitPlus.myClan?.name) throw new Error("Clan was not created.");
    if (game.round?.result?.score < 150) throw new Error("Arcade score was not saved.");

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
