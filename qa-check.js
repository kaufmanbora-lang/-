const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = __dirname;

function runNodeCheck(file) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${file} syntax failed:\n${result.stderr || result.stdout}`);
  }
}

function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.display !== "standalone") throw new Error("manifest.display must be standalone.");
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 5) throw new Error("manifest.icons must include PNG and SVG icons.");
  for (const icon of manifest.icons) {
    const iconPath = path.join(root, icon.src.replace(/^\//, ""));
    if (!fs.existsSync(iconPath)) throw new Error(`Missing icon file: ${icon.src}`);
  }
}

function checkNftAssets() {
  for (let index = 1; index <= 20; index += 1) {
    const file = path.join(root, "assets", "nft", `nft-${String(index).padStart(2, "0")}.png`);
    if (!fs.existsSync(file)) throw new Error(`Missing NFT photo asset: ${file}`);
    const size = fs.statSync(file).size;
    if (size < 20000) throw new Error(`NFT photo asset looks too small: ${file}`);
  }
  const sprite = path.join(root, "assets", "nft", "nft-variants-sprite.jpg");
  if (!fs.existsSync(sprite)) throw new Error("Missing NFT variant sprite sheet.");
  if (fs.statSync(sprite).size < 500000) throw new Error("NFT sprite sheet looks too small.");
  const oldVariantFiles = fs.readdirSync(path.join(root, "assets", "nft")).filter((name) => /-bg\d+\.png$/.test(name));
  if (oldVariantFiles.length) throw new Error(`NFT variants must be packed into one sprite, found ${oldVariantFiles.length} loose files.`);
}

function checkClientScript() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/);
  if (!script) throw new Error("index.html script block not found.");
  if (!html.includes('id="copyAppLinkButton"')) throw new Error("Notification panel must include copyAppLinkButton.");
  if (!html.includes('id="startupSplash"')) throw new Error("App must include a startup splash animation.");
  if (!html.includes("setTimeout(closeStartupSplash, 3000)")) throw new Error("Startup splash must stay visible for 3 seconds.");
  if (!html.includes("@keyframes startupProgress")) throw new Error("Startup splash must include animated progress.");
  if (!html.includes('id="audioCallButton"')) throw new Error("Chat header must include audioCallButton.");
  if (!html.includes('id="securityButton"')) throw new Error("Chat header must include securityButton.");
  if (!html.includes('id="securityPanel"')) throw new Error("Security panel must exist.");
  if (!html.includes('id="deleteAccountButton"')) throw new Error("Security panel must include user account deletion.");
  if (!html.includes("/privacy.html") || !html.includes("/support.html")) throw new Error("App must expose privacy and support links.");
  if (!html.includes('id="supportChatButton"')) throw new Error("App must include support chat button.");
  if (!html.includes('id="adminPremiumRequestsButton"')) throw new Error("Admin must have a visible premium requests shortcut.");
  if (!html.includes('id="profileAdminPremiumRequestsButton"')) throw new Error("Admin profile must include premium requests shortcut.");
  if (!html.includes("function openSupportChat(")) throw new Error("App must include support chat opening flow.");
  if (!html.includes("/api/support/open")) throw new Error("App must call support chat API.");
  if (!html.includes(".chat-row .row-main")) throw new Error("Chat row titles must have dedicated alignment styling.");
  if (!html.includes('message.sender?.id === "support"')) throw new Error("Support messages must not open an admin profile.");
  if (html.includes('id="peopleTab"')) throw new Error("People tab must be removed; people should be found only through search.");
  if (!html.includes('id="profileEmail"')) throw new Error("Profile must include email change input.");
  if (!html.includes('id="profileLogoutButton"')) throw new Error("Profile must include logout button.");
  if (!html.includes("logout-inline-button")) throw new Error("Account footer must expose a visible logout button.");
  if (html.includes('id="registerCode"')) throw new Error("Registration must not require an email code input.");
  if (html.includes('id="requestRegisterCodeButton"')) throw new Error("Registration must not include a request-code button.");
  if (!html.includes('id="registerLegalAccept"')) throw new Error("Registration must require legal agreement acceptance.");
  if (!html.includes("legalAccepted: els.registerLegalAccept.checked")) throw new Error("Registration must send legal acceptance to the server.");
  if (html.includes('id="profileEmailCode"')) throw new Error("Profile must not require an email confirmation code.");
  if (html.includes('id="confirmEmailCodeButton"')) throw new Error("Profile must not include a confirm-code button.");
  if (!html.includes('id="profileTermsButton"')) throw new Error("Profile must expose terms button.");
  if (!html.includes('id="profilePrivacyButton"')) throw new Error("Profile must expose privacy button.");
  if (!html.includes('id="adminLoginForm"')) throw new Error("Auth must include adminLoginForm.");
  if (!html.includes('id="adminPassword"')) throw new Error("Auth must include adminPassword.");
  if (/placeholder="\d{4,}"/.test(html)) throw new Error("Admin password must not be shown in the input placeholder.");
  if (!html.includes('id="viewProfileAdminBlock"')) throw new Error("User profile must include admin block button.");
  if (!html.includes('id="viewProfileAdminDelete"')) throw new Error("User profile must include admin delete button.");
  if (!html.includes('id="viewProfileAdminPremium"')) throw new Error("User profile must include admin premium button.");
  if (!html.includes('id="profilePremiumBox"')) throw new Error("Profile must include premium sticker editor.");
  if (!html.includes('id="profilePremiumRequestBox"')) throw new Error("Profile must include premium request box.");
  if (!html.includes('id="nftMarketButton"')) throw new Error("App must include NFT market button.");
  if (!html.includes('id="nftMarketPanel"')) throw new Error("App must include NFT market panel.");
  if (!html.includes('data-nft-tab="create"') || !html.includes('data-nft-tab="ot"')) throw new Error("NFT market must include create and OT purchase tabs.");
  if (!html.includes("nft-photo") || !html.includes("nft-image-chip")) throw new Error("NFT market must render photo-cut NFT art and image picker chips.");
  if (!html.includes("function nftImageFor(") || !html.includes("function nftImageMarkup(") || !html.includes("nft-sprite-frame")) throw new Error("NFT art must switch to the exact sprite cell for the selected background.");
  if (!html.includes("function nftMarketBackgrounds(")) throw new Error("NFT market must expose only the real photo background picker.");
  if (!html.includes("Math.max(750")) throw new Error("NFT fallback prices must be raised above the old cheap values.");
  if (!html.includes("nftGiftSymbols") || !html.includes("nft-bg-grid") || !html.includes("nft-bg-chip")) throw new Error("NFT creation must use photo gifts plus a separate changing background picker.");
  if (html.includes("30 СЃРёРјРІРѕР»РѕРІ") || html.includes("30 символов")) throw new Error("NFT creation must not show the old 30-symbol sticker picker.");
  if (!html.includes("profile-nft-showcase") || !html.includes("profileNftShowcaseHtml")) throw new Error("Profiles must render a public NFT showcase.");
  if (!html.includes("avatar-nft-badge") || !html.includes("profileNftBadgeHtml")) throw new Error("Avatars must show a visible NFT badge.");
  if (!html.includes("data-nft-profile") || !html.includes("/api/nft/profile")) throw new Error("NFT inventory must allow setting the profile NFT.");
  if (!html.includes("data-nft-gift") || !html.includes("giftNftItem") || !html.includes("/api/nft/gift")) throw new Error("NFT inventory must allow gifting an owned NFT to another user.");
  if (!html.includes("function nftFallbackPrice(")) throw new Error("Client must calculate a non-zero fallback NFT price.");
  if (html.includes("price: featured?.price || 0")) throw new Error("Client must not display 0 OT when a selected NFT combo is missing from featured data.");
  if (!html.includes("function renderNftMarket(")) throw new Error("Client must render NFT market.");
  if (!html.includes("/api/nft/market")) throw new Error("Client must load NFT market API.");
  if (!html.includes("/api/nft/buy")) throw new Error("Client must buy primary NFTs.");
  if (!html.includes("/api/nft/list")) throw new Error("Client must list NFTs for sale.");
  if (!html.includes("/api/nft/buy-listing")) throw new Error("Client must buy listed NFTs.");
  if (!html.includes("/api/ot/purchase-request")) throw new Error("Client must open OT purchase chat.");
  if (!html.includes('id="orbitPlusButton"') || !html.includes('id="orbitPlusPanel"')) throw new Error("Client must expose the Orbit+ hub.");
  for (const tab of ["stories", "friends", "profile", "shop", "games", "clans", "safety", "onboarding"]) {
    if (!html.includes(`data-orbit-tab="${tab}"`)) throw new Error(`Orbit+ tab missing: ${tab}.`);
  }
  for (const fn of ["renderOrbitPlus", "createOrbitStory", "requestOrbitFriend", "buyOrEquipCustomization", "playOrbitGame", "startOrbitGame", "hitOrbitGameCell", "finishOrbitGame", "createOrbitClan", "saveOrbitPrefs"]) {
    if (!html.includes(`function ${fn}(`)) throw new Error(`Orbit+ client function missing: ${fn}.`);
  }
  for (const marker of ["orbit-game-launcher", "is-playing-game", "orbit-game-arena", "orbit-game-grid", "data-game-start", "reactor", "memory", "signal", "data-orbit-cell"]) {
    if (!html.includes(marker)) throw new Error(`Orbit+ real game UI missing: ${marker}.`);
  }
  for (const marker of ["pair-game-card", "data-pair-create", "data-pair-play", "data-signal-lane", "data-dice-roll", "data-coin-pick", "data-spin-wheel", "storyMediaHtml", "profile-nft-gallery"]) {
    if (!html.includes(marker)) throw new Error(`Orbit+ expanded game/story/profile UI missing: ${marker}.`);
  }
  for (const marker of ["local-pair-card", "data-local-pair-start", "localPairGameDefinitions", "startLocalPairGame", "finishLocalPairGame", "local-pair-result", "wheel-battle", "dice-bank", "coin-streak", "ot-spin-battle", "pairFriendInviteStripHtml", "data-pair-friend"]) {
    if (!html.includes(marker)) throw new Error(`Local pair game UI missing: ${marker}.`);
  }
  for (const marker of ["orbit-memory-board", "orbit-memory-pad", "memory-pad-0", "ot-coin", "ot-coin-logo", "fortune-wheel", "orbit-wheel-pointer", "wheel-center"]) {
    if (!html.includes(marker)) throw new Error(`Distinct Orbit game visuals missing: ${marker}.`);
  }
  for (const marker of ["memoryAcceptInput", "startOrbitMemoryPlayback", "scheduleOrbitMemoryStep", "coinFlipUntil", "wheelSpinUntil", "diceRollUntil", "dicePipsHtml", "dice-cube", "dice-face-front", "dice-model-shell", "updateOrbitDiceView", "updateOrbitGameHud", "diceRollPop", "wheelSpinStop", "ot-coin-edge", "OT_SPIN_COST", "ORBIT_SPIN_REWARD_TABLE", "/api/minigames/spin"]) {
    if (!html.includes(marker)) throw new Error(`Orbit game animation/Simon logic missing: ${marker}.`);
  }
  if (html.includes('<canvas class="dice-three-canvas"')) throw new Error("Dice game must not render the laggy GLB canvas.");
  if (html.includes('/assets/orbit-dice-renderer.js')) throw new Error("Dice game must not load the old GLB renderer script.");
  if (html.includes("OrbitDiceRenderer")) throw new Error("Dice game must not call the old GLB renderer.");
  if (html.includes("dice-asset-loaded")) throw new Error("Dice game must not depend on old model-loaded CSS.");
  for (const api of ["/api/orbit-plus", "/api/stories", "/api/friends/request", "/api/customization/buy", "/api/minigames/play", "/api/clans", "/api/preferences"]) {
    if (!html.includes(api)) throw new Error(`Orbit+ client API missing: ${api}.`);
  }
  for (const api of ["/api/pair-games/create", "/api/pair-games/play", "/api/pair-games/action"]) {
    if (!html.includes(api)) throw new Error(`Pair game client API missing: ${api}.`);
  }
  if (!html.includes('id="viewProfileAdminOt"')) throw new Error("Admin user profile must include OT grant button.");
  if (!html.includes("/api/admin/ot/grant")) throw new Error("Client must include admin OT grant API.");
  if (!html.includes('id="premiumRequestMessage"')) throw new Error("Profile must include premium request message field.");
  if (!html.includes('id="premiumRequestButton"')) throw new Error("Profile must include premium request submit button.");
  if (!html.includes("!state.user.isAdmin && !isPremiumUser(state.user)")) throw new Error("Admin profile must not show the user premium request form.");
  if (!html.includes("premium-badge")) throw new Error("Client must render a gold premium badge.");
  if (!html.includes(".row-main .premium-badge")) throw new Error("Premium badge must stay compact inside chat rows.");
  if (!html.includes("nickname-sticker")) throw new Error("Client must render nickname stickers.");
  if (html.includes('id="sendVerificationButton"')) throw new Error("Profile must not include send verification button when email confirmation is disabled.");
  if (!html.includes('id="resetRequestForm"')) throw new Error("Auth must include password reset request form.");
  if (!html.includes('id="replyBar"')) throw new Error("Composer must include reply bar.");
  if (!html.includes('id="voiceRecordingStatus"')) throw new Error("Composer must include voice recording status bar.");
  if (!html.includes('id="cancelVoiceButton"')) throw new Error("Composer must include voice recording cancel button.");
  if (!html.includes('id="roomPanel"')) throw new Error("Room info panel must exist.");
  if (!html.includes('id="mediaPanel"')) throw new Error("Media panel must exist.");
  if (!html.includes('id="viewProfileBlock"')) throw new Error("User profile must include block button.");
  if (!html.includes("function runPeopleSearch(")) throw new Error("index.html must search people through the API.");
  if (!html.includes('id="copyCallInviteButton"')) throw new Error("Call panel must include copyCallInviteButton.");
  if (!html.includes("function queueIceCandidate(")) throw new Error("index.html must include call ICE queue.");
  if (!html.includes("function startAudioCall(")) throw new Error("index.html must include audio call flow.");
  if (!html.includes("function supportedRecorderMime(")) throw new Error("index.html must choose supported voice recorder MIME.");
  if (!html.includes("function normalizeMimeType(")) throw new Error("index.html must normalize upload MIME types.");
  if (!html.includes("function voiceMimeForUpload(")) throw new Error("index.html must normalize browser voice MIME quirks.");
  if (!html.includes("function startFallbackVoiceRecorder(")) throw new Error("index.html must include Web Audio voice fallback.");
  if (!html.includes("function wavBlobFromSamples(")) throw new Error("index.html must encode fallback voice recordings as WAV.");
  if (!html.includes("state.wavRecorder")) throw new Error("index.html must track fallback voice recorder state.");
  if (!html.includes("durationSec")) throw new Error("index.html must keep voice message duration metadata.");
  if (!html.includes("video/webm")) throw new Error("index.html must handle browsers that record audio as video/webm.");
  if (!html.includes('id="savedFilterButton"')) throw new Error("Chat tools must include savedFilterButton.");
  if (!html.includes('id="favoriteRoomButton"')) throw new Error("Chat header must include favoriteRoomButton.");
  if (!html.includes('id="muteRoomButton"')) throw new Error("Chat tools must include muteRoomButton.");
  if (!html.includes('id="roomNoteButton"')) throw new Error("Chat tools must include roomNoteButton.");
  if (!html.includes('id="roomNoteLine"')) throw new Error("Chat surface must include roomNoteLine.");
  if (!html.includes('id="exportChatButton"')) throw new Error("Chat tools must include exportChatButton.");
  if (!html.includes('id="pollsButton"')) throw new Error("Chat tools must include pollsButton.");
  if (!html.includes('id="tasksButton"')) throw new Error("Chat tools must include tasksButton.");
  if (!html.includes('id="eventsButton"')) throw new Error("Chat tools must include eventsButton.");
  if (!html.includes('id="unreadFirstButton"')) throw new Error("Chat list must include unreadFirstButton.");
  if (!html.includes('id="chatFilterBar"')) throw new Error("Chat list must include chatFilterBar.");
  for (const filter of ["all", "unread", "archive"]) {
    if (!html.includes(`data-chat-filter="${filter}"`)) throw new Error(`Chat filter missing ${filter}.`);
  }
  if (!html.includes('id="focusModeButton"')) throw new Error("Chat tools must include focusModeButton.");
  if (!html.includes('id="compactModeButton"')) throw new Error("Chat tools must include compactModeButton.");
  if (!html.includes('id="emojiPanelButton"')) throw new Error("Chat tools must include emojiPanelButton.");
  if (!html.includes('id="templatePanelButton"')) throw new Error("Chat tools must include templatePanelButton.");
  if (!html.includes('id="messageCounter"')) throw new Error("Composer must include messageCounter.");
  if (!html.includes("privacy-strip")) throw new Error("Private-mode design strip must exist.");
  if (!html.includes("private-home")) throw new Error("Private no-room home state must exist.");
  if (html.includes('list.unshift({ id: "global"')) throw new Error("Client must not inject the removed global chat.");
  if (!html.includes('requestedRoomId === "global" ? ""')) throw new Error("Client must reject legacy global deep links.");
  if (!html.includes('meta name="theme-color" content="#020716"')) throw new Error("iPhone redesign must use the black-blue theme color.");
  if (!html.includes("Orbit Chat 1.5.4: black-blue iPhone glass redesign")) throw new Error("index.html must include the 1.5.4 redesign layer.");
  if (!html.includes("Orbit Chat 1.5.5: faithful iPhone concept pass")) throw new Error("index.html must include the 1.5.5 concept fidelity layer.");
  if (!html.includes("Orbit Chat 1.5.6: code-login, chat filters, and closer iPhone glass shell")) throw new Error("index.html must include the 1.5.6 upgrade layer.");
  if (!html.includes("Orbit Chat 1.5.7: App Store readiness")) throw new Error("index.html must include the 1.5.7 App Store readiness layer.");
  if (!html.includes("Orbit Chat 1.5.7: terms retained, chat filters moved")) throw new Error("index.html must include the 1.5.7 restore layout layer.");
  if (!html.includes("Archived 1.5.8 mobile experiment is disabled")) throw new Error("1.5.8 mobile experiment must stay disabled.");
  if (!html.includes('id="iosStatusbar"') && !html.includes('class="ios-statusbar"')) throw new Error("App shell must include the iPhone-style status bar.");
  if (!html.includes('id="iosActionSheet"')) throw new Error("Composer must include the iPhone-style action sheet.");
  if (!html.includes('id="iosTabbar"')) throw new Error("App shell must include the iPhone-style bottom tabbar.");
  if (!html.includes('id="iosTabUnread"')) throw new Error("Bottom tabbar must include unread badge.");
  for (const action of ["photo", "camera", "file", "voice", "contact", "poll", "schedule"]) {
    if (!html.includes(`data-ios-action="${action}"`)) throw new Error(`iPhone action sheet missing ${action} action.`);
  }
  for (const action of ["chats", "calls", "contacts", "favorites", "orbit", "profile"]) {
    if (!html.includes(`data-tabbar-action="${action}"`)) throw new Error(`Bottom tabbar missing ${action} action.`);
  }
  if (html.includes('data-tabbar-action="security"')) throw new Error("Restored 1.5.7 bottom tabbar must not include Security tab.");
  if (!html.includes('id="securityProfileButton"')) throw new Error("Security center must include profile/email shortcut.");
  if (!html.includes('id="securityNotifyButton"')) throw new Error("Security center must include notifications shortcut.");
  if (!html.includes('id="securityLogoutButton"')) throw new Error("Security center must include logout shortcut.");
  if (!html.includes('els.profileLogoutButton.addEventListener("click"')) throw new Error("Profile logout button must be wired.");
  if (!html.includes("Код на почту больше не нужен")) throw new Error("Registration UI must explain that email code is no longer required.");
  if (!(html.indexOf('id="listView"') >= 0 && html.indexOf('id="chatFilterBar"') > html.indexOf('id="listView"'))) {
    throw new Error("Chat filters must be placed after the chat list.");
  }
  if (!html.includes('id="pollsButton" class="icon-button feature-button hidden"')) {
    throw new Error("Top poll button must be hidden; polls should stay in the lower attachment menu.");
  }
  if (html.includes(".chat-tools #roomNoteButton,\n      .chat-tools #exportChatButton {\n        display: none;")) {
    throw new Error("Mobile layout must not hide room note or export buttons.");
  }
  if (!html.includes("function handleIosAction(")) throw new Error("index.html must wire iPhone action sheet buttons.");
  if (!html.includes("function handleTabbarAction(")) throw new Error("index.html must wire bottom tabbar buttons.");
  if (!html.includes("function updateTabbarState(")) throw new Error("index.html must keep tabbar state in sync.");
  if (!html.includes("initialOpenAttach") || !html.includes("openAttach")) throw new Error("index.html must support openAttach deep links for the action sheet.");
  if (!html.includes("--ios-blue: #2f8cff")) throw new Error("index.html must include iPhone blue design tokens.");
  if (!html.includes("backdrop-filter: blur(28px) saturate(1.45)")) throw new Error("index.html must include frosted glass blur styling.");
  if (!html.includes("grid-template-columns: repeat(7, minmax(0, 1fr))")) throw new Error("Mobile chat actions must use a stable 7-button grid.");
  if (!html.includes("grid-template-columns: repeat(6, minmax(0, 1fr))")) throw new Error("Mobile chat tools must use a stable 6-column grid.");
  if (!html.includes('id="pollPanel"')) throw new Error("Poll panel must exist.");
  if (!html.includes('id="tasksPanel"')) throw new Error("Tasks panel must exist.");
  if (!html.includes('id="eventsPanel"')) throw new Error("Events panel must exist.");
  if (!html.includes("room-feature-chip")) throw new Error("index.html must include designed room feature chips.");
  if (!html.includes("scroll-snap-type: x proximity")) throw new Error("index.html must include mobile action rail snapping.");
  if (!html.includes("grid-template-columns: repeat(4, minmax(0, 1fr))")) throw new Error("index.html must use a stable 4-column mobile tool grid.");
  if (!html.includes("min-height: 100dvh")) throw new Error("index.html must use full-height mobile panels.");
  if (!html.includes("button:last-child:nth-child(odd)")) throw new Error("index.html must balance odd mobile action buttons.");
  if (!html.includes(".profile-card::before")) throw new Error("index.html must include mobile sheet drag handle styling.");
  if (!html.includes(".profile-card > h2:first-child")) throw new Error("index.html must include sticky mobile panel headings.");
  if (!html.includes("max(10px, env(safe-area-inset-bottom))")) throw new Error("index.html must respect mobile safe-area spacing.");
  if (!html.includes("function saveMessage(")) throw new Error("index.html must include saved-message flow.");
  if (!html.includes("function toggleFavoriteRoom(")) throw new Error("index.html must include favorite-room flow.");
  if (!html.includes("function toggleMuteRoom(")) throw new Error("index.html must include muted-room flow.");
  if (!html.includes("function forwardMessage(")) throw new Error("index.html must include message forwarding flow.");
  if (!html.includes("function exportCurrentChat(")) throw new Error("index.html must include chat export flow.");
  if (!html.includes("function editRoomNote(")) throw new Error("index.html must include private room notes.");
  if (!html.includes("function applySlashCommand(")) throw new Error("index.html must include slash commands.");
  if (!html.includes("function openPollPanel(")) throw new Error("index.html must include poll panel flow.");
  if (!html.includes("function createPoll(")) throw new Error("index.html must include poll creation.");
  if (!html.includes("function votePoll(")) throw new Error("index.html must include poll voting.");
  if (!html.includes("function openTasksPanel(")) throw new Error("index.html must include task board flow.");
  if (!html.includes("function createTask(")) throw new Error("index.html must include task creation.");
  if (!html.includes("function updateTask(")) throw new Error("index.html must include task status updates.");
  if (!html.includes("function openEventsPanel(")) throw new Error("index.html must include room events flow.");
  if (!html.includes("function createRoomEvent(")) throw new Error("index.html must include room event creation.");
  if (!html.includes("function rsvpRoomEvent(")) throw new Error("index.html must include event RSVP.");
  if (!html.includes('id="schedulePanel"')) throw new Error("Schedule panel must exist.");
  if (!html.includes("function openSchedulePanel(")) throw new Error("index.html must include scheduled-message panel flow.");
  if (!html.includes("function createScheduledMessage(")) throw new Error("index.html must include scheduled-message creation.");
  if (!html.includes("function deleteScheduledMessage(")) throw new Error("index.html must include scheduled-message deletion.");
  if (!html.includes("function captureComposerState(")) throw new Error("index.html must preserve composer state during live updates.");
  if (!html.includes("function restoreComposerState(")) throw new Error("index.html must restore composer state during live updates.");
  if (!html.includes("loadRooms({ preserveComposer: true })")) throw new Error("incoming live room updates must preserve composer input.");
  if (html.includes('if (data.roomId === state.roomId) openRoom(state.roomId, true)')) {
    throw new Error("read events must not reopen the room and break typing.");
  }
  if (!html.includes("feature-dot")) throw new Error("index.html must include feature badges.");
  if (!html.includes("task-board")) throw new Error("index.html must include task board styling.");
  if (!html.includes("function draftForRoom(")) throw new Error("index.html must include per-room drafts.");
  if (!html.includes("function copyMessageText(")) throw new Error("index.html must include message text copy.");
  if (!html.includes("function copyMessageLink(")) throw new Error("index.html must include message deep-link copy.");
  if (!html.includes("function toggleAdminBlockUser(")) throw new Error("index.html must include admin block flow.");
  if (!html.includes("function toggleAdminPremium(")) throw new Error("index.html must include admin premium flow.");
  if (!html.includes("function submitPremiumRequest(")) throw new Error("index.html must include premium request submission flow.");
  if (!html.includes("function renderPremiumRequestsPanel(")) throw new Error("index.html must render admin-only premium requests.");
  if (!html.includes("function handlePremiumRequestAction(")) throw new Error("index.html must include admin premium request actions.");
  if (!html.includes("function deleteAccountAdmin(")) throw new Error("index.html must include admin delete flow.");
  if (!html.includes("/api/admin-login")) throw new Error("index.html must include admin login API call.");
  if (!html.includes("/api/admin/block")) throw new Error("index.html must include admin block API call.");
  if (!html.includes("/api/admin/premium")) throw new Error("index.html must include admin premium API call.");
  if (!html.includes("/api/premium/request")) throw new Error("index.html must include premium request API call.");
  if (!html.includes("/api/admin/premium-requests")) throw new Error("index.html must include admin premium requests API call.");
  if (!html.includes("/api/admin/delete-account")) throw new Error("index.html must include admin delete API call.");
  if (!html.includes("/api/admin/rooms")) throw new Error("index.html must include admin room audit API call.");
  if (!html.includes("/api/admin/messages")) throw new Error("index.html must include admin message audit API call.");
  if (!html.includes("/api/admin/messages/delete")) throw new Error("index.html must include admin message delete API call.");
  if (!html.includes("function renderAdminModerationPanel(")) throw new Error("index.html must render admin conversation moderation panel.");
  if (!html.includes("function deleteMessageAdmin(")) throw new Error("index.html must include admin message deletion flow.");
  if (!html.includes("data-admin-delete-message")) throw new Error("index.html must include admin delete-message controls.");
  if (!html.includes("admin-report-card")) throw new Error("index.html must render detailed admin reports.");
  if (!html.includes("initialMessageId")) throw new Error("index.html must support message deep links.");
  if (!html.includes("function copyAppLink()")) throw new Error("index.html must include copyAppLink().");
  if (!html.includes("/api/push-test")) throw new Error("index.html must include push test flow.");
  if (html.includes("/api/events?token=")) throw new Error("EventSource must not put the auth token in the URL.");
  if (html.includes("localStorage.setItem(\"orbit-token\"")) throw new Error("New sessions must not store auth tokens in localStorage.");
  if (!html.includes("/api/security")) throw new Error("index.html must include security center API calls.");
  new Function(script[1]);
}

function checkPackageAndRenderConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.version !== "1.5.7") throw new Error("package.json version must be 1.5.7.");
  if (!pkg.dependencies?.nodemailer) throw new Error("package.json must include nodemailer for SMTP verification emails.");
  if (!pkg.dependencies?.pg) throw new Error("package.json must include pg for optional PostgreSQL storage.");
  if (pkg.scripts?.check !== "node qa-check.js") throw new Error("package.json check script must run qa-check.js.");
  if (pkg.scripts?.["smoke:orbit"] !== "node orbit-plus-smoke-test.js") throw new Error("package.json must include the Orbit+ smoke test script.");
  if (!fs.existsSync(path.join(root, "orbit-plus-smoke-test.js"))) throw new Error("orbit-plus-smoke-test.js is missing.");
  if (!fs.existsSync(path.join(root, "PHONE_PUSH_GUIDE.md"))) throw new Error("PHONE_PUSH_GUIDE.md is missing.");
  if (!fs.existsSync(path.join(root, "SECURITY.md"))) throw new Error("SECURITY.md is missing.");
  for (const file of ["privacy.html", "support.html", "terms.html", "community-guidelines.html"]) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is missing.`);
  }
  const terms = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  for (const required of [
    "Пользовательское соглашение Orbit Chat",
    "Запрещенный контент",
    "Модерация, жалобы и блокировка",
    "Условия для Apple App Store",
    "Выйти из аккаунта можно",
    "/privacy.html",
    "/support.html",
    "/community-guidelines.html"
  ]) {
    if (!terms.includes(required)) throw new Error(`terms.html missing: ${required}`);
  }
  for (const file of [
    "app-store-package/APP_STORE_SUBMISSION.md",
    "app-store-package/APP_STORE_CONNECT_STEPS_RU.md",
    "app-store-package/APP_STORE_DESCRIPTION_RU.md",
    "app-store-package/APP_PRIVACY_LABEL.md",
    "app-store-package/REVIEW_NOTES.md",
    "app-store-package/store.config.json",
    "app-store-package/ios-wrapper/App.js",
    "app-store-package/ios-wrapper/app.json",
    "app-store-package/ios-wrapper/eas.json",
    "app-store-package/ios-wrapper/assets/icon-1024.png"
  ]) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is missing.`);
  }
  const renderYaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  if (!renderYaml.includes("healthCheckPath: /api/health")) throw new Error("render.yaml must include healthCheckPath: /api/health.");
  if (renderYaml.includes("disk:")) throw new Error("render.yaml should not require Render Disk by default.");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  if (!server.includes("callInvites")) throw new Error("server.js must include stored call invites.");
  if (!server.includes("normalizeMimeType")) throw new Error("server.js must normalize MIME types with parameters.");
  if (!server.includes("falling back")) throw new Error("server.js must include DATA_DIR fallback for Render startup.");
  if (!server.includes("STATIC_FILES")) throw new Error("server.js must lock static files to an allowlist.");
  if (server.includes('"access-control-allow-origin": "*"')) throw new Error("server.js must not allow wildcard CORS.");
  if (!server.includes("validatePasswordStrength")) throw new Error("server.js must validate password strength.");
  if (!server.includes("LOGIN_FAIL_LIMIT")) throw new Error("server.js must lock repeated login failures.");
  if (!server.includes("SESSION_COOKIE")) throw new Error("server.js must support HttpOnly session cookies.");
  if (!server.includes("canAccessUpload")) throw new Error("server.js must authorize uploaded files.");
  if (!server.includes("sniffMime")) throw new Error("server.js must verify uploaded file signatures.");
  if (!server.includes("audio/aac")) throw new Error("server.js must support AAC voice-message uploads.");
  if (!server.includes("normalizedVoiceMime")) throw new Error("server.js must normalize phone/browser voice MIME quirks.");
  if (!server.includes("uploadDuration")) throw new Error("server.js must preserve voice message duration metadata.");
  if (!server.includes("/api/messages/save")) throw new Error("server.js must include saved-message endpoint.");
  if (!server.includes("/api/rooms/favorite")) throw new Error("server.js must include favorite-room endpoint.");
  if (!server.includes("/api/rooms/mute")) throw new Error("server.js must include room mute endpoint.");
  if (!server.includes("/api/messages/forward")) throw new Error("server.js must include message forwarding endpoint.");
  if (!server.includes("mutedRoomIds")) throw new Error("server.js must persist muted rooms.");
  if (!server.includes("forwardedFrom")) throw new Error("server.js must preserve forwarded message metadata.");
  if (!server.includes("/api/polls")) throw new Error("server.js must include polls endpoint.");
  if (!server.includes("/api/polls/vote")) throw new Error("server.js must include poll voting endpoint.");
  if (!server.includes("/api/tasks")) throw new Error("server.js must include task board endpoint.");
  if (!server.includes("/api/tasks/update")) throw new Error("server.js must include task update endpoint.");
  if (!server.includes("/api/room-events")) throw new Error("server.js must include room events endpoint.");
  if (!server.includes("/api/room-events/rsvp")) throw new Error("server.js must include event RSVP endpoint.");
  if (!server.includes("roomFeatureCounts")) throw new Error("server.js must include room feature counters.");
  if (!server.includes('if (roomId === "global") return false;')) throw new Error("server.js must reject the removed global chat.");
  if (server.includes("const roomIds = new Set([\"global\"]")) throw new Error("Admin room list must not inject the removed global chat.");
  if (!server.includes("/api/admin-login")) throw new Error("server.js must include admin login endpoint.");
  if (!server.includes("/api/admin/block")) throw new Error("server.js must include admin block endpoint.");
  if (!server.includes("/api/admin/premium")) throw new Error("server.js must include admin premium endpoint.");
  if (!server.includes("/api/premium/request")) throw new Error("server.js must include premium request endpoint.");
  if (!server.includes("/api/admin/premium-requests")) throw new Error("server.js must include admin premium request endpoint.");
  if (!server.includes("premiumRequests")) throw new Error("server.js must persist premium requests.");
  if (!server.includes("pushPremiumRequestsToAdmins")) throw new Error("server.js must push premium requests only to admins.");
  if (!server.includes("PREMIUM_STICKERS")) throw new Error("server.js must restrict premium nickname stickers.");
  if (!server.includes("premiumGrantedAt")) throw new Error("server.js must persist premium status.");
  if (!server.includes("pushAccountUpdate")) throw new Error("server.js must push live account updates.");
  if (!server.includes("banAccountByAdmin")) throw new Error("server.js must include strict admin ban helper.");
  if (!server.includes("banVersion")) throw new Error("server.js must invalidate old sessions after admin bans.");
  if (!server.includes("disconnectUserClients")) throw new Error("server.js must disconnect live clients after admin bans.");
  if (!server.includes("/api/admin/delete-account")) throw new Error("server.js must include admin delete endpoint.");
  if (!server.includes("/api/admin/rooms")) throw new Error("server.js must include admin room audit endpoint.");
  if (!server.includes("/api/admin/messages")) throw new Error("server.js must include admin message audit endpoint.");
  if (!server.includes("/api/admin/messages/delete")) throw new Error("server.js must include admin message deletion endpoint.");
  if (!server.includes("listAdminRooms")) throw new Error("server.js must include admin room listing helper.");
  if (!server.includes("deleteMessageByAdmin")) throw new Error("server.js must include admin message deletion helper.");
  if (!server.includes("deleteAccountByAdmin")) throw new Error("server.js must include admin account deletion cleanup.");
  if (!server.includes("ADMIN_LOGIN_PASSWORD")) throw new Error("server.js must include admin login password support.");
  if (!server.includes("isSystemAdmin")) throw new Error("server.js must include system admin account support.");
  if (!server.includes("bannedAt")) throw new Error("server.js must include account ban support.");
  if (!server.includes("savedMessageIds")) throw new Error("server.js must persist saved message ids.");
  if (!server.includes("favoriteRoomIds")) throw new Error("server.js must persist favorite room ids.");
  if (!server.includes("schemaVersion: 8")) throw new Error("server.js schemaVersion must be 8.");
  if (!server.includes("content-security-policy")) throw new Error("server.js must send a content security policy.");
  if (!server.includes("if (status >= 500) console.error(error);")) throw new Error("server.js must avoid stack traces for normal 4xx client errors.");
  if (!server.includes("/api/security/revoke-other-sessions")) throw new Error("server.js must include session revocation.");
  if (!server.includes("/api/account/delete")) throw new Error("server.js must include self-service account deletion.");
  if (!server.includes("deleteOwnAccount")) throw new Error("server.js must include self-delete cleanup helper.");
  for (const file of ["/privacy.html", "/support.html", "/terms.html", "/community-guidelines.html"]) {
    if (!server.includes(file)) throw new Error(`server.js static allowlist missing ${file}.`);
  }
  if (!server.includes("/api/email/verify")) throw new Error("server.js must include email verification endpoint.");
  if (!server.includes("/api/email/send-verification")) throw new Error("server.js must include resend verification endpoint.");
  if (!server.includes("Код подтверждения больше не нужен")) throw new Error("server.js must keep old request-code endpoint non-sending for compatibility.");
  if (!server.includes("legalAccepted")) throw new Error("server.js must require legal acceptance during registration.");
  if (!server.includes("termsAcceptedAt")) throw new Error("server.js must store terms acceptance timestamp.");
  if (!server.includes("privacyAcceptedAt")) throw new Error("server.js must store privacy acceptance timestamp.");
  if (server.includes("registered-email-code")) throw new Error("server.js must not require registration email-code flow.");
  if (!server.includes("REQUIRE_EMAIL_DELIVERY")) throw new Error("server.js must support REQUIRE_EMAIL_DELIVERY for strict email delivery.");
  if (!server.includes("function supportRoom(")) throw new Error("server.js must include support room helpers.");
  if (!server.includes("NFT_BACKGROUNDS") || !server.includes("NFT_SYMBOLS")) throw new Error("server.js must include NFT background and symbol catalogs.");
  if (!server.includes("const NFT_PHOTO_BACKGROUNDS") || !server.includes("function nftVariantMap(")) throw new Error("server.js must define real NFT photo background variants.");
  if (!server.includes("function nftVisibleBackgrounds(") || !server.includes("function nftVisibleSymbols(")) throw new Error("server.js must restrict NFT creation to real photo assets.");
  if (!server.includes("nftVariantImage(background, symbol)")) throw new Error("server.js must serialize exact NFT variant images.");
  if (!server.includes("900 + background.tier * 260")) throw new Error("server.js NFT prices must be raised above the old formula.");
  if (!server.includes("background.legacy || !symbol.image")) throw new Error("Server must block hidden legacy NFTs from primary purchases.");
  if (!server.includes("profileNftId") || !server.includes("profileNftFor") || !server.includes("/api/nft/profile")) throw new Error("server.js must expose public profile NFT support.");
  if (!server.includes("/api/nft/gift") || !server.includes("nftGiftRecipient") || !server.includes("nft-gifted")) throw new Error("server.js must support transferring NFT gifts between users.");
  if (!server.includes("NFT_SPRITE_IMAGE") || !server.includes("nft-variants-sprite.jpg") || !server.includes('requested.startsWith("/assets/nft/")')) throw new Error("server.js must expose the packed NFT photo sprite asset.");
  if (!server.includes('id: "duck-agent"') || !server.includes("variants.aurora")) throw new Error("server.js must attach photo NFT assets to gift symbols.");
  if (!server.includes("nftPrimaryPrice")) throw new Error("server.js must calculate dynamic NFT prices.");
  if (!server.includes("const OT_START_BALANCE = 0")) throw new Error("New accounts must start with 0 OT.");
  if (!server.includes("LEGACY_FREE_OT_START_BALANCE")) throw new Error("Server must clean old free 250 OT starter balances.");
  if (server.includes(".slice(0, 48)")) throw new Error("NFT market must expose all 600 price combinations so selected cards never show 0 OT.");
  if (!server.includes("nftStats")) throw new Error("server.js must persist NFT popularity stats.");
  if (!server.includes("otBalance")) throw new Error("server.js must persist OT balances.");
  if (!server.includes("function otRoom(")) throw new Error("server.js must include private OT purchase rooms.");
  if (!server.includes("/api/nft/market")) throw new Error("server.js must expose NFT market API.");
  if (!server.includes("/api/nft/buy")) throw new Error("server.js must expose primary NFT purchase API.");
  if (!server.includes("/api/nft/list")) throw new Error("server.js must expose NFT listing API.");
  if (!server.includes("/api/nft/buy-listing")) throw new Error("server.js must expose secondary NFT market purchase API.");
  if (!server.includes("/api/ot/purchase-request")) throw new Error("server.js must expose OT purchase request API.");
  if (!server.includes("/api/admin/ot/grant")) throw new Error("server.js must expose admin OT grant API.");
  if (!server.includes("OT_SPIN_COST") || !server.includes("OT_SPIN_REWARD_TABLE") || !server.includes("pickOtSpinReward")) throw new Error("server.js must include paid OT Spin reward logic.");
  for (const marker of ["isDiceBoxAsset", "dice-bank", "coin-streak", "ot-spin-battle"]) {
    if (!server.includes(marker)) throw new Error(`server.js missing new game/static marker: ${marker}.`);
  }
  for (const oldMarker of ["isOrbitModelAsset", "model/gltf-binary", "three.module.min", "GLTFLoader.js", "BufferGeometryUtils.js", "orbit-dice-renderer"]) {
    if (server.includes(oldMarker)) throw new Error(`server.js must not keep old dice model marker: ${oldMarker}.`);
  }
  for (const api of ["/api/orbit-plus", "/api/stories", "/api/stories/react", "/api/friends/request", "/api/friends/action", "/api/customization/buy", "/api/customization/equip", "/api/minigames/play", "/api/minigames/spin", "/api/pair-games/create", "/api/pair-games/play", "/api/pair-games/action", "/api/clans", "/api/preferences"]) {
    if (!server.includes(api)) throw new Error(`server.js must expose Orbit+ API: ${api}.`);
  }
  for (const stateKey of ["stories", "friendRequests", "clans", "miniGameRounds", "pairGameChallenges", "friendIds", "achievementIds", "customInventory", "notificationPrefs"]) {
    if (!server.includes(stateKey)) throw new Error(`server.js must persist Orbit+ state: ${stateKey}.`);
  }
  for (const helper of ["CUSTOMIZATION_CATALOG", "ACHIEVEMENT_CATALOG", "orbitPlusData", "pushOrbitPlus", "grantAchievement", "addXp", "profilePower"]) {
    if (!server.includes(helper)) throw new Error(`server.js missing Orbit+ helper: ${helper}.`);
  }
  for (const marker of ["reactor", "memory", "signal", "arcade-rookie", "reactor-master", "story-spark", "style-maker", "social-core", "orbit-legend"]) {
    if (!server.includes(marker)) throw new Error(`server.js missing Orbit+ game/achievement marker: ${marker}.`);
  }
  if (!server.includes("function publicSenderForMessage(")) throw new Error("server.js must serialize admin support replies as support.");
  if (!server.includes("Поддержка Orbit")) throw new Error("server.js must expose support sender name.");
  if (!server.includes("/api/support/open")) throw new Error("server.js must expose support chat open API.");
  if (!server.includes('type: "support"')) throw new Error("server.js must serialize support rooms.");
  if (!server.includes("/api/email/confirm-code")) throw new Error("server.js must keep legacy email-code confirmation endpoint compatible.");
  if (!server.includes("email-changed-without-code")) throw new Error("server.js must save profile email without confirmation code.");
  if (!server.includes("/api/scheduled-messages")) throw new Error("server.js must include scheduled-message endpoints.");
  if (!server.includes("deliverScheduledMessages")) throw new Error("server.js must deliver scheduled messages.");
  if (!server.includes("scheduledFrom")) throw new Error("server.js must preserve scheduled message metadata.");
  if (!server.includes("/api/password/request-reset")) throw new Error("server.js must include password reset request endpoint.");
  if (!server.includes("/api/blocks")) throw new Error("server.js must include user blocking endpoint.");
  if (!server.includes("/api/groups/manage")) throw new Error("server.js must include group management endpoint.");
  if (!server.includes("DATABASE_URL")) throw new Error("server.js must support DATABASE_URL PostgreSQL storage.");
  if (!server.includes("POSTGRES_UPLOADS_TABLE")) throw new Error("server.js must support PostgreSQL upload storage.");
  if (!server.includes("visibleUsersFor")) throw new Error("server.js must avoid sending the full user directory to every client.");
  if (!server.includes("requesterIp")) throw new Error("server.js must track request IPs for security events.");
}

runNodeCheck("server.js");
runNodeCheck("sw.js");
runNodeCheck("orbit-plus-smoke-test.js");
checkManifest();
checkNftAssets();
checkClientScript();
checkPackageAndRenderConfig();

console.log("Orbit Chat QA check passed.");
