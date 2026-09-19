const socket = io();
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("void_token") || "",
  user = JSON.parse(localStorage.getItem("void_user") || "null");
let tab = "login",
  roomId = "",
  localStream = null,
  screenStream = null,
  peers = new Map(),
  participants = new Map(),
  hostId = "",
  mySocketId = "";
let muted = false,
  camera = true,
  hand = false,
  locked = false,
  callStart = 0,
  timer = null;

function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2400);
}
function show(w) {
  ["auth", "dashboard", "meeting"].forEach((x) =>
    $(x).classList.toggle("hidden", x !== w),
  );
}
function authHeader() {
  return token ? { Authorization: "Bearer " + token } : {};
}
function guest() {
  user = { id: "guest-" + Date.now(), name: "Guest", email: "" };
  localStorage.setItem("void_user", JSON.stringify(user));
  enterDash();
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}
async function api(url, opt = {}) {
  const r = await fetch(url, {
    ...opt,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(opt.headers || {}),
    },
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.message || "Request failed");
  return d;
}

document.querySelectorAll(".tab").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      document
        .querySelectorAll(".tab")
        .forEach((x) => x.classList.toggle("active", x === b));
      $("signupFields").classList.toggle("hidden", tab !== "signup");
      $("authBtn").innerHTML =
        tab === "signup"
          ? "Create account <span>→</span>"
          : "Continue <span>→</span>";
    }),
);
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = await api(
      "/api/auth/" + (tab === "signup" ? "signup" : "login"),
      {
        method: "POST",
        body: JSON.stringify({
          name: $("authName").value,
          email: $("authEmail").value,
          password: $("authPassword").value,
        }),
      },
    );
    token = d.token;
    user = d.user;
    localStorage.setItem("void_token", token);
    localStorage.setItem("void_user", JSON.stringify(user));
    enterDash();
  } catch (e) {
    toast(e.message);
  }
};
$("guestBtn").onclick = guest;
$("logout").onclick = () => {
  localStorage.clear();
  location.reload();
};
function enterDash() {
  show("dashboard");
  $("welcome").textContent = user.name;
  $("userAvatar").textContent = (user.name || "G")[0].toUpperCase();
  loadHistory();
  updateClock();
}
async function loadHistory() {
  try {
    const d = await api("/api/meetings");
    $("historyList").innerHTML = d.length
      ? d
          .map(
            (m) =>
              `<div class="history-item"><span>${escapeHtml(m.title || "VOID VC Meeting")}</span><span>${new Date(m.startedAt).toLocaleString()}</span></div>`,
          )
          .join("")
      : `<div class="empty">Your meeting history will appear here.</div>`;
  } catch {}
}
function updateClock() {
  $("dashClock").textContent =
    new Date().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }) +
    " · " +
    new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  setTimeout(updateClock, 30000);
}
$("newMeeting").onclick = () =>
  join(
    Math.random().toString(36).slice(2, 8).toUpperCase(),
    "VOID VC Meeting",
    null,
    true,
  );
$("dashJoin").onclick = () => {
  let id = $("dashRoom").value.trim().toUpperCase();
  if (id) join(id, "VOID VC Meeting", null, false);
  else toast("Enter a room ID");
};
$("dashRoom").onkeydown = (e) => {
  if (e.key === "Enter") $("dashJoin").click();
};

async function join(id, title, password, isHost) {
  roomId = id;
  show("meeting");
  $("roomCode").textContent = id;
  $("roomTitle").textContent = title || "VOID VC Meeting";
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  } catch (e) {
    toast("Camera and microphone permission is required.");
    show("dashboard");
    return;
  }
  $("videoGrid").innerHTML = "";
  addLocalTile();
  callStart = Date.now();
  clearInterval(timer);
  timer = setInterval(() => {
    let s = Math.floor((Date.now() - callStart) / 1000);
    $("callTime").textContent =
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0");
  }, 1000);
  $("callStatus").textContent = "Waiting for people";
  socket.emit("join-room", {
    roomId: id,
    name: user?.name || "Guest",
    avatar: user?.avatar || "",
    password,
    title,
    userId: user?.id,
  });
}
function addLocalTile() {
  let d = document.createElement("div");
  d.className = "tile";
  d.dataset.peer = "local";
  d.innerHTML = `<video id="localVideo" autoplay muted playsinline></video><div class="name">You</div>`;
  $("videoGrid").appendChild(d);
  $("localVideo").srcObject = localStream;
}
function createPeer(id, offer) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate)
      socket.emit("signal", {
        to: id,
        data: { type: "candidate", candidate: e.candidate },
      });
  };
  pc.ontrack = (e) => attachRemote(id, e.streams[0]);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      $("callStatus").textContent = "Connected";
      $("connectionBanner").classList.add("hidden");
    } else if (["disconnected", "failed"].includes(pc.connectionState)) {
      $("connectionBanner").classList.remove("hidden");
      $("callStatus").textContent = "Reconnecting…";
    }
  };
  peers.set(id, pc);
  if (offer)
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() =>
        socket.emit("signal", {
          to: id,
          data: { type: "offer", sdp: pc.localDescription },
        }),
      );
  return pc;
}
function attachRemote(id, stream) {
  let t = document.querySelector(`[data-peer="${id}"]`);
  if (!t) {
    t = makeTile(id);
    $("videoGrid").appendChild(t);
  }
  t.querySelector("video").srcObject = stream;
}
function makeTile(id) {
  let p = participants.get(id);
  let d = document.createElement("div");
  d.className = "tile";
  d.dataset.peer = id;
  d.innerHTML = `<video autoplay playsinline></video><div class="name">${escapeHtml(p?.name || "Participant")}</div><div class="badge">● Live</div>`;
  return d;
}
function renderPeople(list) {
  participants.clear();
  list.forEach((p) => participants.set(p.id, p));
  $("peopleCount").textContent = list.length;
  $("peopleBadge").textContent = list.length;
  list.forEach((p) => {
    let t = document.querySelector(`[data-peer="${p.id}"]`);
    if (t) {
      t.querySelector(".name").textContent =
        p.id === mySocketId ? "You" : p.name || "Participant";
      t.querySelector(".badge").textContent = p.hand
        ? "✋ Hand raised"
        : "● Live";
    }
  });
  $("peopleList").innerHTML = list
    .map(
      (p) =>
        `<div class="person"><div class="person-avatar">${escapeHtml((p.name || "?")[0].toUpperCase())}</div><div class="person-info"><b>${escapeHtml(p.name)} ${p.host ? "★" : ""}</b><small>${p.muted ? "Mic off" : "Mic on"} · ${p.camera ? "Camera on" : "Camera off"}${p.hand ? " · ✋" : ""}</small></div>${hostId === mySocketId && p.id !== mySocketId ? `<div class="person-actions"><button onclick="kick('${p.id}')">Remove</button></div>` : ""}</div>`,
    )
    .join("");
}
window.kick = (id) => socket.emit("kick", { roomId, target: id });
socket.on("connect", () => {
  mySocketId = socket.id;
});
socket.on("room-state", (d) => {
  hostId = d.hostId;
  locked = false;
  $("roomTitle").textContent = d.title || "VOID VC Meeting";
  renderPeople(d.participants);
  d.participants
    .filter((p) => p.id !== mySocketId)
    .forEach((p) => {
      if (!peers.has(p.id)) createPeer(p.id, hostId === mySocketId);
    });
  $("callStatus").textContent =
    d.participants.length > 1 ? "Connected" : "Waiting for people";
});
socket.on("participant-joined", (p) => {
  participants.set(p.id, p);
  renderPeople([...participants.values()]);
  if (hostId === mySocketId) createPeer(p.id, true);
  $("callStatus").textContent = "Connecting…";
});
socket.on("signal", async ({ from, data }) => {
  let pc = peers.get(from) || createPeer(from, false);
  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(data.sdp);
      let a = await pc.createAnswer();
      await pc.setLocalDescription(a);
      socket.emit("signal", {
        to: from,
        data: { type: "answer", sdp: pc.localDescription },
      });
    } else if (data.type === "answer") await pc.setRemoteDescription(data.sdp);
    else if (data.type === "candidate")
      await pc.addIceCandidate(data.candidate);
  } catch (e) {
    console.warn(e);
  }
});
socket.on("participants", renderPeople);
socket.on("participant-left", (p) => {
  peers.get(p.id)?.close();
  peers.delete(p.id);
  document.querySelector(`[data-peer="${p.id}"]`)?.remove();
  toast(`${p.name} left`);
  $("callStatus").textContent = "Waiting for people";
});
socket.on("became-host", () => {
  hostId = mySocketId;
  toast("You are now the host");
  renderPeople([...participants.values()]);
});
socket.on("kicked", () => {
  toast("You were removed from the meeting");
  leave(false);
});
socket.on("join-error", (m) => {
  toast(m);
  leave(false);
});
socket.on("room-locked", (v) => {
  locked = v;
  $("lockBtn").textContent = v ? "🔒" : "🔓";
  toast(v ? "Room locked" : "Room unlocked");
});
socket.on("system", (m) => addMsg("VOID VC", m));
socket.on("chat", (m) => {
  addMsg(m.name, m.message, m.time);
  if (
    !document.getElementById("chatPanel").classList.contains("hidden") === false
  ) {
  }
  $("chatBadge").classList.remove("hidden");
});

function addMsg(name, msg, time = Date.now()) {
  let d = document.createElement("div");
  d.className = "msg";
  d.innerHTML = `<b>${escapeHtml(name)}</b><p>${escapeHtml(msg)}</p><time>${new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>`;
  $("chatMessages").appendChild(d);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}
$("chatForm").onsubmit = (e) => {
  e.preventDefault();
  let m = $("chatInput").value.trim();
  if (!m) return;
  socket.emit("chat", { roomId, name: user?.name || "Guest", message: m });
  $("chatInput").value = "";
};

$("mic").onclick = () => {
  muted = !muted;
  localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  $("mic").classList.toggle("on", !muted);
  $("mic").querySelector("small").textContent = muted ? "Unmute" : "Mute";
  broadcast();
};
$("camera").onclick = () => {
  camera = !camera;
  localStream?.getVideoTracks().forEach((t) => (t.enabled = camera));
  $("camera").classList.toggle("on", camera);
  $("camera").querySelector("small").textContent = camera
    ? "Camera"
    : "Camera off";
  broadcast();
};
$("hand").onclick = () => {
  hand = !hand;
  $("hand").classList.toggle("on", hand);
  $("hand").querySelector("small").textContent = hand ? "Lower" : "Raise";
  broadcast();
};
function broadcast() {
  socket.emit("state", { roomId, muted, camera, hand });
}
$("screen").onclick = async () => {
  if (screenStream) return stopScreen();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    let tr = screenStream.getVideoTracks()[0];
    peers.forEach((pc) => {
      let s = pc.getSenders().find((x) => x.track?.kind === "video");
      if (s) s.replaceTrack(tr);
    });
    $("screen").querySelector("small").textContent = "Stop";
    tr.onended = stopScreen;
  } catch {}
};
function stopScreen() {
  let tr = localStream?.getVideoTracks()[0];
  peers.forEach((pc) => {
    let s = pc.getSenders().find((x) => x.track?.kind === "video");
    if (s && tr) s.replaceTrack(tr);
  });
  screenStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  $("screen").querySelector("small").textContent = "Share";
}
$("copyInvite").onclick = async () => {
  let link = location.origin + "/?room=" + encodeURIComponent(roomId);
  try {
    await navigator.clipboard.writeText(link);
    toast("Invite link copied");
  } catch {
    prompt("Copy invite link:", link);
  }
};
$("lockBtn").onclick = () => {
  if (hostId !== mySocketId) return toast("Only the host can lock the room");
  socket.emit("lock-room", { roomId, locked: !locked });
};
$("leave").onclick = () => leave(true);
function leave(notify = true) {
  if (notify) socket.emit("leave");
  clearInterval(timer);
  peers.forEach((p) => p.close());
  peers.clear();
  localStream?.getTracks().forEach((t) => t.stop());
  screenStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  screenStream = null;
  $("videoGrid").innerHTML = "";
  participants.clear();
  show("dashboard");
  loadHistory();
}
$("fullscreen").onclick = () => document.documentElement.requestFullscreen?.();
document.querySelectorAll(".side-tab").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".side-tab")
        .forEach((x) => x.classList.toggle("active", x === b));
      $("peoplePanel").classList.toggle("hidden", b.dataset.panel !== "people");
      $("chatPanel").classList.toggle("hidden", b.dataset.panel !== "chat");
      if (b.dataset.panel === "chat") $("chatBadge").classList.add("hidden");
    }),
);
$("settingsBtn").onclick = async () => {
  await loadDevices();
  $("settingsModal").classList.remove("hidden");
};
$("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
$("saveSettings").onclick = async () => {
  try {
    await switchDevices();
    $("settingsModal").classList.add("hidden");
    toast("Devices updated");
  } catch (e) {
    toast("Could not change device");
  }
};
async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let ds = await navigator.mediaDevices.enumerateDevices();
  $("micSelect").innerHTML = "";
  $("camSelect").innerHTML = "";
  $("speakerSelect").innerHTML = "";
  ds.forEach((d) => {
    if (d.kind === "audioinput")
      $("micSelect").add(new Option(d.label || "Microphone", d.deviceId));
    if (d.kind === "videoinput")
      $("camSelect").add(new Option(d.label || "Camera", d.deviceId));
    if (d.kind === "audiooutput")
      $("speakerSelect").add(new Option(d.label || "Speaker", d.deviceId));
  });
}
async function switchDevices() {
  let a = $("micSelect").value,
    v = $("camSelect").value;
  if (!a && !v) return;
  let ns = await navigator.mediaDevices.getUserMedia({
    audio: a ? { deviceId: { exact: a } } : true,
    video: v ? { deviceId: { exact: v } } : true,
  });
  let old = localStream;
  localStream = ns;
  let lv = $("localVideo");
  if (lv) lv.srcObject = localStream;
  localStream.getTracks().forEach((t) =>
    peers.forEach((pc) => {
      let s = pc.getSenders().find((x) => x.track?.kind === t.kind);
      if (s) s.replaceTrack(t);
    }),
  );
  if ($("speakerSelect").value)
    document
      .querySelectorAll("video")
      .forEach((v) => v.setSinkId?.($("speakerSelect").value));
  old?.getTracks().forEach((t) => t.stop());
}
const urlRoom = new URLSearchParams(location.search).get("room");
if (token && user) enterDash();
else show("auth");
if (urlRoom) {
  $("dashRoom").value = urlRoom.toUpperCase();
  if (!user) guest();
  setTimeout(() => {
    $("dashRoom").value = urlRoom.toUpperCase();
  }, 80);
}
