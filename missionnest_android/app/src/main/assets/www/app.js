const SUPABASE_URL = "https://nzgdfygljemhapabbsnf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__aqcIKiTLJeuNr9dFCDUXg_-LeRw44M";
const AUTH_REDIRECT_URL = "missionnest://auth/callback";
const SESSION_KEY = "missionnest_mobile_session_v1";
const app = document.getElementById("app");

let state = {
  session: loadSession(),
  view: "home",
  family: null,
  subscription: null,
  availableFamilies: [],
  familyAdults: [],
  familyJoinRequests: [],
  myJoinRequests: [],
  parentInvite: null,
  familyRole: "parent",
  incomingInvites: [],
  outgoingInvites: [],
  username: "",
  promptedInvites: [],
  children: [],
  categories: [],
  missions: [],
  assignments: [],
  quizAttempts: [],
  questionsByMission: {},
  selectedQuiz: null,
  previewQuiz: null,
  parentQuizReview: null,
  parentKidMonitor: null,
  parentMissionDetail: null,
  pendingQuizOpen: [],
  quizDraftForm: null,
  quizResult: null,
  quizFeedback: null,
  quizStep: 0,
  quizAnswers: {},
  notice: "",
  error: "",
};
let quizClockInterval = null;

init();

async function init() {
  if (location.hash.includes("email-confirmed")) {
    state.notice = "Email confirmed. Please login with your email and password.";
    history.replaceState(null, "", location.pathname);
  }
  render();
  if (state.session) await refreshData();
  if (state.session?.mode === "parent") await pollFamilyInvitations();
  setInterval(async () => {
    if (state.session && state.family) await pollSubscription();
    if (state.session?.mode === "parent") await pollFamilyInvitations();
    if (state.session && (state.family || state.session.mode === "parent") && !state.selectedQuiz && !state.previewQuiz && !state.parentMissionDetail && !byId("quizForm") && !byId("familyInviteDialog") && !isEditingField()) await refreshData(true);
  }, 9000);
}

async function refreshData(silent = false) {
  try {
    if (state.session.mode === "kid" && state.session.childId) {
      const childRows = await supabaseGet("mn_children", `id=eq.${encodeURIComponent(state.session.childId)}&limit=1`);
      const child = childRows[0];
      if (child) {
        const familyRows = await supabaseGet("mn_families", `id=eq.${encodeURIComponent(child.family_id)}&limit=1`);
        if (familyRows[0]) {
          state.session.familyCode = familyRows[0].family_code;
          setSession(state.session);
        }
      }
    }
    if (state.session.mode === "parent") {
      const userId = encodeURIComponent(state.session.userId);
      const [families, requests, profiles] = await Promise.all([
        loadParentFamilies(),
        supabaseGetOptional("mn_family_join_requests", `requester_user_id=eq.${userId}&order=created_at.desc`),
        supabaseGetOptional("mn_profiles", `user_id=eq.${userId}`),
      ]);
      state.availableFamilies = families;
      state.username = profiles[0]?.username || "";
      state.myJoinRequests = requests;
      const newlyApproved = requests.find(request => request.status === "approved" && state.availableFamilies.some(family => family.id === request.family_id) && !(state.session.seenApprovals || []).includes(request.id));
      if (newlyApproved) {
        state.session.familyId = newlyApproved.family_id;
        state.session.seenApprovals = [...(state.session.seenApprovals || []), newlyApproved.id];
      }
      const previousFamilyId = state.family?.id;
      state.family = state.availableFamilies.find(family => family.id === state.session.familyId) || state.availableFamilies[0] || null;
      if (previousFamilyId && previousFamilyId !== state.family?.id) resetFamilyViews();
      if (state.family) {
        state.session.familyId = state.family.id;
        state.session.familyCode = state.family.family_code;
        setSession(state.session);
      }
    } else {
      const families = await supabaseGet("mn_families", `family_code=eq.${encodeURIComponent(state.session.familyCode || "")}&limit=1`);
      state.family = families[0] || null;
    }
    if (!state.family) {
      if (state.session.mode === "parent") {
        state.children = [];
        state.categories = [];
        state.missions = [];
        state.assignments = [];
        state.quizAttempts = [];
        if (silent) {
          const requests = document.querySelector("[data-my-join-requests]");
          if (requests) requests.outerHTML = myFamilyRequestsHtml();
          return;
        }
        render();
        return;
      }
      clearSession();
      showError("Family code was not found. Please login again.");
      return;
    }
    const familyId = state.family.id;
    await loadSubscription();
    if (subscriptionBlocked()) { render(); return; }
    if (state.session.mode === "parent") {
      const [adults, requests, invites] = await Promise.all([
        supabaseGet("mn_adults", `family_id=eq.${encodeURIComponent(familyId)}&order=created_at.asc`),
        supabaseGetOptional("mn_family_join_requests", `family_id=eq.${encodeURIComponent(familyId)}&status=eq.pending&order=created_at.asc`),
        state.family.owner_user_id === state.session.userId ? supabaseGetOptional("mn_parent_invites", `family_id=eq.${encodeURIComponent(familyId)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc`) : [],
      ]);
      state.familyAdults = adults;
      state.familyRole = state.family.owner_user_id === state.session.userId ? "owner" : adults.find(adult => adult.user_id === state.session.userId)?.role || "parent";
      state.familyJoinRequests = requests;
      state.parentInvite = invites[0] || null;
      state.outgoingInvites = invites.filter(invite => invite.target_user_id && invite.status === "pending");
    }
    const [children, categories, missions, assignments, quizAttempts] = await Promise.all([
      isTutor() ? supabaseRequest("/rest/v1/rpc/mn_tutor_children", { method: "POST", body: JSON.stringify({ p_family_id: familyId }) }) : supabaseGet("mn_children", `family_id=eq.${familyId}&order=display_name.asc`),
      supabaseGet("mn_categories", `family_id=eq.${familyId}&order=name.asc`),
      supabaseGet("mn_missions", `family_id=eq.${familyId}&order=created_at.desc`),
      supabaseGet("mn_assignments", `family_id=eq.${familyId}&order=created_at.desc`),
      supabaseGetOptional("mn_quiz_attempts", `family_id=eq.${familyId}&order=created_at.desc`),
    ]);
    state.children = children;
    state.categories = categories;
    state.missions = missions;
    state.assignments = assignments;
    state.quizAttempts = quizAttempts;
    if (isTutor()) {
      state.missions = missions.filter(mission => tutorCanSeeMission(mission));
      const visible = new Set(state.missions.map(mission => mission.id));
      state.assignments = assignments.filter(item => visible.has(item.mission_id));
      state.quizAttempts = quizAttempts.filter(item => visible.has(item.mission_id));
    }
    state.error = "";
    if (state.session.mode === "kid" && !state.session.childId && state.session.childName) {
      const child = children.find((item) => item.display_name.toLowerCase() === state.session.childName.toLowerCase());
      if (child) state.session.childId = child.id;
    }
    // A refresh can finish after the parent has opened the quiz editor.
    if (silent && (byId("quizForm") || byId("familyInviteDialog") || state.parentMissionDetail || isEditingField())) return;
    render();
  } catch (error) {
    if (!silent) showError(error.message);
  }
}

function render() {
  if (state.session && state.family && subscriptionBlocked()) return renderSubscriptionGate();
  if (state.selectedQuiz) return renderQuiz();
  if (state.previewQuiz) return renderQuizPreview();
  if (state.parentQuizReview) return renderParentQuizReview();
  if (state.parentMissionDetail) return renderParentMissionDetail();
  if (state.parentKidMonitor) return renderParentKidMonitor();
  if (state.quizResult) return renderQuizResult();
  const session = state.session;
  if (!session) return renderAuth();
  if (session.mode === "kid") return renderKidShell();
  return renderParentShell();
}

function renderAuth() {
  app.className = "app";
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<span class="pill">Cloud Mode</span></div></header>
    <main class="shell grid grid-2">
      <section class="card hero">
        <span class="chip active">MissionNest</span>
        <h1 style="margin-top:12px;">Family missions, wherever you are</h1>
        <p class="muted">This APK talks directly to Supabase. No Django server, no local IP, no same-Wi-Fi requirement.</p>
        ${messageHtml()}
      </section>
      <section class="card">
        <h2>Parent Login</h2>
        <form id="parentLoginForm">
          ${field("Email", "email", "email", "parent@example.com")}
          ${field("Password", "password", "password", "Password")}
          <button class="btn btn-primary btn-wide" type="submit">Open Parent Dashboard</button>
        </form>
        <hr>
        <h2>Parent Sign Up</h2>
        <form id="setupForm">
          ${field("Email", "signup_email", "email", "parent@example.com")}
          ${field("Password", "signup_password", "password", "Minimum 6 characters")}
          <button class="btn btn-amber btn-wide" type="submit">Create Parent Account</button>
        </form>
        <hr>
        <h2>Kid Tablet Login</h2>
        <form id="kidLoginForm">
          ${field("Family code", "kid_family_code", "text", "ABC12345")}
          ${field("Child name", "kid_child_name", "text", "Xilia Marie")}
          ${field("Kid PIN", "kid_access_pin", "password", "Kid PIN")}
          <button class="btn btn-primary btn-wide" type="submit">Start Kid Mode</button>
        </form>
      </section>
    </main>`;
  byId("setupForm").addEventListener("submit", setupFamily);
  byId("parentLoginForm").addEventListener("submit", parentLogin);
  byId("kidLoginForm").addEventListener("submit", kidLogin);
}

function renderParentShell() {
  if (!state.family) return renderFamilySetup();
  const quizDraft = state.quizDraftForm;
  const views = {
    home: parentHome,
    mission: missionForm,
    quiz: quizForm,
    kids: kidsManager,
    family: familyManager,
    subscription: subscriptionPage,
  };
  if (isTutor() && state.view === "kids") state.view = "home";
  app.className = "app";
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<div class="family-header-actions">${state.family.owner_user_id === state.session.userId ? '<button class="btn" data-go="subscription">Subscription</button>' : ''}<button class="btn" data-go="family">Family</button><button class="btn" id="logoutBtn">Logout</button></div></div></header>
    <main class="shell">${messageHtml()}${(views[state.view] || parentHome)()}</main>
    <nav class="tabs ${isTutor() ? "tutor-tabs" : ""}">
      ${tab("home", "Home")}
      ${tab("mission", "Mission")}
      ${tab("quiz", "Quiz")}
      ${isTutor() ? "" : tab("kids", "Kids")}
    </nav>`;
  byId("logoutBtn").addEventListener("click", clearSession);
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.tab)));
  bindParentHandlers();
  bindSubscriptionHandlers();
  if (state.view === "quiz") {
    if (quizDraft) byId("quizForm").replaceWith(quizDraft);
    state.quizDraftForm = byId("quizForm");
  }
}

function renderFamilySetup() {
  app.className = "app";
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="logoutBtn">Logout</button></div></header>
    <main class="shell grid grid-2">
      <section class="card hero">
        <p class="tiny">Parent Onboarding</p>
        <h1>Create your family space</h1>
        <p class="muted">Create a family or join an existing family.</p>
        ${messageHtml()}
        ${incomingInvitationsHtml()}
        ${usernameSettingsHtml()}
        ${joinFamilyForm()}
        ${myFamilyRequestsHtml()}
      </section>
      <form class="card" id="familySetupForm">
        ${field("Family name", "family_name", "text", "My Family")}
        ${field("Parent name", "parent_name", "text", "Mom")}
        ${field("First child", "child_name", "text", "Xilia Marie")}
        ${field("Kid PIN", "kid_pin", "text", "1234")}
        <div class="field"><label for="subscriptionPlan">Subscription</label><select id="subscriptionPlan" name="subscription_plan"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></div>
        <button class="btn btn-primary btn-wide" type="submit">Request Family Activation</button>
      </form>
    </main>`;
  byId("logoutBtn").addEventListener("click", clearSession);
  byId("familySetupForm").addEventListener("submit", createFamilyForSignedInParent);
  bindFamilyHandlers();
}

async function loadParentFamilies() {
  try { return await supabaseRequest("/rest/v1/rpc/mn_list_my_families", { method: "POST", body: "{}" }); }
  catch (error) {
    if (!String(error.message).includes("PGRST202")) throw error;
    const userId = encodeURIComponent(state.session.userId);
    const owned = await supabaseGet("mn_families", `owner_user_id=eq.${userId}&order=created_at.asc`);
    const memberships = await supabaseGet("mn_adults", `user_id=eq.${userId}`);
    const ids = [...new Set(memberships.map(item => item.family_id))].filter(id => !owned.some(family => family.id === id));
    return [...owned, ...(ids.length ? await supabaseGet("mn_families", `id=in.(${ids.map(encodeURIComponent).join(",")})`) : [])];
  }
}

function isTutor() { return state.session?.mode === "parent" && Boolean(state.family) && state.familyRole === "tutor"; }
function isLessonsCategory(category) { return /^(lesson|lessons)$/i.test(String(category?.name || "").trim()); }
function tutorCanSeeMission(mission) {
  return mission.created_by === state.session.userId && (mission.mission_type === "quiz" || isLessonsCategory(state.categories.find(category => category.id === mission.category_id)));
}
function usernameSettingsHtml() {
  return `<section class="family-section"><h2>Your Username</h2><form id="usernameForm"><div class="field"><label for="familyUsername">Username</label><input id="familyUsername" name="username" value="${escapeAttr(state.username)}" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}" required autocomplete="username"></div><button class="btn" type="submit">Save Username</button><p id="usernameFeedback" role="status"></p></form></section>`;
}

function incomingInvitationsHtml() {
  return `<section class="family-section" data-incoming-invites>${state.incomingInvites.length ? `<h2>Family Invitations</h2>${state.incomingInvites.map(invite => `<article class="family-request-row"><div><h3>${escapeHtml(invite.family_name)}</h3><p>${escapeHtml(invite.inviter_name)} invited you as ${escapeHtml(invite.role)}.</p></div><div class="action-row"><button class="btn btn-primary" data-accept-invitation="${escapeAttr(invite.id)}">Accept</button><button class="btn btn-danger" data-decline-invitation="${escapeAttr(invite.id)}">Decline</button></div></article>`).join("")}` : ""}</section>`;
}

let invitationPollRunning = false;
async function pollFamilyInvitations(showPopup = true) {
  if (invitationPollRunning || state.session?.mode !== "parent") return;
  invitationPollRunning = true;
  const userId = state.session.userId;
  try {
    const invites = await supabaseRequest("/rest/v1/rpc/mn_my_family_invitations", { method: "POST", body: "{}" });
    if (state.session?.userId !== userId) return;
    state.incomingInvites = invites;
    document.querySelectorAll("[data-incoming-invites]").forEach(section => {
      const replacement = document.createElement("div");
      replacement.innerHTML = incomingInvitationsHtml();
      const next = replacement.firstElementChild;
      section.replaceWith(next);
      bindInvitationResponses(next);
    });
    if (state.family) {
      const families = await loadParentFamilies();
      if (!families.some(family => family.id === state.family.id)) {
        resetFamilyViews();
        state.view = "home";
        await refreshData();
        showNotice("Your access to the previous family has ended.");
      }
    }
    if (showPopup && !byId("familyInviteDialog")) {
      const invite = invites.find(item => !state.promptedInvites.includes(item.id));
      if (invite) {
        state.promptedInvites.push(invite.id);
        const dialog = document.createElement("dialog");
        dialog.id = "familyInviteDialog";
        dialog.className = "family-invite-dialog";
        dialog.setAttribute("aria-labelledby", "familyInvitationTitle");
        dialog.innerHTML = `<p class="tiny">Family Invitation</p><h2 id="familyInvitationTitle">${escapeHtml(invite.family_name)}</h2><p>${escapeHtml(invite.inviter_name)} invited you as ${escapeHtml(invite.role)}.</p><div class="action-row"><button class="btn" data-later-invitation>Later</button><button class="btn btn-danger" data-decline-invitation="${escapeAttr(invite.id)}">Decline</button><button class="btn btn-primary" data-accept-invitation="${escapeAttr(invite.id)}">Accept</button></div><p role="alert" data-invite-response-error></p>`;
        document.body.append(dialog);
        dialog.addEventListener("cancel", () => dialog.remove());
        dialog.querySelector("[data-later-invitation]").addEventListener("click", () => dialog.remove());
        bindInvitationResponses(dialog);
        dialog.showModal();
      }
    }
  } catch (error) {
    // Older databases can keep using code invitations until the migration is applied.
    if (!/PGRST20[25]/.test(String(error.message))) state.invitationPollError = familySharingError(error);
  } finally { invitationPollRunning = false; }
}

function bindInvitationResponses(root) {
  root.querySelectorAll("[data-accept-invitation], [data-decline-invitation]").forEach(button => {
    if (button.dataset.invitationBound) return;
    button.dataset.invitationBound = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const accept = Boolean(button.dataset.acceptInvitation);
      const id = button.dataset.acceptInvitation || button.dataset.declineInvitation;
      try {
        const familyId = await familyRpc("mn_respond_family_invitation", { p_invite_id: id, p_accept: accept });
        state.incomingInvites = state.incomingInvites.filter(invite => invite.id !== id);
        byId("familyInviteDialog")?.remove();
        if (accept) {
          resetFamilyViews();
          state.session.familyId = familyId;
          state.view = "home";
          setSession(state.session);
        }
        await refreshData();
        showNotice(accept ? "Invitation accepted. You have joined the family." : "Invitation declined.");
      } catch (error) {
        const alert = document.querySelector("[data-invite-response-error]");
        if (alert) alert.textContent = familySharingError(error); else showError(familySharingError(error));
      } finally { button.disabled = false; }
    });
  });
}

function joinFamilyForm() {
  return `<section class="family-section"><h2>Join Existing Family</h2>
    <form id="joinFamilyForm">
      <div class="field"><label for="joinParentName">Your name</label><input id="joinParentName" name="parent_name" required></div>
      <div class="field"><label for="joinInvitationCode">Parent invitation code</label><input id="joinInvitationCode" name="invitation_code" required autocapitalize="characters" autocomplete="off"></div>
      <button class="btn btn-primary" type="submit">Request to Join</button>
      <p id="joinFamilyFeedback" role="status"></p>
    </form></section>`;
}

function myFamilyRequestsHtml() {
  return `<section class="family-section" data-my-join-requests>${state.myJoinRequests.length ? `<h2>Your Join Requests</h2>${state.myJoinRequests.map(request => `<div class="family-member-row"><span>${escapeHtml(request.role === "guardian" ? "Guardian" : "Parent")} invitation</span><span class="chip">${escapeHtml(request.status === "pending" ? "Awaiting approval" : request.status)}</span></div>`).join("")}` : ""}</section>`;
}

function familyManager() {
  const owner = state.family.owner_user_id === state.session.userId;
  return `<section class="section-title"><div><p class="tiny">${escapeHtml(state.family.name)}</p><h1>Family &amp; Guardians</h1></div></section>
    ${state.availableFamilies.length > 1 ? `<div class="field"><label for="activeFamilySelect">Active family</label><select id="activeFamilySelect">${state.availableFamilies.map(family => `<option value="${escapeAttr(family.id)}" ${state.family.id === family.id ? "selected" : ""}>${escapeHtml(family.name)}</option>`).join("")}</select></div>` : ""}
    ${incomingInvitationsHtml()}
    ${usernameSettingsHtml()}
    ${owner ? `<section class="family-section"><h2>Invite Family Member</h2>
      <form id="parentInviteForm"><div class="field"><label for="inviteRecipient">Registered email or username</label><input id="inviteRecipient" name="recipient" required autocomplete="off"></div><div class="field"><label for="inviteRole">Invite as</label><select name="role" id="inviteRole"><option value="parent">Parent</option><option value="guardian">Guardian</option><option value="tutor">Tutor</option></select></div><button class="btn btn-primary" type="submit">Create New Invitation</button><p id="inviteFeedback" role="status"></p></form>
      ${state.outgoingInvites.length ? `<h3>Sent Invitations</h3>${state.outgoingInvites.map(invite => `<div class="family-member-row"><span>${escapeHtml(invite.target_email)} · ${escapeHtml(invite.role)}</span><span class="chip">Awaiting response</span></div>`).join("")}` : ""}
    </section>
    <section class="family-section"><h2>Awaiting Your Approval</h2>${state.familyJoinRequests.length ? state.familyJoinRequests.map(request => `<article class="family-request-row"><div><h3>${escapeHtml(request.display_name)}</h3><p>${escapeHtml(request.email)}</p><span class="chip">${escapeHtml(request.role)}</span></div><div class="action-row"><button class="btn btn-primary" data-approve-family-join="${escapeAttr(request.id)}">Approve</button><button class="btn btn-danger" data-decline-family-join="${escapeAttr(request.id)}">Decline</button></div></article>`).join("") : `<p class="muted">No pending requests.</p>`}</section>` : ""}
    <section class="family-section"><h2>Family Members</h2>${state.familyAdults.map(adult => `<div class="family-member-row"><strong>${escapeHtml(adult.display_name)}</strong><div class="family-header-actions"><span class="chip">${escapeHtml(adult.role)}</span>${owner && adult.user_id !== state.family.owner_user_id && adult.role !== "owner" ? `<button class="btn btn-danger" data-disconnect-member="${escapeAttr(adult.id)}">Disconnect</button>` : ""}</div></div>`).join("") || '<p class="muted">No additional members.</p>'}</section>
    ${joinFamilyForm()}${myFamilyRequestsHtml()}`;
}

function resetFamilyViews() {
  state.quizDraftForm = null;
  state.parentKidMonitor = null;
  state.parentMissionDetail = null;
  state.parentQuizReview = null;
  state.previewQuiz = null;
  state.pendingQuizOpen = [];
}

function familySharingError(error) {
  const text = String(error.message || error);
  if (/PGRST20[245]/.test(text)) return "Family invitations need setup. Run direct_invitations_and_tutors.sql after family_invitations.sql in your Supabase SQL Editor.";
  try { const parsed = JSON.parse(text); return parsed.message || text; } catch { return text; }
}

async function familyRpc(name, body) {
  const result = await supabaseRequest(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  return Array.isArray(result) ? result[0] : result;
}

function bindFamilyHandlers() {
  byId("parentInviteForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const form = new FormData(event.target);
      await familyRpc("mn_send_family_invitation", { p_family_id: state.family.id, p_recipient: val(form, "recipient"), p_role: val(form, "role") });
      await refreshData();
      showNotice("Invitation sent. The recipient can accept or decline in their app.");
    } catch (error) { byId("inviteFeedback").textContent = familySharingError(error); }
    finally { button.disabled = false; }
  });
  byId("usernameForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const profile = await familyRpc("mn_set_username", { p_username: val(new FormData(event.target), "username") });
      state.username = profile.username;
      byId("usernameFeedback").textContent = "Username saved.";
    } catch (error) { byId("usernameFeedback").textContent = familySharingError(error); }
  });
  document.querySelectorAll("[data-disconnect-member]").forEach(button => button.addEventListener("click", async () => {
    const member = state.familyAdults.find(adult => adult.id === button.dataset.disconnectMember);
    if (!member || !confirm(`Disconnect ${member.display_name} from this family?`)) return;
    button.disabled = true;
    try {
      await familyRpc("mn_disconnect_family_member", { p_adult_id: member.id });
      await refreshData();
      showNotice("Family member disconnected.");
    } catch (error) { showError(familySharingError(error)); }
    finally { button.disabled = false; }
  }));
  bindInvitationResponses(document);
  byId("joinFamilyForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await familyRpc("mn_request_family_join", { p_code: val(form, "invitation_code"), p_display_name: val(form, "parent_name") });
      await refreshData();
      showNotice("Request sent. The family owner must approve it before you can access the family.");
    } catch (error) { byId("joinFamilyFeedback").textContent = familySharingError(error); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll("[data-approve-family-join], [data-decline-family-join]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const approve = Boolean(button.dataset.approveFamilyJoin);
      await familyRpc("mn_decide_family_join", { p_request_id: button.dataset.approveFamilyJoin || button.dataset.declineFamilyJoin, p_approve: approve });
      await refreshData();
      showNotice(approve ? "Family member approved." : "Join request declined.");
    } catch (error) { showError(familySharingError(error)); }
    finally { button.disabled = false; }
  }));
  byId("activeFamilySelect")?.addEventListener("change", async event => {
    state.session.familyId = event.target.value;
    resetFamilyViews();
    setSession(state.session);
    await refreshData();
  });
  byId("copyParentInviteBtn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.parentInvite.code);
      byId("copyInviteFeedback").textContent = "Invitation code copied.";
    } catch {
      const input = document.createElement("textarea");
      input.value = state.parentInvite.code;
      input.readOnly = true;
      input.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.append(input);
      input.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch {}
      input.remove();
      byId("copyInviteFeedback").textContent = copied ? "Invitation code copied." : "Select the invitation code above to copy it.";
    }
  });
}

function renderKidShell() {
  const child = currentChild();
  const assignments = child ? childAssignments(child.id).filter((item) => item.status !== "approved") : [];
  app.className = "app";
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="logoutBtn">Switch</button></div></header>
    <main class="shell">
      ${messageHtml()}
      <section class="card hero">
        <p class="tiny">Kid Tablet</p>
        <h1>Hi ${escapeHtml(child?.display_name || state.session.childName || "Explorer")}!</h1>
        <p class="muted">${assignments.length} open quest${assignments.length === 1 ? "" : "s"} waiting.</p>
      </section>
      <section class="section-title"><h2>Quest List</h2><span class="chip">${child?.stars || 0} stars</span></section>
      <section class="grid">${assignments.length ? assignments.map(kidAssignmentCard).join("") : empty("All missions clear", "New missions and quizzes will appear here.")}</section>
    </main>`;
  byId("logoutBtn").addEventListener("click", clearSession);
  document.querySelectorAll("[data-kid-open]").forEach((button) => button.addEventListener("click", () => openKidAssignment(button.dataset.kidOpen)));
  document.querySelectorAll("[data-start-quiz]").forEach((button) => button.addEventListener("click", () => startQuiz(button.dataset.startQuiz)));
  document.querySelectorAll("[data-kid-progress]").forEach((form) => {
    form.addEventListener("submit", saveKidProgress);
    form.addEventListener("input", updateCommentLinkPreview);
  });
  document.querySelectorAll("[data-submit-mission]").forEach((button) => button.addEventListener("click", () => submitMission(button.dataset.submitMission, button.closest("form"))));
  document.querySelectorAll("[data-timer-action]").forEach((button) => button.addEventListener("click", () => updateAssignmentTimer(button.dataset.timerAction, button.dataset.timerAssignment)));
}

function parentHome() {
  return `
    <section class="card hero">
      <div class="row">
        <div>
          <p class="tiny">Family Command Hub</p>
          <h1>${escapeHtml(state.family?.name || "Family")}</h1>
          <p class="muted">${isTutor() ? "Tutor access" : "Family code for parents and kid tablets"}</p>
          <button class="btn" data-go="family">Family &amp; Guardians${state.familyJoinRequests.length ? ` (${state.familyJoinRequests.length} pending)` : ""}</button>
        </div>
        ${isTutor() ? "" : `<div class="code">${escapeHtml(state.family?.family_code || "")}</div>`}
      </div>
    </section>
    <section class="section-title">
      <h2>Kids Monitor</h2>
      <div class="action-row">
        <button class="btn btn-primary" data-go="mission">${isTutor() ? "New Lesson" : "New Mission"}</button>
        <button class="btn btn-amber" data-go="quiz">Create Quiz</button>
      </div>
    </section>
    <section class="tile-grid">${state.children.length ? state.children.map(parentKidTile).join("") : empty("No kids yet", "Add child profiles in the Kids tab.")}</section>
    ${pendingQuizList()}
    ${quizSummaryHtml()}`;
}

function missionForm() {
  return `
    <section class="section-title"><div><p class="tiny">Mission Builder</p><h1>Create Mission</h1></div></section>
    <form class="card" id="missionForm">
      ${field("Title", "title", "text", "Clean study desk")}
      ${categoryPicker()}
      ${missionInstructionEditor()}
      ${field("Reward stars", "reward_stars", "number", "25", "25")}
      ${recipientSection()}
      <button class="btn btn-primary btn-wide" type="submit" style="margin-top:12px;">Launch Mission</button>
    </form>`;
}

function missionInstructionEditor() {
  return `
    <section class="worksheet-wrap">
      <div class="row">
        <label class="field-label">Instructions</label>
        <button class="btn" type="button" id="addInstructionRowBtn">Add Row</button>
      </div>
      <div class="worksheet-scroll">
        <table class="worksheet-table instruction-editor-table">
          <thead>
            <tr>
              <th>Instructions</th>
              <th>Check if done</th>
              <th>Kid's Comment</th>
              <th>Parent's Comment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="instructionRows">
            ${missionInstructionEditorRow()}
            ${missionInstructionEditorRow()}
          </tbody>
        </table>
      </div>
    </section>`;
}

function missionInstructionEditorRow(value = "") {
  return `
    <tr>
      <td><input name="instruction_row" value="${escapeAttr(value)}" aria-label="Instruction"><div class="instruction-link-preview">${instructionLinkPreview(value)}</div></td>
      <td class="center-cell"><input type="checkbox" disabled></td>
      <td><textarea readonly aria-label="Kid's comment"></textarea></td>
      <td><textarea readonly aria-label="Parent's comment"></textarea></td>
      <td><button class="btn btn-danger" type="button" data-delete-instruction-row>Delete</button></td>
    </tr>`;
}

function quizForm() {
  return `
    <section class="section-title"><div><p class="tiny">AI Quiz Builder</p><h1>Create Quiz</h1></div></section>
    <form class="card" id="quizForm">
      ${field("Title", "title", "text", "Science Quiz")}
      ${field("Subject", "subject", "text", "Science")}
      ${field("Reward stars", "reward_stars", "number", "50", "50")}
      <div class="field"><label for="quizTiming">Timing</label>
        <select id="quizTiming" name="quiz_timing"><option value="open">Open time</option><option value="limited">Time limit</option></select>
      </div>
      <div class="field hidden" id="quizLimitField"><label for="quizMinutes">Time limit (minutes)</label>
        <input id="quizMinutes" name="quiz_minutes" type="number" min="1" max="1440" step="1" value="10">
      </div>
      <div class="field">
        <label>Quiz type</label>
        <select name="quiz_type" id="quizTypeSelect">
          <option value="multiple_choice">Multiple choice</option>
          <option value="fill_blank">Fill in the blanks</option>
          <option value="flash_card">Flash cards</option>
        </select>
      </div>
      <div id="multipleChoiceSource">
        <fieldset class="quiz-source-options"><legend>Question source</legend>
          <label><input type="radio" name="mc_source" value="paste" checked> Paste questions</label>
          <label><input type="radio" name="mc_source" value="csv"> Upload CSV</label>
          <label><input type="radio" name="mc_source" value="manual"> Enter manually</label>
        </fieldset>
        <div id="mcPasteSource">
        ${textArea("Paste multiple-choice questions", "source_text", "Use Q:/A)/B)/Answer: B or numbered worksheet with Answer Key")}
        </div>
        <div id="mcCsvSource" class="hidden grid grid-2">
          <div class="field"><label for="mcCsvFile">CSV file</label><input id="mcCsvFile" name="mc_csv" type="file" accept=".csv,text/csv"></div>
          <figure class="csv-format"><figcaption>CSV format</figcaption>
            <div class="quiz-table-scroll"><table class="mc-csv-format"><thead><tr><th>Question</th><th>Choice A</th><th>Choice B</th><th>Choice C</th><th>Choice D</th><th>Answer Key</th><th>Explanation</th></tr></thead>
            <tbody><tr><td>First book of the Bible?</td><td>Exodus</td><td>Genesis</td><td>Psalms</td><td>Matthew</td><td>B</td><td>Genesis is the first book.</td></tr></tbody></table></div>
            <small>One question per row. Answer Key: A–D or Choice A–D (any capitalization). Explanation is optional. Put text containing commas inside double quotes.</small>
          </figure>
        </div>
        <section id="mcManualSource" class="hidden">
          <div class="action-row"><button class="btn" type="button" id="addMcRowBtn">Add Row</button></div>
          <div class="quiz-table-scroll"><table class="quiz-entry-table mc-entry-table">
            <thead><tr><th>Question</th><th>Choice A</th><th>Choice B</th><th>Choice C</th><th>Choice D</th><th>Answer Key</th><th>Explanation (optional)</th><th>Action</th></tr></thead>
            <tbody id="mcManualRows">${multipleChoiceManualRow()}</tbody>
          </table></div>
        </section>
        <div id="mcSourceError" role="alert" class="error hidden"></div>
      </div>
      <div id="csvQuizSource" class="hidden">
        <fieldset class="quiz-source-options">
          <legend>Question source</legend>
          <label><input type="radio" name="question_source" value="csv" checked> Upload CSV</label>
          <label><input type="radio" name="question_source" value="manual"> Enter manually</label>
        </fieldset>
        <div id="quizCsvUpload" class="grid grid-2">
          <div class="field">
            <label for="quizCsvFile">CSV file</label>
            <input id="quizCsvFile" name="quiz_csv" type="file" accept=".csv,text/csv">
          </div>
          <figure class="csv-format">
            <figcaption>CSV format</figcaption>
            <table><thead><tr><th>Question</th><th>Answer</th></tr></thead>
              <tbody><tr><td>What is used to type?</td><td>Keyboard</td></tr><tr><td>The capital is ____.</td><td>Manila</td></tr></tbody>
            </table>
            <small>Two columns: Question, Answer. Save as CSV.</small>
          </figure>
        </div>
        <section id="quizManualEntry" class="hidden">
          <div class="action-row"><button class="btn" type="button" id="addQuizRowBtn">Add Row</button></div>
          <div class="quiz-table-scroll"><table class="quiz-entry-table">
            <thead><tr><th>Question</th><th>Answer</th><th><span class="muted">Action</span></th></tr></thead>
            <tbody id="quizManualRows">${quizManualRow()}</tbody>
          </table></div>
        </section>
        <div id="quizSourceError" role="alert" class="error hidden"></div>
      </div>
      ${recipientSection()}
      <div class="grid grid-2" style="margin-top:12px;">
        <button class="btn btn-soft btn-wide" type="submit" name="action" value="preview">Preview Child View</button>
        <button class="btn btn-primary btn-wide" type="submit" name="action" value="launch">Launch Quiz</button>
      </div>
    </form>
    ${pendingQuizList()}`;
}

function pendingQuizList() {
  const pending = state.assignments.filter((item) => isPendingQuiz(item));
  return `<section class="section-title"><h2>Pending Quizzes</h2><span class="chip">${pending.length}</span></section>
    <section class="tile-grid">${state.children.length ? state.children.map((child) => {
      const quizzes = pending.filter((item) => item.child_id === child.id);
      return `<details class="kid-tile-card card pending-quiz-tile" data-quiz-child="${escapeAttr(child.id)}" ${state.pendingQuizOpen.includes(child.id) ? "open" : ""}>
        <summary>
          <div class="kid-avatar">${initials(child.display_name)}</div>
          <h2>${escapeHtml(child.display_name || "Unnamed child")}</h2>
          <p class="muted">${escapeHtml(child.grade || "No grade set")}</p>
          <span class="chip">${quizzes.length} pending quiz${quizzes.length === 1 ? "" : "zes"}</span>
        </summary>
        <div class="kid-detail-panel">${quizzes.length ? quizzes.map((assignment) => {
          const mission = missionById(assignment.mission_id);
          return `<div class="pending-quiz-row">
            <div><h3>${escapeHtml(mission.title)}</h3><p class="muted">Waiting to finish</p></div>
            ${isTutor() ? "" : `<button class="btn btn-danger" type="button" data-delete-pending-quiz="${escapeAttr(assignment.id)}" aria-label="Delete ${escapeAttr(mission.title)} for ${escapeAttr(child.display_name)}">Delete</button>`}
          </div>`;
        }).join("") : `<p class="muted">No pending quizzes.</p>`}</div>
      </details>`;
    }).join("") : `<p class="muted">No child profiles yet.</p>`}</section>`;
}

function isPendingQuiz(assignment, mission = missionById(assignment.mission_id)) {
  return mission?.mission_type === "quiz" && !["submitted", "approved"].includes(assignment.status);
}

function quizManualRow() {
  return `<tr>
    <td><textarea name="manual_question" aria-label="Question"></textarea></td>
    <td><textarea name="manual_answer" aria-label="Answer"></textarea></td>
    <td><button class="btn btn-danger" type="button" data-delete-quiz-row aria-label="Delete row" title="Delete row">&times;</button></td>
  </tr>`;
}

function multipleChoiceManualRow() {
  return `<tr><td><textarea name="mc_question" aria-label="Question"></textarea></td>
    ${["A", "B", "C", "D"].map(label => `<td><textarea name="mc_choice_${label}" aria-label="Choice ${label}"></textarea></td>`).join("")}
    <td><select name="mc_answer" aria-label="Answer Key"><option value="">Choose</option>${["A", "B", "C", "D"].map(label => `<option>${label}</option>`).join("")}</select></td>
    <td><textarea name="mc_explanation" aria-label="Explanation (optional)"></textarea></td>
    <td><button type="button" class="btn btn-danger" data-delete-mc-row title="Delete row" aria-label="Delete row">&times;</button></td></tr>`;
}

function kidsManager() {
  return `
    <section class="section-title"><div><p class="tiny">Family Profiles</p><h1>Kids</h1></div></section>
    <form class="card" id="kidForm">
      ${field("Child name", "display_name", "text", "Xilia Marie")}
      ${field("Kid PIN", "kid_pin", "text", "1234")}
      ${field("Age", "age", "number", "8", "8")}
      ${field("Grade", "grade", "text", "Grade 3")}
      <button class="btn btn-primary btn-wide" type="submit">Add Kid</button>
    </form>
    <section class="tile-grid" style="margin-top:12px;">${state.children.map(childCard).join("") || empty("No kids yet", "Add the first child profile.")}</section>`;
}

function bindParentHandlers() {
  bindFamilyHandlers();
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  const mission = byId("missionForm");
  if (mission) mission.addEventListener("submit", createMission);
  const quiz = byId("quizForm");
  if (quiz) quiz.addEventListener("submit", createQuiz);
  byId("quizTiming")?.addEventListener("change", () => {
    byId("quizLimitField").classList.toggle("hidden", byId("quizTiming").value !== "limited");
  });
  const quizType = byId("quizTypeSelect");
  if (quizType) quizType.addEventListener("change", syncQuizTypeFields);
  document.querySelectorAll('[name="mc_source"]').forEach(input => input.addEventListener("change", syncQuizTypeFields));
  byId("addMcRowBtn")?.addEventListener("click", () => {
    byId("mcManualRows").insertAdjacentHTML("beforeend", multipleChoiceManualRow());
    byId("mcManualRows").lastElementChild.querySelector("textarea").focus();
  });
  byId("mcManualRows")?.addEventListener("click", event => {
    const button = event.target.closest("[data-delete-mc-row]");
    if (!button) return;
    button.closest("tr").remove();
    if (!byId("mcManualRows").children.length) byId("mcManualRows").insertAdjacentHTML("beforeend", multipleChoiceManualRow());
  });
  document.querySelectorAll('[name="question_source"]').forEach((input) => input.addEventListener("change", syncQuizTypeFields));
  byId("addQuizRowBtn")?.addEventListener("click", () => {
    byId("quizManualRows").insertAdjacentHTML("beforeend", quizManualRow());
    byId("quizManualRows").lastElementChild.querySelector("textarea").focus();
  });
  byId("quizManualRows")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-quiz-row]");
    if (!button) return;
    button.closest("tr").remove();
    if (!byId("quizManualRows").children.length) byId("quizManualRows").insertAdjacentHTML("beforeend", quizManualRow());
  });
  const kid = byId("kidForm");
  if (kid) kid.addEventListener("submit", addKid);
  const categoryAdd = byId("addCategoryBtn");
  if (categoryAdd) categoryAdd.addEventListener("click", addCategory);
  const instructionAdd = byId("addInstructionRowBtn");
  if (instructionAdd) instructionAdd.addEventListener("click", addMissionInstructionRow);
  const instructionRows = byId("instructionRows");
  if (instructionRows) instructionRows.addEventListener("click", deleteMissionInstructionRow);
  if (instructionRows) instructionRows.addEventListener("input", event => {
    if (event.target.name === "instruction_row") event.target.nextElementSibling.innerHTML = instructionLinkPreview(event.target.value);
  });
  document.querySelectorAll("[data-select-category]").forEach((button) => button.addEventListener("click", () => selectCategory(button.dataset.selectCategory)));
  document.querySelectorAll("[data-rename-category]").forEach((button) => button.addEventListener("click", () => renameCategory(button.dataset.renameCategory)));
  document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", () => deleteCategory(button.dataset.deleteCategory)));
  document.querySelectorAll("[data-update-kid]").forEach((form) => form.addEventListener("submit", updateKid));
  document.querySelectorAll("[data-delete-kid]").forEach((button) => button.addEventListener("click", () => deleteKid(button.dataset.deleteKid)));
  document.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => approveAssignment(button.dataset.approve)));
  document.querySelectorAll("[data-decline]").forEach((button) => button.addEventListener("click", () => declineAssignment(button.dataset.decline)));
  document.querySelectorAll("[data-review-assignment]").forEach((button) => button.addEventListener("click", () => openParentQuizReview(button.dataset.reviewAssignment)));
  document.querySelectorAll("[data-delete-result]").forEach((button) => button.addEventListener("click", () => deleteExamResult(button.dataset.deleteResult)));
  document.querySelectorAll("[data-delete-pending-quiz]").forEach((button) => button.addEventListener("click", () => deletePendingQuiz(button.dataset.deletePendingQuiz)));
  document.querySelectorAll("[data-quiz-child]").forEach((tile) => tile.addEventListener("toggle", () => {
    const childId = tile.dataset.quizChild;
    state.pendingQuizOpen = state.pendingQuizOpen.filter((id) => id !== childId);
    if (tile.open) state.pendingQuizOpen.push(childId);
  }));
  document.querySelectorAll("[data-parent-comments]").forEach((form) => form.addEventListener("submit", saveParentComments));
  document.querySelectorAll("[data-add-continuation]").forEach(button => button.addEventListener("click", () => {
    const rows = button.closest("form").querySelector("[data-mission-extra-rows]");
    rows.insertAdjacentHTML("beforeend", continuationInstructionRow());
    rows.lastElementChild.querySelector("input").focus();
  }));
  document.querySelectorAll("[data-parent-comments]").forEach(form => form.addEventListener("click", event => {
    event.target.closest("[data-delete-continuation]")?.closest("tr").remove();
  }));
  document.querySelectorAll("[data-parent-comments]").forEach(form => form.addEventListener("input", event => {
    if (event.target.name === "new_instruction") event.target.nextElementSibling.innerHTML = instructionLinkPreview(event.target.value);
    updateCommentLinkPreview(event);
  }));
  document.querySelectorAll("[data-open-mission-detail]").forEach(tile => tile.querySelector("summary").addEventListener("click", event => {
    if (event.target.closest("button, input, textarea, a")) return;
    event.preventDefault();
    state.parentMissionDetail = tile.dataset.openMissionDetail;
    state.error = "";
    state.notice = "";
    renderParentMissionDetail();
  }));
  document.querySelectorAll("[data-open-kid-monitor]").forEach((card) => card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, textarea, select")) return;
    openParentKidMonitor(card.dataset.openKidMonitor);
  }));
}

function syncQuizTypeFields() {
  const type = byId("quizTypeSelect")?.value || "multiple_choice";
  byId("multipleChoiceSource")?.classList.toggle("hidden", type !== "multiple_choice");
  byId("csvQuizSource")?.classList.toggle("hidden", type === "multiple_choice");
  const manual = document.querySelector('[name="question_source"]:checked')?.value === "manual";
  byId("quizCsvUpload")?.classList.toggle("hidden", manual);
  byId("quizManualEntry")?.classList.toggle("hidden", !manual);
  byId("quizSourceError")?.classList.add("hidden");
  const mcSource = document.querySelector('[name="mc_source"]:checked')?.value || "paste";
  byId("mcPasteSource")?.classList.toggle("hidden", mcSource !== "paste");
  byId("mcCsvSource")?.classList.toggle("hidden", mcSource !== "csv");
  byId("mcManualSource")?.classList.toggle("hidden", mcSource !== "manual");
  byId("mcSourceError")?.classList.add("hidden");
}

async function setupFamily(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const auth = await authSignUp(val(form, "signup_email"), val(form, "signup_password"));
    const token = auth.session?.access_token || auth.access_token;
    const refreshToken = auth.session?.refresh_token || auth.refresh_token;
    const user = auth.user;
    if (!token || !user) {
      showNotice("Account created. Please confirm your email, then login to create your family dashboard.");
      return;
    }
    setSession({ mode: "parent", userId: user.id, email: user.email, accessToken: token, refreshToken });
    showNotice("Account created. Finish your family setup.");
    await refreshData();
  } catch (error) {
    showError(error.message);
  }
}

async function createFamilyForSignedInParent(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const form = new FormData(event.target);
  const familyName = val(form, "family_name");
  const parentName = val(form, "parent_name");
  const childName = val(form, "child_name");
  if (!familyName || !parentName || !childName) {
    showError("Family name, parent name, and first child are required.");
    return;
  }
  try {
    submitButton.disabled = true;
    const familyId = await supabaseRequest('/rest/v1/rpc/mn_request_subscription', { method: 'POST', body: JSON.stringify({
      p_family_name: familyName, p_parent_name: parentName, p_child_name: childName,
      p_kid_pin: val(form, 'kid_pin'), p_plan: val(form, 'subscription_plan'),
    }) });
    state.session.familyId = familyId;
    setSession(state.session);
    state.notice = 'Your family request was sent. Submit your payment for administrator verification.';
    await refreshData();
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function parentLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const auth = await authLogin(val(form, "email"), val(form, "password"));
    const user = auth.user;
    setSession({
      mode: "parent",
      userId: user.id,
      email: user.email,
      accessToken: auth.access_token,
      refreshToken: auth.refresh_token,
    });
    await refreshData();
    await pollFamilyInvitations();
  } catch (error) {
    showError("Login failed. Check the email and password.");
  }
}

async function kidLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const code = val(form, "kid_family_code").toUpperCase();
  const childName = val(form, "kid_child_name");
  const pin = val(form, "kid_access_pin");
  const families = await supabaseGet("mn_families", `family_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!families.length) return showError("Family code was not found.");
  const children = await supabaseGet("mn_children", `family_id=eq.${families[0].id}&display_name=ilike.${encodeURIComponent(childName)}&kid_pin=eq.${encodeURIComponent(pin)}&limit=1`);
  if (!children.length) return showError("Child name or kid PIN is incorrect.");
  setSession({ mode: "kid", familyCode: code, childId: children[0].id, childName: children[0].display_name });
  await refreshData();
}

async function addKid(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const displayName = val(form, "display_name");
  if (!displayName) {
    showError("Child name is required.");
    return;
  }
  await supabaseInsert("mn_children", {
    family_id: state.family.id,
    display_name: displayName,
    kid_pin: val(form, "kid_pin") || "1234",
    age: Number(val(form, "age") || 8),
    grade: val(form, "grade"),
  });
  showNotice("Kid added.");
  await refreshData();
}

async function updateKid(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const childId = event.target.dataset.updateKid;
  const displayName = val(form, "display_name");
  if (!displayName) {
    showError("Child name is required.");
    return;
  }
  await supabasePatch("mn_children", childId, {
    display_name: displayName,
    kid_pin: val(form, "kid_pin") || "1234",
    age: Number(val(form, "age") || 8),
    grade: val(form, "grade"),
  });
  showNotice("Kid profile updated.");
  await refreshData();
}

async function deleteKid(childId) {
  const child = state.children.find((item) => item.id === childId);
  if (!child) return;
  if (!confirm(`Delete ${child.display_name}? This also removes this child's assigned missions and quiz answers.`)) return;
  await supabaseDelete("mn_children", childId);
  showNotice("Kid profile deleted.");
  await refreshData();
}

async function addCategory() {
  const name = prompt("New category name:");
  if (!name?.trim()) return;
  await supabaseInsert("mn_categories", { family_id: state.family.id, name: name.trim() });
  showNotice("Category added.");
  await refreshData();
}

function selectCategory(id) {
  const category = state.categories.find((item) => item.id === id);
  const input = byId("categoryIdInput");
  const label = byId("categorySelectedLabel");
  const picker = byId("categoryPicker");
  if (input) input.value = id;
  if (label) label.textContent = category?.name || "Choose category";
  if (picker) picker.open = false;
}

async function renameCategory(id) {
  const category = state.categories.find((item) => item.id === id);
  if (!category) return;
  const name = prompt("Rename category:", category.name);
  if (!name?.trim()) return;
  await supabasePatch("mn_categories", id, { name: name.trim() });
  showNotice("Category updated.");
  await refreshData();
}

async function deleteCategory(id) {
  const category = state.categories.find((item) => item.id === id);
  if (!id || !category) return;
  if (!confirm(`Hide "${category.name}" from the category dropdown?`)) return;
  await supabasePatch("mn_categories", id, { is_active: false });
  showNotice("Category hidden.");
  await refreshData();
}

function addMissionInstructionRow() {
  byId("instructionRows")?.insertAdjacentHTML("beforeend", missionInstructionEditorRow());
}

function deleteMissionInstructionRow(event) {
  const button = event.target.closest("[data-delete-instruction-row]");
  if (!button) return;
  const rows = [...document.querySelectorAll("#instructionRows tr")];
  if (rows.length <= 1) {
    const input = rows[0]?.querySelector("input[name='instruction_row']");
    if (input) input.value = "";
    return;
  }
  button.closest("tr")?.remove();
}

async function createMission(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  if (isTutor() && !isLessonsCategory(state.categories.find(category => category.id === val(form, "category_id")))) return showError("Tutors can create missions only in Lessons.");
  const childIds = selectedChildIds(form);
  const instructions = form.getAll("instruction_row").map((item) => String(item).trim()).filter(Boolean);
  if (!childIds.length) return showError("Choose at least one child.");
  if (!instructions.length) return showError("Add at least one instruction row.");
  const mission = await supabaseInsert("mn_missions", {
    family_id: state.family.id,
    category_id: val(form, "category_id") || null,
    title: val(form, "title"),
    instructions: instructions.join("\n"),
    reward_stars: Number(val(form, "reward_stars") || 25),
    mission_type: "mission",
  });
  await createAssignments(mission.id, childIds);
  state.view = "home";
  showNotice("Mission launched.");
  await refreshData();
}

async function createQuiz(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const childIds = selectedChildIds(form);
  const quizType = val(form, "quiz_type") || "multiple_choice";
  const timeLimitSeconds = val(form, "quiz_timing") === "limited" ? Number(val(form, "quiz_minutes")) * 60 : 0;
  if (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 0 || timeLimitSeconds > 86400 || (val(form, "quiz_timing") === "limited" && timeLimitSeconds < 60)) {
    return showError("Set a time limit between 1 and 1440 whole minutes.");
  }
  let questions;
  try {
    questions = quizType === "multiple_choice"
      ? val(form, "mc_source") === "csv" ? await parseMultipleChoiceCsv(form.get("mc_csv"))
        : val(form, "mc_source") === "manual" ? parseMultipleChoiceManual(form)
        : parseQuiz(val(form, "source_text"))
      : val(form, "question_source") === "manual"
        ? parseManualQuiz(form, quizType)
        : await parseQuizCsv(form.get("quiz_csv"), quizType);
    if (!questions.length) throw new Error(quizType === "multiple_choice" ? "Add or upload at least one multiple-choice question with its answer key." : "Add a question and answer, or upload a CSV with Question and Answer columns.");
  } catch (error) {
    const message = byId(quizType === "multiple_choice" ? "mcSourceError" : "quizSourceError");
    message.textContent = error.message;
    message.classList.remove("hidden");
    return;
  }
  if (!questions.length) return showError("I could not recognize quiz questions yet.");
  if (event.submitter?.value === "preview") {
    state.previewQuiz = {
      title: val(form, "title") || "Quiz Preview",
      subject: val(form, "subject") || "Quiz",
      quizType,
      timeLimitSeconds,
      rewardStars: Number(val(form, "reward_stars") || 50),
      child: previewChild(childIds),
      questions,
    };
    return renderQuizPreview();
  }
  if (!childIds.length) return showError("Choose at least one child.");
  if (state.quizLaunching) return;
  state.quizLaunching = true;
  const launchButton = event.submitter;
  if (launchButton) launchButton.disabled = true;
  try {
  const duplicates = await findPendingQuizDuplicates(childIds, val(form, "title"), questions);
  if (duplicates.length && !confirm(`This quiz is already in the queue for:\n${duplicates.map((item) => `${item.childName}: ${item.title}`).join("\n")}\n\nContinue and assign another copy? Choose Cancel to keep the current queue.`)) return;
  const quizCategory = activeCategories().find((item) => item.name.toLowerCase() === "quiz") || activeCategories()[0];
  const mission = await supabaseInsert("mn_missions", {
    family_id: state.family.id,
    category_id: quizCategory?.id || null,
    title: val(form, "title"),
    instructions: `${val(form, "subject")} quiz`,
    reward_stars: Number(val(form, "reward_stars") || 50),
    mission_type: "quiz",
    quiz_time_limit_seconds: timeLimitSeconds,
    source_text: quizType === "multiple_choice" ? (val(form, "mc_source") === "paste" ? val(form, "source_text") : `multiple_choice ${val(form, "mc_source")}`) : `${quizType} ${val(form, "question_source") === "manual" ? "manual" : "CSV"}`,
  });
  for (const question of questions) {
    await supabaseInsert("mn_quiz_questions", { mission_id: mission.id, ...question });
  }
  await createAssignments(mission.id, childIds);
  state.view = "home";
  state.quizDraftForm = null;
  showNotice(`Quiz launched with ${questions.length} questions.`);
  await refreshData();
  } catch (error) {
    let message = byId("quizSourceError");
    if (!message || quizType === "multiple_choice") {
      message = document.createElement("div");
      message.className = "error";
      message.setAttribute("role", "alert");
      event.target.prepend(message);
    }
    message.textContent = `Could not launch quiz. ${error.message}`;
    message.classList.remove("hidden");
  } finally {
    state.quizLaunching = false;
    if (launchButton) launchButton.disabled = false;
  }
}

async function findPendingQuizDuplicates(childIds, title, questions) {
  const familyId = encodeURIComponent(state.family.id);
  const [assignments, missions] = await Promise.all([
    supabaseGet("mn_assignments", `family_id=eq.${familyId}&status=not.in.(submitted,approved)`),
    supabaseGet("mn_missions", `family_id=eq.${familyId}&mission_type=eq.quiz`),
  ]);
  const missionMap = new Map(missions.map((mission) => [mission.id, mission]));
  const pending = assignments.filter((item) => childIds.includes(item.child_id) && isPendingQuiz(item, missionMap.get(item.mission_id)));
  const fingerprint = quizFingerprint(questions);
  const matches = new Set();
  await Promise.all([...new Set(pending.map((item) => item.mission_id))].map(async (missionId) => {
    const mission = missionMap.get(missionId);
    if (title.trim() && normalizeAnswer(mission.title) === normalizeAnswer(title)) {
      matches.add(missionId);
      return;
    }
    const savedQuestions = await supabaseGet("mn_quiz_questions", `mission_id=eq.${encodeURIComponent(missionId)}&order=sort_order.asc`);
    if (savedQuestions.length && quizFingerprint(savedQuestions) === fingerprint) matches.add(missionId);
  }));
  return pending.filter((item) => matches.has(item.mission_id)).map((item) => ({
    childName: state.children.find((child) => child.id === item.child_id)?.display_name || "Child",
    title: missionMap.get(item.mission_id).title,
  }));
}

function quizFingerprint(questions) {
  return JSON.stringify(questions.map((question) => JSON.stringify([
    normalizeAnswer(question.prompt), normalizeAnswer(question.answer),
    (question.choices || []).map((choice) => [normalizeAnswer(choice.label), normalizeAnswer(choice.text)]).sort(),
  ])).sort());
}

async function deletePendingQuiz(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment || !isPendingQuiz(assignment)) return;
  const mission = missionById(assignment.mission_id);
  const child = state.children.find((item) => item.id === assignment.child_id);
  if (!confirm(`Remove "${mission.title}" from ${child?.display_name || "this child"}'s queue?`)) return;
  try {
    await supabaseRequest(`/rest/v1/mn_assignments?id=eq.${encodeURIComponent(assignmentId)}&family_id=eq.${encodeURIComponent(state.family.id)}&status=not.in.(submitted,approved)`, { method: "DELETE" });
    await refreshData();
    showNotice("Pending quiz removed from the child's queue.");
  } catch (error) {
    showError(error.message);
  }
}

async function createAssignments(missionId, childIds) {
  for (const childId of childIds) {
    await supabaseInsert("mn_assignments", {
      family_id: state.family.id,
      mission_id: missionId,
      child_id: childId,
      status: "assigned",
    });
  }
}

function selectedChildIds(form) {
  if (state.children.length === 1) return [state.children[0].id];
  return form.getAll("children");
}

function previewChild(childIds) {
  if (childIds.length) return state.children.find((child) => child.id === childIds[0]) || state.children[0] || null;
  return state.children[0] || null;
}

async function submitMission(assignmentId, progressForm = null) {
  const payload = { status: "submitted", submitted_at: new Date().toISOString() };
  if (progressForm?.dataset.kidProgress) Object.assign(payload, worksheetProgressPayload(assignmentId, progressForm));
  Object.assign(payload, pauseAssignmentPayload(assignmentId));
  await supabasePatch("mn_assignments", assignmentId, payload);
  showNotice("Submitted to parent.");
  await refreshData();
}

async function saveKidProgress(event) {
  event.preventDefault();
  const assignmentId = event.currentTarget.dataset.kidProgress;
  const payload = worksheetProgressPayload(assignmentId, event.currentTarget);
  await supabasePatch("mn_assignments", assignmentId, payload);
  showNotice("Progress saved.");
  await refreshData();
}

function worksheetProgressPayload(assignmentId, formElement) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const mission = missionById(assignment?.mission_id);
  if (!assignment || !mission) return {};
  const form = new FormData(formElement);
  const rows = missionInstructionRows(mission);
  const checklistDone = {};
  const kidComments = {};
  rows.forEach((_, index) => {
    checklistDone[index] = form.get(`done_${index}`) === "on";
    kidComments[index] = val(form, `kid_comment_${index}`);
  });
  return { checklist_done: checklistDone, kid_comments: kidComments };
}

async function saveParentComments(event) {
  event.preventDefault();
  if (isTutor()) return showError("Tutor access to existing missions is view-only.");
  const assignmentId = event.currentTarget.dataset.parentComments;
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const mission = missionById(assignment?.mission_id);
  if (!assignment || !mission) return;
  const form = new FormData(event.currentTarget);
  const rows = missionInstructionRows(mission);
  const parentComments = {};
  rows.forEach((_, index) => {
    parentComments[index] = val(form, `parent_comment_${index}`);
  });
  const newRows = form.getAll("new_instruction").map((text, index) => ({
    text: String(text).trim(), comment: String(form.getAll("new_parent_comment")[index] || "").trim(),
  })).filter(row => row.text);
  const saveButton = event.currentTarget.querySelector('[type="submit"]');
  if (saveButton) saveButton.disabled = true;
  try {
    const payload = { parent_comments: parentComments };
    if (newRows.length) {
      const latest = (await supabaseGet("mn_assignments", `id=eq.${encodeURIComponent(assignmentId)}&family_id=eq.${encodeURIComponent(state.family.id)}`))[0];
      if (!latest || latest.status === "approved") throw new Error("This mission is no longer active. Create a new mission to continue.");
      const latestMission = (await supabaseGet("mn_missions", `id=eq.${encodeURIComponent(latest.mission_id)}`))[0];
      if (!latestMission) throw new Error("This mission could not be found.");
      const previousRows = missionInstructionRows(latestMission);
      if (previousRows.length !== rows.length) throw new Error("The instruction list has changed. Reopen this mission before adding steps.");
      // Copy the mission so a continuation changes only this child's assignment.
      const continued = await supabaseInsert("mn_missions", {
        family_id: state.family.id, category_id: latestMission.category_id,
        title: latestMission.title, instructions: [...previousRows, ...newRows.map(row => row.text)].join("\n"),
        reward_stars: latestMission.reward_stars, requires_approval: latestMission.requires_approval,
        mission_type: "mission", due_at: latestMission.due_at,
      });
      newRows.forEach((row, index) => { parentComments[rows.length + index] = row.comment; });
      payload.mission_id = continued.id;
      payload.status = "assigned";
      payload.submitted_at = null;
      payload.approved_at = null;
    }
    await supabasePatch("mn_assignments", assignmentId, payload);
    await refreshData();
    showNotice(newRows.length ? "New steps added. Existing progress and comments are preserved." : "Parent comments saved.");
  } catch (error) {
    const alert = document.createElement("p");
    alert.className = "error";
    alert.setAttribute("role", "alert");
    alert.textContent = error.message;
    event.target.append(alert);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function approveAssignment(assignmentId) {
  await supabasePatch("mn_assignments", assignmentId, { status: "approved", approved_at: new Date().toISOString() });
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const child = state.children.find((item) => item.id === assignment.child_id);
  const mission = missionById(assignment.mission_id);
  if (child && mission) {
    await supabasePatch("mn_children", child.id, { stars: Number(child.stars || 0) + Number(mission.reward_stars || 0) });
  }
  await refreshData();
}

async function declineAssignment(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const mission = missionById(assignment?.mission_id);
  if (!assignment || !mission) return;
  if (!confirm(`Decline and reset "${mission.title}"? All checkboxes will be unchecked.`)) return;
  if (mission.mission_type === "quiz") {
    await supabaseRequest(`/rest/v1/mn_quiz_answers?assignment_id=eq.${encodeURIComponent(assignmentId)}`, { method: "DELETE" });
    await supabaseRequest(`/rest/v1/mn_quiz_attempts?assignment_id=eq.${encodeURIComponent(assignmentId)}`, { method: "DELETE" }).catch((error) => {
      if (!isMissingTableError(error)) throw error;
    });
  }
  await supabasePatch("mn_assignments", assignmentId, {
    status: "assigned",
    submitted_at: null,
    approved_at: null,
    checklist_done: {},
    kid_comments: {},
    parent_comments: {},
    focus_elapsed_seconds: 0,
    focus_started_at: null,
  });
  showNotice("Task declined and reset.");
  await refreshData();
}

async function deleteExamResult(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const mission = missionById(assignment?.mission_id);
  const child = state.children.find((item) => item.id === assignment?.child_id);
  if (!assignment || !mission) return;
  if (!confirm(`Delete exam result for ${child?.display_name || "this child"}?\n\nThis removes the result, saved answers, and retake history from the dashboard.`)) return;
  try {
    await supabaseRequest(`/rest/v1/mn_quiz_answers?assignment_id=eq.${encodeURIComponent(assignmentId)}`, { method: "DELETE" });
    await supabaseRequest(`/rest/v1/mn_quiz_attempts?assignment_id=eq.${encodeURIComponent(assignmentId)}`, { method: "DELETE" }).catch((error) => {
      if (!isMissingTableError(error)) throw error;
    });
    await supabaseDelete("mn_assignments", assignmentId);
    if (state.parentQuizReview?.assignment?.id === assignmentId) state.parentQuizReview = null;
    showNotice("Exam result deleted.");
    await refreshData();
  } catch (error) {
    showError(error.message);
  }
}

async function updateAssignmentTimer(action, assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  if (action === "pause") {
    await supabasePatch("mn_assignments", assignment.id, {
      focus_elapsed_seconds: assignmentElapsedSeconds(assignment),
      focus_started_at: null,
    });
    showNotice("Timer paused.");
  } else {
    await supabasePatch("mn_assignments", assignment.id, {
      focus_started_at: new Date().toISOString(),
    });
    showNotice(action === "continue" ? "Timer continued." : "Timer started.");
  }
  await refreshData();
}

async function startQuiz(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return showError("I could not find that quiz assignment.");
  try {
    const questions = await supabaseGet("mn_quiz_questions", `mission_id=eq.${assignment.mission_id}&order=sort_order.asc`);
    if (!questions.length) return showError("This quiz has no saved questions yet. Please recreate or relaunch the quiz.");
    const mission = missionById(assignment.mission_id);
    const savedType = /^(flash_card|fill_blank) (?:CSV|manual)$/.exec(mission?.source_text || "")?.[1];
    if (savedType) questions.forEach((question) => { question.explanation = savedType; });
    const draft = readQuizAttempt(assignmentId);
    state.selectedQuiz = { assignmentId, assignment, questions,
      startedAt: draft?.startedAt || Date.now(), timeLimitSeconds: Number(mission?.quiz_time_limit_seconds || 0) };
    state.quizResult = null;
    state.error = "";
    state.notice = "";
    state.quizStep = Math.min(draft?.step || 0, questions.length - 1);
    state.quizAnswers = draft?.answers || {};
    state.quizFeedback = null;
    renderQuiz();
    startQuizClock();
  } catch (error) {
    showError(error.message);
  }
}

function quizAttemptKey(id) { return `missionnest_quiz_attempt_${id}`; }
function readQuizAttempt(id) {
  try { return JSON.parse(localStorage.getItem(quizAttemptKey(id))); } catch { return null; }
}
function persistQuizAttempt() {
  const quiz = state.selectedQuiz;
  if (!quiz) return;
  try { localStorage.setItem(quizAttemptKey(quiz.assignmentId), JSON.stringify({ startedAt: quiz.startedAt, step: state.quizStep, answers: state.quizAnswers })); } catch {}
}
function quizTimeExpired() {
  const quiz = state.selectedQuiz;
  return Boolean(quiz?.timeLimitSeconds && Date.now() >= quiz.startedAt + quiz.timeLimitSeconds * 1000);
}
function quizClockHtml() {
  return `<section class="quiz-clock" aria-label="Quiz timer"><strong id="quizClockValue"></strong><span id="quizClockWarning" role="status"></span></section>`;
}
function updateQuizClock() {
  const quiz = state.selectedQuiz;
  if (!quiz) return;
  const elapsed = Math.max(0, Math.floor(((quiz.finishedAt || Date.now()) - quiz.startedAt) / 1000));
  const seconds = quiz.timeLimitSeconds ? Math.max(0, quiz.timeLimitSeconds - elapsed) : elapsed;
  if (byId("quizClockValue")) byId("quizClockValue").textContent = `${quiz.timeLimitSeconds ? "Time left" : "Time elapsed"}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const warning = byId("quizClockWarning");
  if (warning) warning.textContent = quiz.timeLimitSeconds && seconds <= 60 ? (seconds ? "One minute or less remaining!" : "Time is up. Submitting your answers…") : "";
  if (quizTimeExpired()) document.querySelectorAll("main input, main button").forEach((input) => { input.disabled = true; });
  if (quizTimeExpired() && !state.quizSubmitting && Date.now() >= (quiz.retryAt || 0)) submitQuizStep(true);
}
function startQuizClock() {
  clearInterval(quizClockInterval);
  persistQuizAttempt();
  updateQuizClock();
  quizClockInterval = setInterval(updateQuizClock, 250);
}

async function retakeQuiz() {
  const assignmentId = state.quizResult?.assignmentId;
  if (!assignmentId) return finishQuizResult();
  try { localStorage.removeItem(quizAttemptKey(assignmentId)); } catch {}
  await startQuiz(assignmentId);
}

function renderQuiz() {
  const quiz = state.selectedQuiz;
  if (quiz.questions.every((item) => quizQuestionType(item) === "fill_blank")) return renderFillBlankQuiz();
  const question = quiz.questions[state.quizStep];
  const child = state.children.find((item) => item.id === quiz.assignment.child_id);
  const mission = missionById(quiz.assignment.mission_id);
  const type = quizQuestionType(question);
  const savedAnswer = state.quizAnswers[question.id] || "";
  const feedback = state.quizFeedback?.questionId === question.id ? state.quizFeedback : null;
  app.innerHTML = `
    <main class="shell">
      ${messageHtml()}
      ${quizClockHtml()}
      <section class="card hero">
        <div class="profile-strip">
          <div class="kid-avatar">${initials(child?.display_name)}</div>
          <div>
            <p class="tiny">Quiz Quest · Question ${state.quizStep + 1} of ${quiz.questions.length}</p>
            <h2>${escapeHtml(child?.display_name || "Kid")}</h2>
            <p class="muted">${escapeHtml(mission?.title || "Quiz")}</p>
          </div>
        </div>
      </section>
      ${type === "flash_card" ? "" : `<section class="card" style="margin-top:12px;"><h1>${escapeHtml(question.prompt)}</h1></section>`}
      ${quizAnswerInput(question, type, savedAnswer, feedback)}
    </main>`;
  document.querySelectorAll("[data-answer]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".answer").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    state.quizAnswers[question.id] = button.dataset.answer;
    persistQuizAttempt();
  }));
  byId("nextQuizBtn")?.addEventListener("click", () => submitQuizStep());
  byId("previousQuestionBtn")?.addEventListener("click", () => navigateMultipleChoice(-1));
  byId("nextQuestionBtn")?.addEventListener("click", () => navigateMultipleChoice(1));
  byId("checkFlashBtn")?.addEventListener("click", checkFlashCardAnswer);
  byId("showCorrectAnswerBtn")?.addEventListener("click", () => {
    state.quizFeedback = { ...(state.quizFeedback || {}), questionId: question.id, showAnswer: true };
    renderQuiz();
  });
  byId("typedQuizAnswer")?.addEventListener("input", (event) => {
    if (!feedback) { state.quizAnswers[question.id] = event.target.value; persistQuizAttempt(); }
  });
  persistQuizAttempt();
  updateQuizClock();
}

function fillBlankQuestionsHtml(questions, preview = false) {
  return questions.map((question, index) => `
    <div class="fill-quiz-row">
      <label for="fillAnswer${index}">${index + 1}. ${escapeHtml(question.prompt)}</label>
      <input id="fillAnswer${index}" data-fill-answer="${escapeAttr(question.id || index)}" type="text"
        aria-label="Answer to question ${index + 1}" autocomplete="off" required
        value="${escapeAttr(preview ? "" : state.quizAnswers[question.id] || "")}" ${preview ? "disabled" : ""}>
    </div>`).join("");
}

function renderFillBlankQuiz() {
  const quiz = state.selectedQuiz;
  const child = state.children.find((item) => item.id === quiz.assignment.child_id);
  const mission = missionById(quiz.assignment.mission_id);
  app.innerHTML = `<main class="shell">
    ${messageHtml()}
    ${quizClockHtml()}
    <section class="hero card">
      <div class="profile-strip"><div class="kid-avatar">${initials(child?.display_name)}</div>
        <div><p class="tiny">Fill in the blanks · ${quiz.questions.length} questions</p>
        <h2>${escapeHtml(child?.display_name || "Kid")}</h2><p class="muted">${escapeHtml(mission?.title || "Quiz")}</p></div>
      </div>
    </section>
    <form id="fillBlankQuizForm" novalidate>
      ${fillBlankQuestionsHtml(quiz.questions)}
      <button class="btn btn-primary btn-wide" type="submit" id="nextQuizBtn">Submit Quiz</button>
    </form>
  </main>`;
  byId("fillBlankQuizForm").addEventListener("input", (event) => {
    if (event.target.matches("[data-fill-answer]")) { state.quizAnswers[event.target.dataset.fillAnswer] = event.target.value; persistQuizAttempt(); }
  });
  byId("fillBlankQuizForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuizStep();
  });
  updateQuizClock();
}

function quizAnswerInput(question, type, savedAnswer, feedback) {
  if (type === "multiple_choice") {
    return `
      <section class="grid" style="margin-top:12px;">
        ${(question.choices || []).map((choice) => `<button class="answer ${savedAnswer === choice.label ? "selected" : ""}" data-answer="${escapeAttr(choice.label)}">${escapeHtml(choice.label)}. ${escapeHtml(choice.text)}</button>`).join("")}
      </section>
      ${multipleChoiceNavigation(state.quizStep, state.selectedQuiz.questions.length)}`;
  }
  if (type === "flash_card") {
    return `
      <section class="card flash-card" style="margin-top:12px;">
        <p class="tiny">Flash Card</p>
        <h2>${escapeHtml(question.prompt)}</h2>
      </section>
      <section class="card" style="margin-top:12px;">
        <div class="field">
          <label>Your answer</label>
          <input id="typedQuizAnswer" type="text" value="${escapeAttr(savedAnswer)}" ${feedback ? "readonly" : ""} placeholder="Type your answer">
        </div>
        ${feedback ? flashFeedbackHtml(question, feedback) : ""}
        <div class="grid grid-2">
          ${feedback ? `<button class="btn btn-primary btn-wide" id="nextQuizBtn">${state.quizStep + 1 === state.selectedQuiz.questions.length ? "Submit Quiz" : "Next Card"}</button>` : `<button class="btn btn-amber btn-wide" id="checkFlashBtn">Submit Answer</button>`}
          ${feedback && !feedback.correct && !feedback.showAnswer ? `<button class="btn btn-soft btn-wide" id="showCorrectAnswerBtn">Show Correct Answer</button>` : ""}
        </div>
      </section>`;
  }
  return `
    <section class="card" style="margin-top:12px;">
      <div class="field">
        <label>Your answer</label>
        <input id="typedQuizAnswer" type="text" value="${escapeAttr(savedAnswer)}" placeholder="Type your answer">
      </div>
      <button class="btn btn-primary btn-wide" id="nextQuizBtn">${state.quizStep + 1 === state.selectedQuiz.questions.length ? "Submit Quiz" : "Next"}</button>
    </section>`;
}

function multipleChoiceNavigation(step, total, preview = false) {
  return `<nav class="quiz-question-nav" aria-label="Question navigation">
    <button class="btn quiz-arrow quiz-arrow-back" type="button" id="previousQuestionBtn" aria-label="Previous question" title="Previous question" ${preview || step === 0 ? "disabled" : ""}><span class="quiz-chevron" aria-hidden="true"></span></button>
    <span>${step + 1} / ${total}</span>
    <button class="btn quiz-arrow quiz-arrow-forward" type="button" id="nextQuestionBtn" aria-label="Next question" title="Next question" ${preview || step + 1 === total ? "disabled" : ""}><span class="quiz-chevron" aria-hidden="true"></span></button>
  </nav>
  ${step + 1 === total ? `<button class="btn btn-primary btn-wide" type="button" id="nextQuizBtn" ${preview ? "disabled" : ""}>Submit Quiz</button>` : ""}`;
}

function navigateMultipleChoice(direction) {
  if (!state.selectedQuiz || state.quizSubmitting) return;
  if (quizTimeExpired()) return updateQuizClock();
  const next = state.quizStep + direction;
  if (next < 0 || next >= state.selectedQuiz.questions.length) return;
  state.quizStep = next;
  state.error = "";
  persistQuizAttempt();
  renderQuiz();
}

function flashFeedbackHtml(question, feedback) {
  return `
    <div class="${feedback.correct ? "success" : "error"}" role="status" style="padding:12px;margin:12px 0;">
      <h2>${feedback.correct ? "Correct!" : "Incorrect"}</h2>
      <p class="muted">Your answer: ${escapeHtml(state.quizAnswers[question.id] || "-")}</p>
      ${feedback.showAnswer ? `<p><strong>Correct answer:</strong> ${escapeHtml(question.answer)}</p>` : ""}
    </div>`;
}

function renderQuizPreview() {
  const preview = state.previewQuiz;
  const question = preview.questions[0];
  const type = quizQuestionType(question);
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="backToQuizBtn">Back</button></div></header>
    <main class="shell">
      <section class="card notice">
        <p class="tiny">Parent Preview</p>
        <h2>This is how the quiz will look on the child tablet.</h2>
        <p class="muted">Nothing has been assigned yet. Go back and tap Launch Quiz when ready.</p>
      </section>
      <section class="card hero" style="margin-top:12px;">
        <div class="row">
          <div>
            <span class="chip active">Quiz Quest</span>
            <h1 style="margin-top:10px;">${escapeHtml(preview.title)}</h1>
            <p class="muted">For ${escapeHtml(preview.child?.display_name || "selected child")} · +${preview.rewardStars} stars</p>
            <p class="muted">${preview.timeLimitSeconds ? `Time limit: ${preview.timeLimitSeconds / 60} minutes` : "Open time"}</p>
          </div>
        </div>
      </section>
      ${type === "flash_card" || type === "fill_blank" ? "" : `<section class="card" style="margin-top:12px;"><p class="tiny">Question 1 of ${preview.questions.length}</p><h1>${escapeHtml(question.prompt)}</h1></section>`}
      ${type === "fill_blank" ? `${fillBlankQuestionsHtml(preview.questions, true)}<button class="btn btn-primary btn-wide" type="button" disabled>Submit Quiz</button>` : previewQuizAnswerHtml(question, type)}
    </main>`;
  byId("backToQuizBtn").addEventListener("click", () => {
    state.previewQuiz = null;
    state.view = "quiz";
    render();
  });
}

function previewQuizAnswerHtml(question, type) {
  if (type === "multiple_choice") {
    return `
      <section class="grid" style="margin-top:12px;">
        ${(question.choices || []).map((choice) => `<button class="answer" type="button">${escapeHtml(choice.label)}. ${escapeHtml(choice.text)}</button>`).join("")}
      </section>
      ${multipleChoiceNavigation(0, state.previewQuiz.questions.length, true)}`;
  }
  if (type === "flash_card") {
    return `
      <section class="card flash-card" style="margin-top:12px;">
        <p class="tiny">Flash Card</p>
        <h2>${escapeHtml(question.prompt)}</h2>
      </section>
      <section class="card" style="margin-top:12px;">
        <div class="field"><label>Child answer</label><input type="text" disabled placeholder="Child types here"></div>
        <button class="btn btn-amber btn-wide" type="button" disabled>Submit Answer</button>
      </section>`;
  }
  return `
    <section class="card" style="margin-top:12px;">
      <div class="field"><label>Child answer</label><input type="text" disabled placeholder="Child types here"></div>
      <button class="btn btn-primary btn-wide" type="button" disabled>Next</button>
    </section>`;
}

async function submitQuizStep(forceSubmit = false) {
  if (state.quizSubmitting) return;
  try {
    await advanceQuizStep(forceSubmit === true || quizTimeExpired());
  } catch (error) {
    if (state.selectedQuiz) state.selectedQuiz.retryAt = Date.now() + 5000;
    showError(`Could not save your quiz. Your answers are still here. ${error.message}`);
  } finally {
    state.quizSubmitting = false;
    if (state.selectedQuiz && byId("nextQuizBtn")) byId("nextQuizBtn").disabled = false;
  }
}

async function advanceQuizStep(forceSubmit = false) {
  const quiz = state.selectedQuiz;
  const question = quiz.questions[state.quizStep];
  const type = quizQuestionType(question);
  const worksheet = quiz.questions.every((item) => quizQuestionType(item) === "fill_blank");
  if (worksheet) {
    document.querySelectorAll("[data-fill-answer]").forEach((input) => {
      state.quizAnswers[input.dataset.fillAnswer] = input.value.trim();
    });
  }
  if ((worksheet || type === "multiple_choice") && !forceSubmit) {
    const missing = quiz.questions.map((item, index) => String(state.quizAnswers[item.id] || "").trim() ? null : index + 1).filter(number => number !== null);
    if (missing.length) {
      if (!worksheet) state.quizStep = missing[0] - 1;
      const warning = missing.length === 1
        ? `Please answer question ${missing[0]} before submitting.`
        : `${missing.length} unanswered questions: ${missing.join(", ")}. Please answer them before submitting.`;
      showError(warning);
      if (worksheet) byId(`fillAnswer${missing[0] - 1}`)?.focus();
      else document.querySelector("[data-answer]")?.focus();
      return;
    }
  }
  if (!worksheet && type !== "multiple_choice") {
  if (type !== "multiple_choice") state.quizAnswers[question.id] = (byId("typedQuizAnswer")?.value ?? state.quizAnswers[question.id] ?? "").trim();
  const answer = state.quizAnswers[question.id];
  if (!answer && !forceSubmit) return showError(type === "multiple_choice" ? "Choose an answer first." : "Type your answer first.");
  state.error = "";
  if (!forceSubmit && type === "flash_card" && state.quizFeedback?.questionId !== question.id) return checkFlashCardAnswer();
  if (!forceSubmit && state.quizStep + 1 < quiz.questions.length) {
    state.quizStep += 1;
    state.quizFeedback = null;
    return renderQuiz();
  }
  }
  state.error = "";
  state.quizSubmitting = true;
  quiz.finishedAt = quiz.finishedAt || Date.now();
  const durationSeconds = Math.max(0, Math.floor((quiz.finishedAt - quiz.startedAt) / 1000));
  const elapsedSeconds = quiz.timeLimitSeconds ? Math.min(durationSeconds, quiz.timeLimitSeconds) : durationSeconds;
  const timedOut = forceSubmit;
  document.querySelectorAll("main input, main button").forEach((input) => { input.disabled = true; });
  if (byId("nextQuizBtn")) byId("nextQuizBtn").disabled = true;
  let score = 0;
  const attemptNumber = state.quizAttempts.filter((item) => item.assignment_id === quiz.assignmentId).length + 1;
  await supabaseRequest(`/rest/v1/mn_quiz_answers?assignment_id=eq.${encodeURIComponent(quiz.assignmentId)}`, { method: "DELETE" });
  for (const item of quiz.questions) {
    const itemAnswer = state.quizAnswers[item.id] || "";
    const isCorrect = Boolean(itemAnswer.trim()) && answersMatch(itemAnswer, item.answer);
    if (isCorrect) score += 1;
    await supabaseInsert("mn_quiz_answers", {
      assignment_id: quiz.assignmentId,
      question_id: item.id,
      answer: itemAnswer,
      is_correct: isCorrect,
    });
  }
  try {
    const savedAttempt = await supabaseInsert("mn_quiz_attempts", {
      family_id: state.family.id,
      assignment_id: quiz.assignmentId,
      mission_id: quiz.assignment.mission_id,
      child_id: quiz.assignment.child_id,
      score,
      total: quiz.questions.length,
      attempt_number: attemptNumber,
      duration_seconds: elapsedSeconds,
      timed_out: timedOut,
    });
    state.quizAttempts.unshift(savedAttempt);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
  await supabasePatch("mn_assignments", quiz.assignmentId, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
  });
  state.quizResult = {
    assignmentId: quiz.assignmentId,
    durationSeconds: elapsedSeconds,
    timedOut,
    score,
    total: quiz.questions.length,
    questions: quiz.questions,
    answers: { ...state.quizAnswers },
    review: false,
  };
  try { localStorage.removeItem(quizAttemptKey(quiz.assignmentId)); } catch {}
  clearInterval(quizClockInterval);
  state.selectedQuiz = null;
  state.quizFeedback = null;
  renderQuizResult();
}

function checkFlashCardAnswer() {
  const quiz = state.selectedQuiz;
  const question = quiz.questions[state.quizStep];
  const answer = byId("typedQuizAnswer")?.value.trim() || "";
  if (!answer) return showError("Type your answer first.");
  state.quizAnswers[question.id] = answer;
  persistQuizAttempt();
  state.error = "";
  state.quizFeedback = {
    questionId: question.id,
    correct: answersMatch(answer, question.answer),
    showAnswer: false,
  };
  renderQuiz();
}

function renderQuizResult() {
  const result = state.quizResult;
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="backToKidHomeBtn">Quest List</button></div></header>
    <main class="shell">
      <section class="card hero">
        <p class="tiny">Quiz Complete</p>
        <h1>${result.score}/${result.total}</h1>
        <p><strong>Time taken:</strong> ${formatDuration(result.durationSeconds || 0)}</p>
        ${result.timedOut ? "<p>Time limit reached. Answers submitted automatically.</p>" : ""}
        <p class="muted">Submitted to parent for review.</p>
      </section>
      <div class="grid grid-2" style="margin-top:12px;">
        <button class="btn btn-amber btn-wide" id="reviewAnswersBtn">Review Answers</button>
        <button class="btn btn-soft btn-wide" id="retakeQuizBtn">Retake Quiz</button>
        <button class="btn btn-primary btn-wide" id="doneQuizBtn">Back to Quest List</button>
      </div>
      ${result.review ? quizReviewHtml(result) : ""}
    </main>`;
  byId("reviewAnswersBtn").addEventListener("click", () => {
    state.quizResult.review = true;
    renderQuizResult();
  });
  byId("retakeQuizBtn").addEventListener("click", retakeQuiz);
  byId("doneQuizBtn").addEventListener("click", finishQuizResult);
  byId("backToKidHomeBtn").addEventListener("click", finishQuizResult);
}

async function finishQuizResult() {
  state.quizResult = null;
  await refreshData();
}

function quizReviewHtml(result) {
  return `
    <section class="section-title"><h2>Answer Review</h2><span class="chip">${result.score}/${result.total}</span></section>
    <section class="grid">
      ${result.questions.map((question, index) => {
        const selected = result.answers[question.id];
    const isCorrect = Boolean(String(selected || "").trim()) && answersMatch(selected, question.answer);
        return `
          <article class="card ${isCorrect ? "success" : "notice"}">
            <p class="tiny">Question ${index + 1} · ${isCorrect ? "Correct" : "Review"}</p>
            <h3>${escapeHtml(question.prompt)}</h3>
            <p><strong>Your answer:</strong> ${answerDisplay(question, selected)}</p>
            <p><strong>Correct answer:</strong> ${answerDisplay(question, question.answer)}</p>
            ${questionExplanationHtml(question)}
          </article>`;
      }).join("")}
    </section>`;
}

function kidAssignmentCard(assignment) {
  const mission = missionById(assignment.mission_id);
  if (!mission) return "";
  const isQuiz = mission.mission_type === "quiz";
  const child = state.children.find((item) => item.id === assignment.child_id);
  const timerRunning = isAssignmentTimerRunning(assignment);
  return `
    <article class="card">
      <div class="row">
        <div>
          <p class="status ${assignment.status}">${escapeHtml(categoryName(mission.category_id))} · ${assignment.status}</p>
          <h2>${escapeHtml(mission.title)}</h2>
          <p class="muted">${instructionLinksHtml(mission.instructions || "")}</p>
        </div>
        <span class="chip">+${mission.reward_stars}</span>
      </div>
      ${isQuiz ? `<button class="btn btn-amber btn-wide" data-start-quiz="${assignment.id}">Start Quiz</button>` : `
        <form data-kid-progress="${assignment.id}" class="stack">
          ${assignmentTimerPanel(assignment)}
          ${!timerRunning ? `<div class="card notice"><strong>Press Start or Continue before editing this mission.</strong></div>` : ""}
          ${missionWorksheetTable(mission, assignment, child, timerRunning ? "kid" : "kidLocked")}
          <div class="grid grid-2">
            <button class="btn" type="submit" ${timerRunning ? "" : "disabled"}>Save Progress</button>
            <button class="btn btn-primary" type="button" data-submit-mission="${assignment.id}" ${timerRunning ? "" : "disabled"}>Submit to Parent</button>
          </div>
        </form>`}
    </article>`;
}

function parentAssignmentCard(assignment) {
  const mission = missionById(assignment.mission_id);
  const child = state.children.find((item) => item.id === assignment.child_id);
  if (!mission || !child) return "";
  const isQuiz = mission.mission_type === "quiz";
  const latestAttempt = state.quizAttempts.find((item) => item.assignment_id === assignment.id);
  const scoreText = latestAttempt ? `${latestAttempt.score}/${latestAttempt.total}` : "No score yet";
  if (!isQuiz) {
    const progress = assignmentProgressSummary(mission, assignment);
    return `
      <details class="assignment-tile-card card">
        <summary>
          <div class="row">
            <div class="profile-strip">
              <div class="kid-avatar small">${initials(child.display_name)}</div>
              <div>
                <p class="status ${assignment.status}">${escapeHtml(categoryName(mission.category_id))} · ${escapeHtml(assignment.status)}</p>
                <h2>${escapeHtml(mission.title)}</h2>
                <p class="muted">${escapeHtml(child.display_name)} · ${escapeHtml(child.grade || "No grade set")} · Age ${child.age || 8}</p>
              </div>
            </div>
            <div class="action-row tile-actions">
              <span class="chip">+${mission.reward_stars}</span>
              ${!isTutor() && assignment.status === "submitted" ? `<button class="btn btn-amber" type="button" data-approve="${assignment.id}">Approve</button><button class="btn btn-danger" type="button" data-decline="${assignment.id}">Decline</button>` : ""}
            </div>
          </div>
          <div class="mission-focus">
            <p class="tiny">Progress</p>
            <strong>${progress.done}/${progress.total}</strong>
            <span class="muted">checked done</span>
          </div>
        </summary>
        <div class="assignment-detail-panel">
          <form data-parent-comments="${assignment.id}" class="stack">
            ${missionWorksheetTable(mission, assignment, child, "parent")}
            ${isTutor() ? "" : '<button class="btn" type="submit">Save Parent Comments</button>'}
          </form>
        </div>
      </details>`;
  }
  return `
    <article class="card assignment-card">
      <div class="row">
        <div class="profile-strip">
          <div class="kid-avatar small">${initials(child.display_name)}</div>
          <div>
            <p class="status ${assignment.status}">${escapeHtml(categoryName(mission.category_id))} · ${escapeHtml(assignment.status)}</p>
            <h3>${escapeHtml(mission.title)}</h3>
            <p class="muted">${escapeHtml(child.display_name)} · ${escapeHtml(child.grade || "No grade set")} · Age ${child.age || 8}</p>
            ${isQuiz ? `<p class="muted">Latest score: ${escapeHtml(scoreText)}</p>` : ""}
          </div>
        </div>
        <span class="chip">+${mission.reward_stars}</span>
      </div>
      <div class="action-row">
        ${isQuiz ? `<button class="btn" data-review-assignment="${assignment.id}">Preview Result</button>` : ""}
        ${!isTutor() && assignment.status === "submitted" ? `<button class="btn btn-amber" data-approve="${assignment.id}">Approve</button><button class="btn btn-danger" data-decline="${assignment.id}">Decline</button>` : ""}
        ${isQuiz && !isTutor() ? `<button class="btn btn-danger" data-delete-result="${assignment.id}">Delete Result</button>` : ""}
      </div>
    </article>`;
}

function parentRadarAssignments() {
  const resultAssignmentIds = new Set(state.quizAttempts.map((attempt) => attempt.assignment_id));
  return state.assignments.filter((assignment) => {
    const mission = missionById(assignment.mission_id);
    return mission?.mission_type !== "quiz" || !resultAssignmentIds.has(assignment.id);
  });
}

function missionWorksheetTable(mission, assignment, child, mode) {
  const rows = missionInstructionRows(mission);
  const done = assignment.checklist_done || {};
  const kidComments = assignment.kid_comments || {};
  const parentComments = assignment.parent_comments || {};
  const childName = child?.display_name || "Kid";
  const kidCanEdit = mode === "kid";
  const parentCanEdit = mode === "parent" && !isTutor();
  return `
    <section class="worksheet-wrap">
      <div class="row"><h3>Instructions for ${escapeHtml(childName)}</h3>
        ${parentCanEdit ? '<button class="btn" type="button" data-add-continuation>Add Row</button>' : ""}
      </div>
      <div class="worksheet-scroll">
        <table class="worksheet-table">
          <thead>
            <tr>
              <th>Instructions</th>
              <th>Check if done</th>
              <th>${escapeHtml(childName)}'s Comment</th>
              <th>Parent's Comment</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td>${instructionLinksHtml(row)}</td>
                <td class="center-cell">
                  <input type="checkbox" name="done_${index}" ${done[index] ? "checked" : ""} ${kidCanEdit ? "" : "disabled"}>
                </td>
                <td>
                  ${missionCommentHtml(`kid_comment_${index}`, kidComments[index], kidCanEdit, `${childName}'s Comment`)}
                </td>
                <td>
                  ${missionCommentHtml(`parent_comment_${index}`, parentComments[index], parentCanEdit, "Parent's Comment")}
                </td>
              </tr>`).join("")}
          </tbody>
          ${parentCanEdit ? '<tbody data-mission-extra-rows></tbody>' : ""}
        </table>
      </div>
    </section>`;
}

function missionCommentHtml(name, value, editable, label) {
  const text = String(value || "");
  if (!editable) return `<div class="mission-comment" aria-label="${escapeAttr(label)}">${instructionLinksHtml(text)}</div>`;
  return `<textarea name="${escapeAttr(name)}" aria-label="${escapeAttr(label)}" data-comment-links>${escapeHtml(text)}</textarea><div class="instruction-link-preview">${instructionLinkPreview(text)}</div>`;
}

function updateCommentLinkPreview(event) {
  if (event.target.matches("[data-comment-links]")) event.target.nextElementSibling.innerHTML = instructionLinkPreview(event.target.value);
}

function instructionLinksHtml(text) {
  text = String(text || "");
  let html = "";
  let position = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>"']*)?/gi)) {
    if (match.index > 0 && /[\w@]/.test(text[match.index - 1])) continue;
    let link = match[0].replace(/[.,;!?]+$/, "");
    while (link.endsWith(")") && (link.match(/\)/g) || []).length > (link.match(/\(/g) || []).length) link = link.slice(0, -1);
    const href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    try {
      const url = new URL(href);
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname) continue;
    } catch { continue; }
    html += escapeHtml(String(text).slice(position, match.index));
    html += `<a class="instruction-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>`;
    position = match.index + link.length;
  }
  return html + escapeHtml(String(text).slice(position));
}

function instructionLinkPreview(text) {
  const container = document.createElement("div");
  container.innerHTML = instructionLinksHtml(text);
  return [...container.querySelectorAll("a")].map(link => link.outerHTML).join("<br>");
}

function continuationInstructionRow() {
  return `<tr><td><input type="text" name="new_instruction" aria-label="New instruction or URL"><div class="instruction-link-preview"></div><button class="btn btn-danger" type="button" data-delete-continuation aria-label="Remove new row" title="Remove new row">&times;</button></td>
    <td class="center-cell"><input type="checkbox" disabled></td>
    <td><textarea readonly aria-label="Kid's comment"></textarea></td>
    <td><textarea name="new_parent_comment" aria-label="Parent's comment"></textarea></td></tr>`;
}

function assignmentProgressSummary(mission, assignment) {
  const rows = missionInstructionRows(mission);
  const done = assignment.checklist_done || {};
  const doneCount = rows.filter((_, index) => Boolean(done[index])).length;
  return {
    total: rows.length,
    done: doneCount,
    percent: Math.round((doneCount / Math.max(1, rows.length)) * 100),
  };
}

function childProgressSummary(child) {
  const missionAssignments = childAssignments(child.id).filter((assignment) => {
    const mission = missionById(assignment.mission_id);
    return assignment.status !== "approved" && mission?.mission_type !== "quiz";
  });
  let total = 0;
  let done = 0;
  for (const assignment of missionAssignments) {
    const mission = missionById(assignment.mission_id);
    const progress = assignmentProgressSummary(mission, assignment);
    total += progress.total;
    done += progress.done;
  }
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

function missionInstructionRows(mission) {
  const rows = String(mission?.instructions || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return rows.length ? rows : ["Follow the parent instructions."];
}

function parentKidTile(child) {
  return `
    <article class="kid-tile-card card parent-monitor-tile" data-open-kid-monitor="${escapeAttr(child.id)}">
      <div class="kid-dashboard-tile">
        ${parentKidTileContent(child)}
      </div>
    </article>`;
}

function parentKidTileContent(child) {
  const assignments = parentMissionAssignments(child.id);
  const submitted = assignments.filter((item) => item.status === "submitted").length;
  const featured = assignments.find((item) => item.status === "submitted") || assignments[0];
  const featuredMission = missionById(featured?.mission_id);
  const childProgress = childProgressSummary(child);
  const featuredProgress = featuredMission && featuredMission.mission_type !== "quiz" && featured ? assignmentProgressSummary(featuredMission, featured) : null;
  const running = assignments.some(isAssignmentTimerRunning);
  const elapsed = assignments.reduce((total, assignment) => total + assignmentElapsedSeconds(assignment), 0);
  return `
    <div class="kid-avatar">${initials(child.display_name)}</div>
    <div>
      <p class="tiny">${running ? "Timer Running" : "Time Logged"}</p>
      <h2>${escapeHtml(child.display_name || "Unnamed child")}</h2>
      <p class="muted">${escapeHtml(child.grade || "No grade set")} · Age ${child.age || 8}</p>
    </div>
    ${featuredMission ? `
      <div class="featured-mission">
        <div>
          <p class="tiny">Current Mission</p>
          <h3>${escapeHtml(featuredMission.title)}</h3>
              <p class="muted">${escapeHtml(featured.status)}${featuredProgress ? ` · ${featuredProgress.percent}% finished` : ""}</p>
        </div>
            ${!isTutor() && featured.status === "submitted" ? `<div class="action-row tile-actions"><button class="btn btn-amber" type="button" data-approve="${featured.id}">Approve</button><button class="btn btn-danger" type="button" data-decline="${featured.id}">Decline</button></div>` : ""}
      </div>` : `<div class="featured-mission"><p class="muted">No active mission.</p></div>`}
    <div class="progress-display">
      <p class="tiny">Overall Progress</p>
      <strong>${childProgress.percent}%</strong>
      <span>${childProgress.done}/${childProgress.total} steps done</span>
    </div>
    <div class="timer-display">${formatDuration(elapsed)}</div>
    <div class="mini-stats kid-mini-stats">
      <div><p class="tiny">Open</p><strong>${assignments.length}</strong></div>
      <div><p class="tiny">Need Review</p><strong>${submitted}</strong></div>
      <div><p class="tiny">Stars</p><strong>${child.stars || 0}</strong></div>
      <div><p class="tiny">Status</p><strong>${running ? "Active" : "Paused"}</strong></div>
    </div>`;
}

function openParentKidMonitor(childId) {
  state.parentKidMonitor = childId;
  renderParentKidMonitor();
}

function renderParentKidMonitor() {
  const child = state.children.find((item) => item.id === state.parentKidMonitor);
  if (!child) {
    state.parentKidMonitor = null;
    return render();
  }
  const assignments = parentMissionAssignments(child.id);
  app.className = "app";
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="backToParentDashboardBtn">Back to Tiles</button></div></header>
    <main class="shell">
      <section class="card hero full-monitor-hero">
        <div class="kid-dashboard-tile">
          ${parentKidTileContent(child)}
        </div>
      </section>
      <section class="section-title"><h2>Mission Details</h2><span class="chip">${assignments.length} active</span></section>
      <section class="tile-grid mission-tile-grid">
        ${assignments.length ? assignments.map(parentKidAssignmentPanel).join("") : empty("No active missions", "Assigned missions will appear here.")}
      </section>
    </main>`;
  byId("backToParentDashboardBtn").addEventListener("click", () => {
    state.parentKidMonitor = null;
    render();
  });
  bindParentHandlers();
}

function renderParentMissionDetail() {
  const assignment = state.assignments.find(item => item.id === state.parentMissionDetail);
  const mission = missionById(assignment?.mission_id);
  const child = state.children.find(item => item.id === assignment?.child_id);
  if (!assignment || !mission || !child) {
    state.parentMissionDetail = null;
    return render();
  }
  const progress = assignmentProgressSummary(mission, assignment);
  app.innerHTML = `<header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="backToMissionTiles">Back to Missions</button></div></header>
    <main class="shell mission-detail-page">
      ${messageHtml()}
      <section class="section-title"><div><p class="tiny">${escapeHtml(child.display_name)} · ${escapeHtml(assignment.status)}</p><h1>${escapeHtml(mission.title || "Mission Details")}</h1></div>
        <span class="chip">${progress.percent}% · ${formatDuration(assignmentElapsedSeconds(assignment))}</span>
      </section>
      ${!isTutor() && assignment.status === "submitted" ? `<div class="action-row"><button class="btn btn-amber" data-approve="${assignment.id}">Approve</button><button class="btn btn-danger" data-decline="${assignment.id}">Decline</button></div>` : ""}
      <form data-parent-comments="${assignment.id}" class="stack">
        ${missionWorksheetTable(mission, assignment, child, "parent")}
        ${isTutor() ? "" : '<button type="submit" class="btn btn-primary">Save Mission Updates</button>'}
      </form>
    </main>`;
  byId("backToMissionTiles").addEventListener("click", () => {
    state.parentMissionDetail = null;
    state.notice = "";
    render();
  });
  bindParentHandlers();
}

function parentKidAssignmentPanel(assignment) {
  const mission = missionById(assignment.mission_id);
  const child = state.children.find((item) => item.id === assignment.child_id);
  if (!mission || !child) return "";
  const progress = assignmentProgressSummary(mission, assignment);
  return `
    <details class="assignment-tile-card card mission-monitor-tile" data-open-mission-detail="${escapeAttr(assignment.id)}">
      <summary>
        <div class="row">
          <div>
            <p class="status ${assignment.status}">${escapeHtml(categoryName(mission.category_id))} · ${escapeHtml(assignment.status)}</p>
            <h2>${escapeHtml(mission.title)}</h2>
            <p class="muted">${escapeHtml(child.display_name || "Kid")}</p>
          </div>
          <span class="chip">+${mission.reward_stars}</span>
        </div>
        <div class="mission-focus">
          <p class="tiny">Mission Progress</p>
          <strong>${progress.percent}%</strong>
          <span class="muted">${progress.done}/${progress.total} checked done</span>
        </div>
        <div class="timer-display">${formatDuration(assignmentElapsedSeconds(assignment))}</div>
        ${!isTutor() && assignment.status === "submitted" ? `<div class="action-row tile-actions"><button class="btn btn-amber" type="button" data-approve="${assignment.id}">Approve</button><button class="btn btn-danger" type="button" data-decline="${assignment.id}">Decline</button></div>` : ""}
      </summary>
      <div class="assignment-detail-panel">
        <form data-parent-comments="${assignment.id}" class="stack">
          ${missionWorksheetTable(mission, assignment, child, "parent")}
          ${isTutor() ? "" : '<button class="btn" type="submit">Save Parent Comments</button>'}
        </form>
      </div>
    </details>`;
}

function parentMissionAssignments(childId) {
  return childAssignments(childId).filter((assignment) => {
    const mission = missionById(assignment.mission_id);
    return assignment.status !== "approved" && mission?.mission_type !== "quiz";
  });
}

function assignmentTimerPanel(assignment) {
  const running = isAssignmentTimerRunning(assignment);
  const hasTime = Number(assignment.focus_elapsed_seconds || 0) > 0;
  const action = running ? "pause" : hasTime ? "continue" : "start";
  const label = running ? "Pause" : hasTime ? "Continue" : "Start";
  return `
    <div class="timer-panel">
      <div>
        <p class="tiny">${running ? "Task Timer Running" : "Task Time"}</p>
        <h2>${formatDuration(assignmentElapsedSeconds(assignment))}</h2>
      </div>
      <button class="btn ${running ? "btn-amber" : "btn-primary"}" type="button" data-timer-action="${action}" data-timer-assignment="${assignment.id}">${label}</button>
    </div>`;
}

function isAssignmentTimerRunning(assignment) {
  return Boolean(assignment?.focus_started_at);
}

function assignmentElapsedSeconds(assignment) {
  const saved = Number(assignment?.focus_elapsed_seconds || 0);
  if (!assignment?.focus_started_at) return saved;
  const startedAt = new Date(assignment.focus_started_at).getTime();
  if (Number.isNaN(startedAt)) return saved;
  return saved + Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function pauseAssignmentPayload(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment?.focus_started_at) return {};
  return {
    focus_elapsed_seconds: assignmentElapsedSeconds(assignment),
    focus_started_at: null,
  };
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

async function openParentQuizReview(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const mission = missionById(assignment?.mission_id);
  const child = state.children.find((item) => item.id === assignment?.child_id);
  if (!assignment || !mission || !child) return showError("I could not find that quiz.");
  try {
    const [questions, answers] = await Promise.all([
      supabaseGet("mn_quiz_questions", `mission_id=eq.${mission.id}&order=sort_order.asc`),
      supabaseGet("mn_quiz_answers", `assignment_id=eq.${assignmentId}`),
    ]);
    state.parentQuizReview = { assignment, mission, child, questions, answers };
    renderParentQuizReview();
  } catch (error) {
    showError(error.message);
  }
}

function renderParentQuizReview() {
  const review = state.parentQuizReview;
  const answerMap = new Map(review.answers.map((answer) => [answer.question_id, answer]));
  const correct = review.questions.filter((question) => answerMap.get(question.id)?.is_correct).length;
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="backToParentBtn">Back</button></div></header>
    <main class="shell">
      <section class="card hero">
        <div class="row">
          <div class="profile-strip">
            <div class="kid-avatar">${initials(review.child.display_name)}</div>
            <div>
              <p class="tiny">Exam Preview</p>
              <h1>${escapeHtml(review.child.display_name)}</h1>
              <p class="muted">${escapeHtml(review.child.grade || "No grade set")} · Age ${review.child.age || 8}</p>
            </div>
          </div>
          <span class="chip active">${correct}/${review.questions.length}</span>
        </div>
        <h2 style="margin-top:12px;">${escapeHtml(review.mission.title)}</h2>
        <p class="muted">${review.answers.length ? "Question numbers below show what she got correct and wrong." : "No submitted answers yet."}</p>
      </section>
      ${isTutor() ? "" : '<button class="btn btn-danger btn-wide" id="deleteReviewBtn" style="margin-top:12px;">Delete Result</button>'}
      <section class="grid" style="margin-top:12px;">
        ${review.questions.map((question, index) => parentQuestionReviewCard(question, answerMap.get(question.id), index)).join("")}
      </section>
    </main>`;
  byId("backToParentBtn").addEventListener("click", () => {
    state.parentQuizReview = null;
    render();
  });
  byId("deleteReviewBtn")?.addEventListener("click", () => deleteExamResult(review.assignment.id));
}

function parentQuestionReviewCard(question, answer, index) {
  const selected = answer?.answer || "";
  const isCorrect = Boolean(answer?.is_correct);
  return `
    <article class="card ${answer ? (isCorrect ? "success" : "error") : "notice"}">
      <div class="row">
        <p class="tiny">Question ${index + 1}</p>
        <span class="chip">${answer ? (isCorrect ? "Correct" : "Wrong") : "Not answered"}</span>
      </div>
      <h3>${escapeHtml(question.prompt)}</h3>
      <p><strong>Child answer:</strong> ${answerDisplay(question, selected)}</p>
      <p><strong>Answer key:</strong> ${answerDisplay(question, question.answer)}</p>
      ${questionExplanationHtml(question)}
    </article>`;
}

function quizSummaryHtml() {
  const latestByAssignment = new Map();
  for (const attempt of state.quizAttempts) {
    if (!latestByAssignment.has(attempt.assignment_id)) latestByAssignment.set(attempt.assignment_id, attempt);
  }
  const rows = [...latestByAssignment.values()].slice(0, 6);
  return `
    <section class="section-title"><h2>Exam Results</h2></section>
    <section class="grid">
      ${rows.length ? rows.map(quizSummaryCard).join("") : empty("No exam results yet", "Completed quizzes will appear here with scores and retakes.")}
    </section>`;
}

function quizRetakeTotal() {
  const counts = new Map();
  for (const attempt of state.quizAttempts) counts.set(attempt.assignment_id, (counts.get(attempt.assignment_id) || 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function quizSummaryCard(attempt) {
  const mission = missionById(attempt.mission_id);
  const child = state.children.find((item) => item.id === attempt.child_id);
  const assignment = state.assignments.find((item) => item.id === attempt.assignment_id);
  const totalAttempts = state.quizAttempts.filter((item) => item.assignment_id === attempt.assignment_id).length;
  const retakes = Math.max(0, totalAttempts - 1);
  const percent = Math.round((Number(attempt.score || 0) / Math.max(1, Number(attempt.total || 1))) * 100);
  const needsReview = assignment?.status === "submitted" ? "Yes" : "No";
  return `
    <article class="card quiz-result-card">
      <div class="profile-strip">
        <div class="kid-avatar small">${initials(child?.display_name)}</div>
        <div>
          <p class="tiny">${escapeHtml(child?.display_name || "Child")}</p>
          <h3>${escapeHtml(mission?.title || "Quiz")}</h3>
          <p class="muted">${escapeHtml(child?.grade || "No grade set")} · Age ${child?.age || 8}</p>
        </div>
      </div>
      <div class="score-panel">
        <p class="tiny">Latest Score</p>
        <div class="result-score">${attempt.score}/${attempt.total}</div>
        <p class="muted">${percent}% correct</p>
      </div>
      <div class="mini-stats">
        <div><p class="tiny">Need Review</p><strong>${needsReview}</strong></div>
        <div><p class="tiny">Quiz Attempts</p><strong>${totalAttempts}</strong></div>
        <div><p class="tiny">Correct Answers</p><strong>${attempt.score}</strong></div>
        <div><p class="tiny">Retakes</p><strong>${retakes}</strong></div>
      </div>
      <p class="muted"><strong>Time taken:</strong> ${attempt.duration_seconds == null ? "Not recorded" : formatDuration(attempt.duration_seconds)}${attempt.timed_out ? " · Time limit reached" : ""}</p>
      <div class="action-row">
        <button class="btn" data-review-assignment="${attempt.assignment_id}">Preview Result</button>
        ${!isTutor() && assignment?.status === "submitted" ? `<button class="btn btn-amber" data-approve="${attempt.assignment_id}">Approve</button><button class="btn btn-danger" data-decline="${attempt.assignment_id}">Decline</button>` : ""}
        ${isTutor() ? "" : `<button class="btn btn-danger" data-delete-result="${attempt.assignment_id}">Delete Result</button>`}
      </div>
    </article>`;
}

function childCard(child) {
  return `
    <details class="kid-tile-card card">
      <summary>
        <div class="kid-avatar">${initials(child.display_name)}</div>
        <div>
          <h2>${escapeHtml(child.display_name || "Unnamed child")}</h2>
          <p class="muted">${escapeHtml(child.grade || "No grade set")} · Age ${child.age || 8}</p>
        </div>
        <span class="chip">${child.stars || 0} stars</span>
        <small class="muted">Tap to update or delete</small>
      </summary>
      <div class="kid-detail-panel">
        <div class="grid grid-2">
          <div class="card" style="background:var(--surface-low);">
            <p class="tiny">Kid Login</p>
            <h3>PIN ${escapeHtml(child.kid_pin || "1234")}</h3>
            <p class="muted">This is used with the family code on the kid tablet.</p>
          </div>
          <div class="card" style="background:var(--surface-low);">
            <p class="tiny">Progress</p>
            <h3>${child.stars || 0} stars</h3>
            <p class="muted">Approved mission rewards collected.</p>
          </div>
        </div>
        <form class="grid" data-update-kid="${child.id}" style="margin-top:12px;">
          ${field("Child name", "display_name", "text", "Child name", child.display_name || "")}
          ${field("Kid PIN", "kid_pin", "text", "1234", child.kid_pin || "1234")}
          ${field("Age", "age", "number", "8", child.age || 8)}
          ${field("Grade", "grade", "text", "Grade 3", child.grade || "")}
          <div class="row">
            <button class="btn btn-primary" type="submit">Update Kid</button>
            <button class="btn btn-danger" type="button" data-delete-kid="${child.id}">Delete</button>
          </div>
        </form>
      </div>
    </details>`;
}

function childCheck(child) {
  return `
    <label class="check-row">
      <input type="checkbox" name="children" value="${child.id}">
      <span>
        <strong>${escapeHtml(child.display_name || "Unnamed child")}</strong>
        <small class="muted">${isTutor() ? "" : `PIN ${escapeHtml(child.kid_pin || "1234")} · `}${child.stars || 0} stars</small>
      </span>
    </label>`;
}

function recipientSection() {
  if (!state.children.length) {
    return `
      <section class="card notice" style="margin:12px 0;">
        <h2>Assign to</h2>
        <p class="muted">No child profile is saved yet. Add a kid first, then come back to assign this.</p>
        <button class="btn btn-primary" type="button" data-go="kids">Add Kid</button>
      </section>`;
  }
  if (state.children.length === 1) {
    const child = state.children[0];
    return `
      <section class="card success" style="margin:12px 0;">
        <div class="row">
          <div>
            <p class="tiny">Auto Assigned</p>
            <h2 style="margin-bottom:4px;">${escapeHtml(child.display_name || "Unnamed child")}</h2>
            <p class="muted" style="margin-bottom:0;">Only one child is registered, so this will be assigned automatically.</p>
          </div>
          <span class="chip">${child.stars || 0} stars</span>
        </div>
      </section>`;
  }
  return `
    <section style="margin:12px 0;">
      <div class="row" style="margin-bottom:8px;">
        <h2 style="margin-bottom:0;">Assign to</h2>
        <span class="chip">${state.children.length} kid${state.children.length === 1 ? "" : "s"}</span>
      </div>
      <div class="stack">${state.children.map(childCheck).join("")}</div>
    </section>`;
}

function categoryPicker() {
  const categories = activeCategories();
  if (isTutor()) {
    const lessons = categories.filter(isLessonsCategory);
    return `<div class="field"><label for="lessonCategory">Category</label><select id="lessonCategory" name="category_id" required>${lessons.length ? lessons.map(category => `<option value="${escapeAttr(category.id)}">${escapeHtml(category.name)}</option>`).join("") : '<option value="">Ask the parent to add a Lessons category</option>'}</select></div>`;
  }
  const selected = categories[0];
  return `
    <div class="field">
      <label>Category</label>
      <input type="hidden" name="category_id" id="categoryIdInput" value="${escapeAttr(selected?.id || "")}">
      <details class="category-picker" id="categoryPicker">
        <summary><span id="categorySelectedLabel">${escapeHtml(selected?.name || "Choose category")}</span><span>⌄</span></summary>
        <div class="category-menu">
          ${categories.length ? categories.map(categoryOption).join("") : `<div class="muted">No categories yet.</div>`}
          <button class="btn btn-wide" type="button" id="addCategoryBtn">Add Category</button>
        </div>
      </details>
    </div>`;
}

function categoryOption(category) {
  return `
    <div class="category-option">
      <button class="category-name" type="button" data-select-category="${escapeAttr(category.id)}">${escapeHtml(category.name)}</button>
      <button class="btn" type="button" data-rename-category="${escapeAttr(category.id)}">Rename</button>
      <button class="btn btn-danger" type="button" data-delete-category="${escapeAttr(category.id)}">Delete</button>
    </div>`;
}

function parseQuiz(text) {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/\\_/g, "_")
    .replace(/&#x20;/g, " ")
    .trim();
  const prepared = normalized
    .replace(/^[ \t]*(?:#{1,6}[ \t]*)?(?:Question|Q)[ \t]+(\d+)[ \t]*[.):\-]?[ \t]*(?:\n[ \t]*)?/gmi, "\n$1. ")
    .replace(/^[ \t]*(?:[-*][ \t]+)?\*?(Answer|Correct Answer|Answer Key|Tamang Sagot|Sagot|Explanation|Paliwanag)\*?[ \t]*:\*?[ \t]*/gmi, "$1: ")
    .replace(/\n\s*#{1,6}\s*/g, "\n")
    .replace(/(^|\n)\s*(\d+)\s*[.)]\s*/g, "\n$2. ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const blocks = prepared
    .split(/(?=\n?\d+\.\s+)/g)
    .map((block) => block.trim())
    .filter((block) => /^\d+\.\s+/.test(block) && /\n\s*[A-D]\s*[).:]/i.test(block));
  const questions = [];
  for (const block of blocks) {
    const answer = (
      block.match(/(?:answer|correct answer|answer key|tamang sagot|sagot)\s*[:\-]\s*([A-D])\s*[).]?/i) || []
    )[1];
    if (!answer) continue;
    const prompt = cleanQuizText(
      block
        .split(/\n\s*A\s*[).:]/i)[0]
        .replace(/^\d+\.\s*/i, "")
        .replace(/^Q\s*[:\-]\s*/i, "")
    );
    const choices = [];
    for (const label of ["A", "B", "C", "D"]) {
      const match = block.match(
        new RegExp(`(?:^|\\n)\\s*${label}\\s*[).:]\\s*([\\s\\S]*?)(?=\\n\\s*[A-D]\\s*[).:]|\\n\\s*(?:Answer|Correct Answer|Answer Key|Tamang Sagot|Sagot)\\s*[:\\-]|\\n\\s*(?:Explanation|Paliwanag)\\s*:|$)`, "i")
      );
      if (match) choices.push({ label, text: cleanQuizText(match[1]) });
    }
    if (prompt && choices.length >= 2 && choices.some((choice) => choice.label === answer.toUpperCase())) {
      questions.push({ sort_order: questions.length + 1, prompt, choices, answer: answer.toUpperCase(), explanation: "multiple_choice" });
    }
  }
  return questions;
}

function parseManualQuiz(form, quizType) {
  const prompts = form.getAll("manual_question");
  const answers = form.getAll("manual_answer");
  const questions = [];
  prompts.forEach((value, index) => {
    const prompt = String(value).trim();
    const answer = String(answers[index] || "").trim();
    if (!prompt && !answer) return;
    if (!prompt || !answer) throw new Error(`Row ${index + 1}: enter both a question and an answer.`);
    questions.push({ sort_order: questions.length + 1, prompt, answer, choices: [], explanation: quizType });
  });
  return questions;
}

function multipleChoiceQuestion(row, index) {
  const [prompt, a, b, c, d, key, explanation = ""] = row.map(value => String(value || "").trim());
  const answer = (key || "").replace(/^(?:choice|option)\s+/i, "").toUpperCase().replace(/^[ \t]*([A-D])[).:]\s*.*$/, "$1");
  const choices = [a, b, c, d].map((text, i) => ({ label: "ABCD"[i], text })).filter(choice => choice.text);
  if (!prompt || !a || !b) throw new Error(`Row ${index}: enter a question and at least choices A and B.`);
  if (!choices.some(choice => choice.label === answer)) throw new Error(`Row ${index}: the answer key must match a filled choice (A, B, C, or D).`);
  return { sort_order: index, prompt, choices, answer, explanation };
}

function parseMultipleChoiceManual(form) {
  const columns = ["mc_question", "mc_choice_A", "mc_choice_B", "mc_choice_C", "mc_choice_D", "mc_answer", "mc_explanation"].map(name => form.getAll(name));
  return columns[0].map((_, i) => columns.map(column => column[i] || ""))
    .filter(row => row.some(value => String(value).trim()))
    .map((row, i) => multipleChoiceQuestion(row, i + 1));
}

async function parseMultipleChoiceCsv(file) {
  if (!file?.name) return [];
  const rows = parseCsvRows((await file.text()).replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const header = rows[0].map(value => value.trim().toLowerCase());
  if (["question", "questions"].includes(header[0])) rows.shift();
  return rows.map((row, i) => {
    if (row.length < 6 || row.length > 7) throw new Error(`Row ${i + 1}: use Question, Choice A, Choice B, Choice C, Choice D, Answer Key, and optional Explanation columns. Quote text containing commas.`);
    return multipleChoiceQuestion(row, i + 1);
  });
}

async function parseQuizCsv(file, quizType) {
  if (!file || !file.name) return [];
  const rows = parseCsvRows(await file.text())
    .map((row) => row.map((cell) => cleanQuizText(cell)))
    .filter((row) => row.length >= 2 && row[0] && row[1]);
  const usableRows = rows.filter((row, index) => {
    if (index !== 0) return true;
    return !/^question$/i.test(row[0]) || !/^answer$/i.test(row[1]);
  });
  return usableRows.map((row, index) => ({
    sort_order: index + 1,
    prompt: row[0],
    choices: [],
    answer: row[1],
    explanation: quizType,
  }));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < String(text || "").length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((item) => item.some((cellValue) => String(cellValue).trim()));
}

function cleanQuizText(value) {
  return String(value || "")
    .replace(/^#+\s*/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quizQuestionType(question) {
  if ((question?.choices || []).length) return "multiple_choice";
  if (question?.explanation === "fill_blank" || question?.explanation === "flash_card") return question.explanation;
  return (question?.choices || []).length ? "multiple_choice" : "fill_blank";
}

function questionExplanationHtml(question) {
  const explanation = String(question.explanation || "").trim();
  if (!explanation || ["multiple_choice", "fill_blank", "flash_card"].includes(explanation)) return "";
  return `<p><strong>Explanation:</strong> ${escapeHtml(explanation)}</p>`;
}

function answersMatch(given, expected) {
  return normalizeAnswer(given) === normalizeAnswer(expected);
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?。！？]+$/g, "")
    .toLowerCase();
}

function answerDisplay(question, answer) {
  if (!answer) return "-";
  const choice = (question.choices || []).find((item) => item.label === answer);
  if (choice) return `${escapeHtml(answer)}. ${escapeHtml(choice.text)}`;
  return escapeHtml(answer);
}

async function supabaseGet(table, query = "") {
  const suffix = query ? `?${query}` : "";
  return supabaseRequest(`/rest/v1/${table}${suffix}`);
}

async function supabaseGetOptional(table, query = "") {
  try {
    return await supabaseGet(table, query);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

async function supabaseInsert(table, body) {
  const rows = await supabaseRequest(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return rows[0];
}

async function supabasePatch(table, id, body) {
  return supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

async function supabaseDelete(table, id) {
  return supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

async function supabaseRequest(path, options = {}) {
  const bearer = state.session?.accessToken || SUPABASE_ANON_KEY;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return [];
  return response.json();
}

function isMissingTableError(error) {
  return String(error?.message || error).includes("PGRST205");
}

function isMissingSchemaError(error) {
  const message = String(error?.message || error);
  return message.includes("PGRST204") || message.includes("focus_started_at") || message.includes("focus_elapsed_seconds");
}

async function authSignUp(email, password) {
  return authRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(AUTH_REDIRECT_URL)}`, { email, password });
}

async function authLogin(email, password) {
  return authRequest("/auth/v1/token?grant_type=password", { email, password });
}

async function authRequest(path, body) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || payload.error_description || "Supabase auth failed");
  return payload;
}

function activeCategories() {
  return state.categories.filter((item) => item.is_active);
}

function currentChild() {
  return state.children.find((item) => item.id === state.session.childId);
}

function childAssignments(childId) {
  return state.assignments.filter((item) => item.child_id === childId);
}

function missionById(id) {
  return state.missions.find((item) => item.id === id);
}

function categoryName(id) {
  return state.categories.find((item) => item.id === id)?.name || "Mission";
}

function setView(view) {
  state.view = view;
  state.error = "";
  state.notice = "";
  render();
}

function setSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  clearInterval(quizClockInterval);
  state.subscription = null;
  ["subscriptionReminder", "billingNotification"].forEach(id => byId(id)?.remove());
  byId("familyInviteDialog")?.remove();
  resetFamilyViews();
  localStorage.removeItem(SESSION_KEY);
  state = { ...state, session: null, family: null, familyRole: "parent", incomingInvites: [], outgoingInvites: [], username: "", promptedInvites: [], availableFamilies: [], familyAdults: [], familyJoinRequests: [], myJoinRequests: [], parentInvite: null, selectedQuiz: null, quizResult: null, children: [], categories: [], missions: [], assignments: [], quizAttempts: [], quizDraftForm: null, notice: "", error: "", view: "home" };
  render();
}

function showNotice(message) {
  state.notice = message;
  state.error = "";
  render();
}

function showError(message) {
  state.error = message;
  state.notice = "";
  render();
}

function messageHtml() {
  if (state.error) return `<div class="card error"><strong>${escapeHtml(state.error)}</strong></div>`;
  if (state.notice) return `<div class="card success"><strong>${escapeHtml(state.notice)}</strong></div>`;
  return "";
}

function brand() {
  return `<div class="brand"><span class="brand-mark">↗</span><span>MissionNest</span></div>`;
}

function tab(name, label) {
  return `<button class="tab ${state.view === name ? "active" : ""}" data-tab="${name}">${label}</button>`;
}

function field(label, name, type = "text", placeholder = "", value = "") {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" placeholder="${placeholder}" value="${escapeAttr(value)}"></div>`;
}

function textArea(label, name, placeholder = "") {
  return `<div class="field"><label>${label}</label><textarea name="${name}" placeholder="${placeholder}"></textarea></div>`;
}

function selectField(label, name, options) {
  return `<div class="field"><label>${label}</label><select name="${name}">${options.map(([value, text]) => `<option value="${value}">${escapeHtml(text)}</option>`).join("")}</select></div>`;
}

function empty(title, text) {
  return `<div class="card empty"><div><h2>${title}</h2><p class="muted">${text}</p></div></div>`;
}

function byId(id) {
  return document.getElementById(id);
}

function isEditingField() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function val(form, name) {
  return String(form.get(name) || "").trim();
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 8; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function initials(name) {
  const parts = String(name || "Kid").trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "K";
}
