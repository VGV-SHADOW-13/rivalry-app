import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  where,
  writeBatch,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";

/* ------------------------------------------------------------------ */
/*  Firebase                                                          */
/* ------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyCKYJ9h-YbW-KpztJblsfAcF9NMNAA-s8Q",
  authDomain: "rivalry-app-4060c.firebaseapp.com",
  projectId: "rivalry-app-4060c",
  storageBucket: "rivalry-app-4060c.firebasestorage.app",
  messagingSenderId: "955000103805",
  appId: "1:955000103805:web:f642374c6f4275a7a4a214",
  measurementId: "G-EPJYVGK71K",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/*
  Data model
  ----------
  rivalries/{rivalryId}
    name, ownerUid, members: [uid, uid?], memberNames: {uid: name},
    tasks: [...], players: {uid: {totalPoints, daily: {YYYY-MM-DD: {taskId: {...}}}}},
    createdAt
  rivalries/{rivalryId}/messages/{id}      (chat, members only)
  invites/{rivalryId}                      (public-by-link join stub: name, ownerName, open)
*/

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                               */
/* ------------------------------------------------------------------ */
const DEFAULT_TASKS = [
  { id: "t1", name: "Morning Run", category: "workout", unit: "km", defaultValue: 5, points: 10 },
  { id: "t2", name: "Push-ups", category: "workout", unit: "reps", defaultValue: 50, points: 8 },
  { id: "t3", name: "Read Book", category: "learning", unit: "pages", defaultValue: 20, points: 6 },
  { id: "t4", name: "Meditation", category: "wellness", unit: "min", defaultValue: 10, points: 5 },
  { id: "t5", name: "Water Intake", category: "wellness", unit: "glasses", defaultValue: 8, points: 4 },
  { id: "t6", name: "Study/Work", category: "learning", unit: "hours", defaultValue: 2, points: 12 },
];

const CATEGORIES = {
  workout: { color: "#ff4d4d", icon: "⚡" },
  learning: { color: "#4d9fff", icon: "📚" },
  wellness: { color: "#4dff91", icon: "🌿" },
  custom: { color: "#ffd84d", icon: "★" },
};

const RANKS = [
  { min: 0, name: "Rookie", icon: "🥉" },
  { min: 100, name: "Grinder", icon: "⚙️" },
  { min: 250, name: "Warrior", icon: "⚔️" },
  { min: 500, name: "Champion", icon: "🏆" },
  { min: 1000, name: "Legend", icon: "👑" },
];

const QUICK_REPLIES = ["💪 Let's go!", "🔥 GG!", "😤 I'm catching up!", "👑 I'm winning!", "😂 You're slow!", "⚔️ Challenge accepted!"];

const RED = "#ff4d4d";
const BLUE = "#4d9fff";

function getRank(points) {
  return [...RANKS].reverse().find((r) => points >= r.min) || RANKS[0];
}

// Local-date key (YYYY-MM-DD) so "today" rolls over at the user's midnight
function getTodayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function tsMillis(ts) {
  if (!ts) return Date.now();
  return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
}

function makeTaskId() {
  return "custom_" + Date.now();
}

function inviteLink(id) {
  return `${window.location.origin}/?join=${id}`;
}

function clearJoinParam() {
  try {
    window.history.replaceState({}, "", window.location.pathname);
  } catch {
    /* ignore */
  }
}

function authErrorMessage(err) {
  switch (err?.code) {
    case "auth/invalid-email": return "That email address looks invalid.";
    case "auth/missing-password": return "Enter a password.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/email-already-in-use": return "An account with this email already exists. Try logging in.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Wrong email or password.";
    case "auth/too-many-requests": return "Too many attempts. Wait a bit and try again.";
    case "auth/network-request-failed": return "Network error. Check your connection.";
    case "auth/operation-not-allowed": return "Email/password sign-in isn't enabled in Firebase yet.";
    default: return err?.message || "Something went wrong.";
  }
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Space+Mono:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; }
  .login-btn { background: transparent; border: 2px solid; padding: 16px 32px; font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; letter-spacing: 2px; text-transform: uppercase; }
  .login-btn:hover:not(:disabled) { transform: scale(1.03); }
  .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .glow { animation: glow 2s ease-in-out infinite alternate; }
  @keyframes glow { from { text-shadow: 0 0 20px #ff4d4d; } to { text-shadow: 0 0 40px #ff4d4d, 0 0 60px #ff4d4d; } }
  .pulse { animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
  .task-card { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 16px; margin-bottom: 12px; transition: border-color 0.2s; }
  .task-card:hover { border-color: #333; }
  .task-card.done { border-color: #1a3a1a; background: #0d1a0d; }
  .tab-btn { background: transparent; border: none; color: #555; padding: 10px 14px; font-family: 'Space Mono', monospace; font-size: 12px; cursor: pointer; letter-spacing: 2px; text-transform: uppercase; border-bottom: 2px solid transparent; transition: all 0.2s; position: relative; }
  .tab-btn.active { color: #fff; border-bottom-color: #ff4d4d; }
  .check-btn { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #333; background: transparent; color: #4dff91; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
  .check-btn.done { background: #1a3a1a; border-color: #4dff91; }
  .check-btn:hover { transform: scale(1.1); }
  .input-sm { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 6px 10px; border-radius: 6px; font-family: 'Space Mono', monospace; font-size: 13px; width: 70px; text-align: center; }
  .input-sm:focus { outline: none; border-color: #555; }
  .action-btn { background: transparent; border: 1px solid #333; color: #aaa; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; transition: all 0.2s; }
  .action-btn:hover:not(:disabled) { border-color: #666; color: #fff; }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .action-btn.primary { border-color: #ff4d4d; color: #ff4d4d; }
  .action-btn.primary:hover:not(:disabled) { background: #ff4d4d22; }
  .modal-bg { position: fixed; inset: 0; background: #000000cc; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal { background: #111; border: 1px solid #333; border-radius: 16px; padding: 28px; width: 100%; max-width: 400px; }
  .input-full { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 10px 14px; border-radius: 8px; font-family: 'Space Mono', monospace; font-size: 13px; width: 100%; margin-bottom: 12px; }
  .input-full:focus { outline: none; border-color: #ff4d4d; }
  select.input-full option { background: #111; }
  .progress-bar { height: 4px; background: #1e1e1e; border-radius: 2px; overflow: hidden; margin-top: 8px; }
  .progress-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
  @keyframes slideIn { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .flash { animation: slideIn 0.3s ease; }
  .streak { display: inline-block; background: #1a1a0a; border: 1px solid #ffd84d33; color: #ffd84d; font-size: 11px; padding: 2px 8px; border-radius: 4px; letter-spacing: 1px; }
  .live-dot { width: 6px; height: 6px; background: #4dff91; border-radius: 50%; display: inline-block; margin-right: 6px; animation: blink 1.5s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .badge { position: absolute; top: 4px; right: 4px; background: #ff4d4d; color: #fff; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; font-family: monospace; }
  .msg-bubble { max-width: 75%; padding: 10px 14px; border-radius: 16px; font-size: 13px; line-height: 1.4; word-break: break-word; }
  .msg-me { background: #1a0a0a; border: 1px solid #ff4d4d33; border-bottom-right-radius: 4px; }
  .msg-them { background: #0a0a1a; border: 1px solid #4d9fff33; border-bottom-left-radius: 4px; }
  .msg-system { background: #1a1a0a; border: 1px solid #ffd84d22; color: #ffd84d; font-size: 11px; padding: 6px 12px; border-radius: 8px; text-align: center; max-width: 100%; }
  .quick-btn { background: transparent; border: 1px solid #333; color: #888; padding: 6px 12px; border-radius: 20px; font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
  .quick-btn:hover { border-color: #ff4d4d; color: #ff4d4d; }
  .chat-input { background: #111; border: 1px solid #333; color: #fff; padding: 12px 16px; border-radius: 24px; font-family: 'Space Mono', monospace; font-size: 13px; flex: 1; outline: none; }
  .chat-input:focus { border-color: #ff4d4d; }
  .send-btn { background: #ff4d4d; border: none; color: #fff; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
  .send-btn:hover { background: #ff6666; transform: scale(1.05); }
  .send-btn:disabled { background: #333; cursor: not-allowed; transform: none; }
  .rivalry-card { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 18px; margin-bottom: 12px; cursor: pointer; transition: border-color 0.2s, transform 0.2s; text-align: left; width: 100%; color: #fff; font-family: 'Space Mono', monospace; display: block; }
  .rivalry-card:hover { border-color: #444; transform: translateY(-1px); }
  .link-box { background: #0d0d0d; border: 1px dashed #ff4d4d55; border-radius: 10px; padding: 12px; font-size: 11px; color: #aaa; word-break: break-all; }
  .err { color: #ff6b6b; font-size: 12px; margin: 0 0 12px; line-height: 1.4; }
  .auth-tabs { display: flex; margin-bottom: 20px; border-bottom: 1px solid #1e1e1e; }
`;

const pageStyle = { minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "'Space Mono', monospace" };
const heroBg = {
  backgroundImage:
    "radial-gradient(ellipse at 20% 50%, #1a0a2e 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a2e 0%, transparent 60%)",
};

function Logo({ small }) {
  return (
    <div style={{ textAlign: "center", marginBottom: small ? 28 : 48 }}>
      <div style={{ fontSize: small ? 44 : 64, marginBottom: 8 }}>⚔️</div>
      <h1 className="glow" style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: small ? "clamp(32px,8vw,48px)" : "clamp(40px,10vw,72px)", color: RED, margin: 0, letterSpacing: 8 }}>RIVALRY</h1>
      <p style={{ color: "#666", letterSpacing: 4, fontSize: 13, marginTop: 8 }}>COMPETE. COMPLETE. CONQUER.</p>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center" }}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth screen                                                       */
/* ------------------------------------------------------------------ */
function AuthScreen({ pendingInvite, onNameChosen }) {
  const [mode, setMode] = useState(pendingInvite ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (mode === "signup" && !name.trim()) return setError("Pick a display name.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: name.trim() });
        onNameChosen(name.trim());
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError("");
    setInfo("");
    if (!email.trim()) return setError("Enter your email above first.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo("Password reset email sent. Check your inbox.");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  return (
    <div style={{ ...pageStyle, ...heroBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Logo small />
      {pendingInvite && (
        <div style={{ background: "#1a1a0a", border: "1px solid #ffd84d44", color: "#ffd84d", padding: "10px 16px", borderRadius: 10, fontSize: 12, letterSpacing: 1, marginBottom: 20, maxWidth: 360, textAlign: "center", lineHeight: 1.5 }}>
          ⚔️ You've been challenged! Sign up or log in to accept the rivalry.
        </div>
      )}
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360 }}>
        <div className="auth-tabs">
          {[["login", "LOG IN"], ["signup", "SIGN UP"]].map(([id, label]) => (
            <button key={id} type="button" className={`tab-btn ${mode === id ? "active" : ""}`} style={{ flex: 1 }}
              onClick={() => { setMode(id); setError(""); setInfo(""); }}>
              {label}
            </button>
          ))}
        </div>
        {mode === "signup" && (
          <input className="input-full" placeholder="Display name" value={name} maxLength={24}
            onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
        )}
        <input className="input-full" type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <input className="input-full" type="password" placeholder="Password (6+ characters)" value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
        {error && <p className="err">{error}</p>}
        {info && <p style={{ color: "#4dff91", fontSize: 12, margin: "0 0 12px" }}>{info}</p>}
        <button className="login-btn" type="submit" disabled={busy}
          style={{ width: "100%", borderColor: RED, color: RED }}>
          {busy ? "..." : mode === "signup" ? "Create account" : "Enter the arena"}
        </button>
        {mode === "login" && (
          <button type="button" onClick={resetPassword}
            style={{ background: "transparent", border: "none", color: "#555", fontFamily: "inherit", fontSize: 11, letterSpacing: 1, cursor: "pointer", marginTop: 16, width: "100%" }}>
            Forgot password?
          </button>
        )}
      </form>
      <p className="pulse" style={{ color: "#333", marginTop: 40, fontSize: 11, letterSpacing: 3 }}>🔥 LIVE SYNC — REAL TIME</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Join screen (opened via invite link)                              */
/* ------------------------------------------------------------------ */
function JoinScreen({ joinId, user, myName, rivalries, onJoined, onCancel }) {
  const [invite, setInvite] = useState(undefined); // undefined = loading, null = not found
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alreadyMember = rivalries?.some((r) => r.id === joinId);

  useEffect(() => {
    if (alreadyMember) onJoined(joinId);
  }, [alreadyMember, joinId, onJoined]);

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "invites", joinId))
      .then((snap) => { if (!cancelled) setInvite(snap.exists() ? snap.data() : null); })
      .catch((e) => { console.error(e); if (!cancelled) setInvite(null); });
    return () => { cancelled = true; };
  }, [joinId]);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "rivalries", joinId), {
        members: arrayUnion(user.uid),
        [`memberNames.${user.uid}`]: myName,
        [`players.${user.uid}`]: { totalPoints: 0, daily: {} },
      });
      batch.update(doc(db, "invites", joinId), { open: false });
      await batch.commit();
      onJoined(joinId);
    } catch (e) {
      console.error(e);
      setError("Couldn't join. This rivalry may already be full.");
      setBusy(false);
    }
  }

  return (
    <div style={{ ...pageStyle, ...heroBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Logo small />
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        {invite === undefined && <div className="pulse" style={{ color: "#888", letterSpacing: 3 }}>LOADING INVITE...</div>}
        {invite === null && (
          <>
            <p style={{ color: "#ff6b6b", lineHeight: 1.5 }}>This invite link isn't valid.</p>
            <button className="action-btn" onClick={onCancel}>BACK</button>
          </>
        )}
        {invite && !invite.open && !alreadyMember && (
          <>
            <p style={{ color: "#ffd84d", lineHeight: 1.5 }}>This rivalry already has two players.</p>
            <button className="action-btn" onClick={onCancel}>BACK</button>
          </>
        )}
        {invite && invite.open && !alreadyMember && (
          <>
            <p style={{ color: "#888", fontSize: 12, letterSpacing: 3, marginBottom: 8 }}>YOU'VE BEEN CHALLENGED BY</p>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 32, color: RED, marginBottom: 4 }}>{invite.ownerName}</div>
            <div style={{ color: "#aaa", fontSize: 13, marginBottom: 28 }}>in “{invite.name}”</div>
            {error && <p className="err">{error}</p>}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="action-btn" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>NOT NOW</button>
              <button className="action-btn primary" style={{ flex: 1 }} onClick={accept} disabled={busy}>
                {busy ? "JOINING..." : "ACCEPT ⚔️"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Home: list of my rivalries + create                               */
/* ------------------------------------------------------------------ */
function HomeScreen({ user, myName, rivalries, onOpen, onLogout }) {
  const [creating, setCreating] = useState(false);
  const [rivalryName, setRivalryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRivalry() {
    const name = rivalryName.trim();
    if (!name) return setError("Give your rivalry a name.");
    setBusy(true);
    setError("");
    try {
      const rivalryRef = doc(collection(db, "rivalries"));
      const batch = writeBatch(db);
      batch.set(rivalryRef, {
        name,
        ownerUid: user.uid,
        members: [user.uid],
        memberNames: { [user.uid]: myName },
        tasks: DEFAULT_TASKS,
        players: { [user.uid]: { totalPoints: 0, daily: {} } },
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "invites", rivalryRef.id), {
        name,
        ownerUid: user.uid,
        ownerName: myName,
        open: true,
      });
      await batch.commit();
      setCreating(false);
      setRivalryName("");
      onOpen(rivalryRef.id);
    } catch (e) {
      console.error(e);
      setError("Couldn't create the rivalry. Check your Firestore rules.");
    }
    setBusy(false);
  }

  return (
    <div style={{ ...pageStyle, paddingBottom: 60 }}>
      <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1e1e1e", padding: "16px 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 22, color: RED, letterSpacing: 4 }}>RIVALRY</div>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 2 }}>{myName}</div>
          </div>
          <button className="action-btn" onClick={onLogout}>LOG OUT</button>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 3 }}>YOUR RIVALRIES</div>
          <button className="action-btn primary" onClick={() => { setCreating(true); setError(""); }}>+ NEW RIVALRY</button>
        </div>

        {rivalries === null && <div className="pulse" style={{ textAlign: "center", color: "#444", padding: 40, letterSpacing: 3 }}>LOADING...</div>}

        {rivalries && rivalries.length === 0 && (
          <div style={{ textAlign: "center", color: "#444", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🥊</div>
            <div style={{ letterSpacing: 2, fontSize: 12 }}>NO RIVALRIES YET</div>
            <div style={{ fontSize: 11, color: "#333", marginTop: 8 }}>Create one and send the invite link to your rival.</div>
          </div>
        )}

        {rivalries?.map((r) => {
          const rivalUid = r.members.find((m) => m !== user.uid);
          const myPts = r.players?.[user.uid]?.totalPoints || 0;
          const theirPts = rivalUid ? r.players?.[rivalUid]?.totalPoints || 0 : 0;
          const rivalName = rivalUid ? r.memberNames?.[rivalUid] || "Rival" : null;
          return (
            <button key={r.id} className="rivalry-card" onClick={() => onOpen(r.id)}>
              <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 20, letterSpacing: 2, marginBottom: 6 }}>{r.name}</div>
              {rivalName ? (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: RED }}>You · {myPts} pts</span>
                  <span style={{ color: "#444" }}>VS</span>
                  <span style={{ color: BLUE }}>{rivalName} · {theirPts} pts</span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#ffd84d" }}>⏳ Waiting for your rival to join</div>
              )}
            </button>
          );
        })}
      </div>

      {creating && (
        <div className="modal-bg" onClick={() => !busy && setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 20px", fontFamily: "'Black Han Sans', sans-serif", letterSpacing: 3, color: RED }}>+ NEW RIVALRY</h3>
            <input className="input-full" placeholder="Rivalry name (e.g. Summer Shred)" value={rivalryName} maxLength={40}
              onChange={(e) => setRivalryName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createRivalry()} autoFocus />
            {error && <p className="err">{error}</p>}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="action-btn" style={{ flex: 1 }} onClick={() => setCreating(false)} disabled={busy}>CANCEL</button>
              <button className="action-btn primary" style={{ flex: 1 }} onClick={createRivalry} disabled={busy}>{busy ? "..." : "CREATE"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Invite box (shown while waiting for the rival)                    */
/* ------------------------------------------------------------------ */
function InviteBox({ rivalryId, rivalryName }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(rivalryId);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "RIVALRY", text: `I challenge you to “${rivalryName}” on RIVALRY ⚔️`, url: link });
    } catch {
      /* cancelled */
    }
  }

  return (
    <div style={{ background: "#111", border: "1px solid #ff4d4d33", borderRadius: 12, padding: 16, marginBottom: 20 }}>
      <div style={{ fontSize: 11, color: "#ffd84d", letterSpacing: 3, marginBottom: 6 }}>⏳ WAITING FOR YOUR RIVAL</div>
      <div style={{ fontSize: 12, color: "#777", marginBottom: 12, lineHeight: 1.5 }}>
        Send this link. When they open it and sign in, they join and the rivalry begins.
      </div>
      <div className="link-box">{link}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button className="action-btn primary" style={{ flex: 1 }} onClick={copy}>{copied ? "COPIED ✓" : "COPY LINK"}</button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button className="action-btn" style={{ flex: 1 }} onClick={share}>SHARE</button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rivalry view: tasks / rival / board / chat                        */
/* ------------------------------------------------------------------ */
function RivalryView({ rivalryId, user, myName, onBack }) {
  const uid = user.uid;
  const [rivalry, setRivalry] = useState(undefined); // undefined loading, null no access
  const [activeTab, setActiveTab] = useState("today");
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", category: "custom", unit: "reps", defaultValue: 10, points: 5 });
  const [flash, setFlash] = useState(null);
  const [settingName, setSettingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);
  const flashTimer = useRef(null);
  const chatEndRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const rivalryRef = doc(db, "rivalries", rivalryId);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Live rivalry doc
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "rivalries", rivalryId),
      (snap) => setRivalry(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      (err) => { console.error("Firestore error:", err); setRivalry(null); }
    );
    return () => unsub();
  }, [rivalryId]);

  // Live chat (members only — enforced by Firestore rules)
  useEffect(() => {
    let first = true;
    const q = query(collection(db, "rivalries", rivalryId, "messages"), orderBy("timestamp", "asc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (first) { first = false; return; }
      if (activeTabRef.current !== "chat") {
        const incoming = snap.docChanges().filter((c) => c.type === "added" && c.doc.data().sender !== uid).length;
        if (incoming) setUnread((u) => u + incoming);
      } else {
        setUnread(0);
      }
    }, (err) => console.error("Chat error:", err));
    return () => unsub();
  }, [rivalryId, uid]);

  useEffect(() => {
    if (activeTab === "chat") {
      const t = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      return () => clearTimeout(t);
    }
  }, [activeTab, messages]);

  function showFlash(msg, type = "success") {
    setFlash({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  }

  async function sendMessage(text) {
    if (!text.trim()) return;
    setChatInput("");
    try {
      await addDoc(collection(db, "rivalries", rivalryId, "messages"), {
        text: text.trim(),
        sender: uid,
        senderName: rivalry?.memberNames?.[uid] || myName,
        timestamp: serverTimestamp(),
      });
    } catch (e) { console.error("Chat error", e); }
  }

  if (rivalry === undefined) {
    return <Centered><div style={{ color: RED, fontSize: 18, letterSpacing: 4 }}>CONNECTING...</div></Centered>;
  }

  if (rivalry === null || !rivalry.members?.includes(uid)) {
    return (
      <Centered>
        <p style={{ color: "#ff6b6b", marginBottom: 16 }}>This rivalry doesn't exist or you don't have access.</p>
        <button className="action-btn" onClick={onBack}>BACK</button>
      </Centered>
    );
  }

  /* ---------- derived state ---------- */
  const today = getTodayKey();
  const tasks = rivalry.tasks || [];
  const rivalUid = rivalry.members.find((m) => m !== uid) || null;
  const names = rivalry.memberNames || {};
  const myNameHere = names[uid] || myName;
  const theirName = rivalUid ? names[rivalUid] || "Rival" : "Waiting...";
  const meData = rivalry.players?.[uid] || { totalPoints: 0, daily: {} };
  const themData = rivalUid ? rivalry.players?.[rivalUid] || { totalPoints: 0, daily: {} } : null;

  const defaultState = (t) => ({ target: t.defaultValue, completed: false, actual: 0 });
  const meToday = meData.daily?.[today] || {};
  const themToday = themData?.daily?.[today] || {};
  const myState = (t) => meToday[t.id] || defaultState(t);
  const theirState = (t) => themToday[t.id] || defaultState(t);

  const myRank = getRank(meData.totalPoints || 0);
  const theirRank = getRank(themData?.totalPoints || 0);
  const myCompletedToday = tasks.filter((t) => meToday[t.id]?.completed).length;
  const theirCompletedToday = tasks.filter((t) => themToday[t.id]?.completed).length;
  const leading = (meData.totalPoints || 0) >= (themData?.totalPoints || 0) ? "me" : "them";
  // First member (the creator) is red, the second is blue — same colors for both players' screens
  const myColor = rivalry.members[0] === uid ? RED : BLUE;
  const theirColor = myColor === RED ? BLUE : RED;
  const waiting = !rivalUid;

  /* ---------- actions (each writes only the fields it changes) ---------- */
  async function completeTask(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const state = myState(task);
    const base = `players.${uid}`;
    try {
      if (!state.completed) {
        await updateDoc(rivalryRef, {
          [`${base}.daily.${today}.${taskId}`]: { target: Number(state.target), completed: true, actual: Number(state.target) },
          [`${base}.totalPoints`]: (meData.totalPoints || 0) + task.points,
        });
        showFlash(`+${task.points} pts — ${task.name} done! 🔥`);
        sendMessage(`🔥 Just completed: ${task.name} (+${task.points}pts)`);
      } else {
        await updateDoc(rivalryRef, {
          [`${base}.daily.${today}.${taskId}`]: { target: Number(state.target), completed: false, actual: 0 },
          [`${base}.totalPoints`]: Math.max(0, (meData.totalPoints || 0) - task.points),
        });
        showFlash("Task unmarked", "info");
      }
    } catch (e) { console.error("Save failed", e); showFlash("Save failed", "info"); }
  }

  async function updateTarget(taskId, value) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    try {
      await updateDoc(rivalryRef, {
        [`players.${uid}.daily.${today}.${taskId}`]: { target: Number(value), completed: false, actual: 0 },
      });
    } catch (e) { console.error("Save failed", e); }
  }

  async function addTask() {
    if (!newTask.name.trim()) return;
    const task = {
      ...newTask,
      name: newTask.name.trim(),
      id: makeTaskId(),
      defaultValue: Number(newTask.defaultValue) || 1,
      points: Number(newTask.points) || 1,
    };
    try {
      await updateDoc(rivalryRef, { tasks: arrayUnion(task) });
      setShowAddTask(false);
      setNewTask({ name: "", category: "custom", unit: "reps", defaultValue: 10, points: 5 });
      showFlash("Task added for both players!");
    } catch (e) { console.error(e); showFlash("Couldn't add task", "info"); }
  }

  async function deleteTask(taskId) {
    try {
      await updateDoc(rivalryRef, { tasks: tasks.filter((t) => t.id !== taskId) });
      showFlash("Task removed", "info");
    } catch (e) { console.error(e); }
  }

  async function saveName() {
    const n = tempName.trim();
    if (!n) return setSettingName(false);
    try {
      await updateDoc(rivalryRef, { [`memberNames.${uid}`]: n });
      showFlash("Name updated!");
    } catch (e) { console.error(e); }
    setSettingName(false);
  }

  /* ---------- render ---------- */
  const leaderboard = rivalry.members
    .map((m, i) => ({
      user: m,
      name: names[m] || "Player",
      pts: rivalry.players?.[m]?.totalPoints || 0,
      today: Object.values(rivalry.players?.[m]?.daily?.[today] || {}).filter((s) => s.completed).length,
      color: i === 0 ? RED : BLUE,
    }))
    .sort((a, b) => b.pts - a.pts);
  const topPts = Math.max(...leaderboard.map((p) => p.pts), 1);

  return (
    <div style={{ ...pageStyle, paddingBottom: 100 }}>
      {flash && (
        <div className="flash" style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: flash.type === "success" ? "#0d2a0d" : "#1a1a2a",
          border: `1px solid ${flash.type === "success" ? "#4dff91" : "#4d9fff"}`,
          color: flash.type === "success" ? "#4dff91" : "#4d9fff",
          padding: "10px 24px", borderRadius: 8, fontSize: 13, letterSpacing: 2, whiteSpace: "nowrap",
        }}>{flash.msg}</div>
      )}

      {/* Header */}
      <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1e1e1e", padding: "16px 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 18, padding: 0 }}>←</button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 20, color: myColor, letterSpacing: 2 }}>{myNameHere}</span>
                <button onClick={() => { setTempName(myNameHere); setSettingName(true); }} style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: 12 }}>✏️</button>
              </div>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2 }}>{myRank.icon} {myRank.name}</div>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 4 }}><span className="live-dot"></span>LIVE</div>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 28, color: myColor }}>{meData.totalPoints || 0}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 4 }}>{theirName}</div>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 22, color: theirColor }}>{themData?.totalPoints || 0}</div>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>{theirRank.icon} {theirRank.name}</div>
          </div>
        </div>
        {!waiting && (
          <div style={{ maxWidth: 600, margin: "12px auto 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginBottom: 4, letterSpacing: 1 }}>
              <span>{myNameHere} {myCompletedToday}/{tasks.length} today</span>
              <span>{leading === "me" ? "YOU LEAD ↑" : "BEHIND ↓"}</span>
              <span>{theirCompletedToday}/{tasks.length} today {theirName}</span>
            </div>
            <div style={{ height: 6, background: "#1e1e1e", borderRadius: 3, overflow: "hidden", display: "flex" }}>
              {(() => {
                const total = ((meData.totalPoints || 0) + (themData?.totalPoints || 0)) || 1;
                const myPct = ((meData.totalPoints || 0) / total) * 100;
                return <>
                  <div style={{ width: `${myPct}%`, background: myColor, transition: "width 0.5s" }} />
                  <div style={{ flex: 1, background: theirColor }} />
                </>;
              })()}
            </div>
          </div>
        )}
        <div style={{ maxWidth: 600, margin: "10px auto 0", fontSize: 10, color: "#333", letterSpacing: 3, textAlign: "center" }}>
          {rivalry.name.toUpperCase()}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ maxWidth: 600, margin: "0 auto", borderBottom: "1px solid #1e1e1e", display: "flex" }}>
        {[["today", "TODAY"], ["rival", "RIVAL"], ["board", "BOARD"], ["chat", "CHAT"]].map(([id, label]) => (
          <button key={id} className={`tab-btn ${activeTab === id ? "active" : ""}`} onClick={() => { setActiveTab(id); if (id === "chat") setUnread(0); }}>
            {label}
            {id === "chat" && unread > 0 && <span className="badge">{unread}</span>}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: activeTab === "chat" ? "0" : "20px 16px" }}>
        {waiting && activeTab !== "chat" && <InviteBox rivalryId={rivalryId} rivalryName={rivalry.name} />}

        {/* TODAY TAB */}
        {activeTab === "today" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 3 }}>TODAY'S TASKS</div>
                <div style={{ fontSize: 24, fontFamily: "'Black Han Sans', sans-serif", color: "#fff", marginTop: 2 }}>
                  {myCompletedToday} <span style={{ color: "#333" }}>/ {tasks.length}</span>
                </div>
              </div>
              <button className="action-btn primary" onClick={() => setShowAddTask(true)}>+ ADD TASK</button>
            </div>
            {Object.entries(
              tasks.reduce((acc, t) => { (acc[t.category] = acc[t.category] || []).push(t); return acc; }, {})
            ).map(([cat, catTasks]) => (
              <div key={cat} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: 3, color: CATEGORIES[cat]?.color || "#888", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{CATEGORIES[cat]?.icon || "★"}</span>
                  <span>{cat.toUpperCase()}</span>
                  <div style={{ flex: 1, height: 1, background: "#1e1e1e" }} />
                </div>
                {catTasks.map((task) => {
                  const state = myState(task);
                  const c = CATEGORIES[task.category] || CATEGORIES.custom;
                  return (
                    <div key={task.id} className={`task-card ${state.completed ? "done" : ""}`}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <button className={`check-btn ${state.completed ? "done" : ""}`} onClick={() => completeTask(task.id)}>
                          {state.completed ? "✓" : ""}
                        </button>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, textDecoration: state.completed ? "line-through" : "none", color: state.completed ? "#555" : "#fff" }}>
                              {task.name}
                            </span>
                            <span style={{ fontSize: 11, background: c.color + "22", color: c.color, padding: "1px 6px", borderRadius: 4 }}>+{task.points}pts</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input className="input-sm" type="number" min="1" value={state.target}
                              onChange={(e) => updateTarget(task.id, e.target.value)} disabled={state.completed} />
                            <span style={{ fontSize: 12, color: "#555" }}>{task.unit}</span>
                            {state.completed && <span className="streak">DONE ✓</span>}
                          </div>
                        </div>
                        <button onClick={() => deleteTask(task.id)} style={{ background: "transparent", border: "none", color: "#333", cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: state.completed ? "100%" : "0%", background: c.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {tasks.length === 0 && (
              <div style={{ textAlign: "center", color: "#333", padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ letterSpacing: 2 }}>NO TASKS YET</div>
              </div>
            )}
          </>
        )}

        {/* RIVAL TAB */}
        {activeTab === "rival" && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 4 }}>RIVAL'S PROGRESS</div>
              <div style={{ fontSize: 22, fontFamily: "'Black Han Sans', sans-serif", color: theirColor }}>
                {theirName}<span style={{ fontSize: 13, color: "#555", marginLeft: 8 }}>· {theirRank.icon} {theirRank.name}</span>
              </div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{theirCompletedToday}/{tasks.length} done today · {themData?.totalPoints || 0} total pts</div>
            </div>
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 12, padding: 16, marginBottom: 20, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 28, fontFamily: "'Black Han Sans', sans-serif", color: myColor }}>{meData.totalPoints || 0}</div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>{myNameHere}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", color: "#333", fontSize: 20 }}>VS</div>
              <div>
                <div style={{ fontSize: 28, fontFamily: "'Black Han Sans', sans-serif", color: theirColor }}>{themData?.totalPoints || 0}</div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>{theirName}</div>
              </div>
            </div>
            {tasks.map((task) => {
              const mine = myState(task);
              const theirs = theirState(task);
              return (
                <div key={task.id} className="task-card" style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{task.name}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>+{task.points}pts</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{mine.completed ? "✅" : "⬜"}</span>
                      <span style={{ fontSize: 12, color: "#aaa" }}>{mine.target} {task.unit}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#333", letterSpacing: 1 }}>YOU · THEM</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#aaa" }}>{waiting ? "—" : `${theirs.target} ${task.unit}`}</span>
                      <span style={{ fontSize: 14 }}>{theirs.completed ? "✅" : "⬜"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* BOARD TAB */}
        {activeTab === "board" && (
          <>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 20 }}>LEADERBOARD</div>
            {leaderboard.map((p, i) => {
              const rank = getRank(p.pts);
              const isMe = p.user === uid;
              return (
                <div key={p.user} style={{ background: isMe ? "#141014" : "#111", border: `1px solid ${isMe ? p.color + "44" : "#1e1e1e"}`, borderRadius: 12, padding: 20, marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 32, minWidth: 40, textAlign: "center" }}>{i === 0 ? "🥇" : "🥈"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 20, color: p.color }}>{p.name}</span>
                      {isMe && <span style={{ fontSize: 10, background: p.color + "22", color: p.color, padding: "2px 6px", borderRadius: 4 }}>YOU</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>{rank.icon} {rank.name} · {p.today}/{tasks.length} today</div>
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <div className="progress-fill" style={{ width: `${Math.min(100, (p.pts / topPts) * 100)}%`, background: p.color }} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 32, color: p.color }}>{p.pts}</div>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>PTS</div>
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 32, borderTop: "1px solid #1e1e1e", paddingTop: 20 }}>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 12 }}>RANK TIERS</div>
              {RANKS.map((r) => (
                <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #0e0e0e" }}>
                  <span style={{ fontSize: 20 }}>{r.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                  <span style={{ color: "#555", fontSize: 12 }}>{r.min}+ pts</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 210px)" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {waiting && <InviteBox rivalryId={rivalryId} rivalryName={rivalry.name} />}
              {messages.length === 0 && !waiting && (
                <div style={{ textAlign: "center", color: "#333", padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
                  <div style={{ letterSpacing: 2, fontSize: 12 }}>NO MESSAGES YET</div>
                  <div style={{ fontSize: 11, color: "#222", marginTop: 8 }}>Trash talk your rival!</div>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.sender === uid;
                if (msg.text?.startsWith("🔥")) {
                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: "center" }}>
                      <div className="msg-system">{msg.senderName}: {msg.text}</div>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 4 }}>
                    <div style={{ fontSize: 10, color: "#444", letterSpacing: 1, paddingInline: 4 }}>
                      {msg.senderName} · {formatTime(msg.timestamp)}
                    </div>
                    <div className={`msg-bubble ${isMe ? "msg-me" : "msg-them"}`} style={{ color: isMe ? myColor : theirColor }}>
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            <div style={{ padding: "8px 16px", display: "flex", gap: 8, overflowX: "auto", borderTop: "1px solid #1a1a1a" }}>
              {QUICK_REPLIES.map((q) => (
                <button key={q} className="quick-btn" onClick={() => sendMessage(q)}>{q}</button>
              ))}
            </div>

            <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a", display: "flex", gap: 10, alignItems: "center" }}>
              <input
                className="chat-input"
                placeholder="Trash talk your rival..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(chatInput)}
              />
              <button className="send-btn" onClick={() => sendMessage(chatInput)} disabled={!chatInput.trim()}>↑</button>
            </div>
          </div>
        )}
      </div>

      {/* Add task modal */}
      {showAddTask && (
        <div className="modal-bg" onClick={() => setShowAddTask(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 20px", fontFamily: "'Black Han Sans', sans-serif", letterSpacing: 3, color: RED }}>+ NEW TASK</h3>
            <p style={{ color: "#555", fontSize: 11, letterSpacing: 2, margin: "0 0 16px" }}>ADDED FOR BOTH PLAYERS</p>
            <input className="input-full" placeholder="Task name" value={newTask.name} onChange={(e) => setNewTask({ ...newTask, name: e.target.value })} />
            <select className="input-full" value={newTask.category} onChange={(e) => setNewTask({ ...newTask, category: e.target.value })}>
              {Object.keys(CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input-full" placeholder="Unit (reps, km, min...)" value={newTask.unit} onChange={(e) => setNewTask({ ...newTask, unit: e.target.value })} />
            <div style={{ display: "flex", gap: 12 }}>
              <input className="input-full" type="number" placeholder="Default amount" value={newTask.defaultValue} onChange={(e) => setNewTask({ ...newTask, defaultValue: e.target.value })} style={{ flex: 1 }} />
              <input className="input-full" type="number" placeholder="Points" value={newTask.points} onChange={(e) => setNewTask({ ...newTask, points: e.target.value })} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <button className="action-btn" style={{ flex: 1 }} onClick={() => setShowAddTask(false)}>CANCEL</button>
              <button className="action-btn primary" style={{ flex: 1 }} onClick={addTask}>ADD TASK</button>
            </div>
          </div>
        </div>
      )}

      {/* Name modal */}
      {settingName && (
        <div className="modal-bg" onClick={() => setSettingName(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 20px", fontFamily: "'Black Han Sans', sans-serif", letterSpacing: 3 }}>YOUR NAME</h3>
            <p style={{ color: "#555", fontSize: 11, letterSpacing: 2, margin: "0 0 16px" }}>FOR THIS RIVALRY</p>
            <input className="input-full" value={tempName} maxLength={24} onChange={(e) => setTempName(e.target.value)} placeholder="Enter name" onKeyDown={(e) => e.key === "Enter" && saveName()} />
            <div style={{ display: "flex", gap: 12 }}>
              <button className="action-btn" style={{ flex: 1 }} onClick={() => setSettingName(false)}>CANCEL</button>
              <button className="action-btn primary" style={{ flex: 1 }} onClick={saveName}>SAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root                                                              */
/* ------------------------------------------------------------------ */
export default function RivalryApp() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [myName, setMyName] = useState("");
  const [rivalries, setRivalries] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [joinId, setJoinId] = useState(() => new URLSearchParams(window.location.search).get("join"));

  // Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setMyName(u ? u.displayName || (u.email ? u.email.split("@")[0] : "Player") : "");
      if (!u) { setRivalries(null); setCurrentId(null); }
    });
    return () => unsub();
  }, []);

  // My rivalries (only ones I'm a member of)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rivalries"), where("members", "array-contains", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      setRivalries(list);
    }, (err) => { console.error("Rivalries error:", err); setRivalries([]); });
    return () => unsub();
  }, [user]);

  function openRivalry(id) {
    clearJoinParam();
    setJoinId(null);
    setCurrentId(id);
  }

  function cancelJoin() {
    clearJoinParam();
    setJoinId(null);
  }

  async function logout() {
    setCurrentId(null);
    await signOut(auth);
  }

  let screen;
  if (user === undefined) {
    screen = <Centered><div style={{ color: RED, fontSize: 18, letterSpacing: 4 }}>CONNECTING...</div></Centered>;
  } else if (!user) {
    screen = <AuthScreen pendingInvite={!!joinId} onNameChosen={setMyName} />;
  } else if (joinId) {
    screen = <JoinScreen joinId={joinId} user={user} myName={myName} rivalries={rivalries} onJoined={openRivalry} onCancel={cancelJoin} />;
  } else if (currentId) {
    screen = <RivalryView key={currentId} rivalryId={currentId} user={user} myName={myName} onBack={() => setCurrentId(null)} />;
  } else {
    screen = <HomeScreen user={user} myName={myName} rivalries={rivalries} onOpen={openRivalry} onLogout={logout} />;
  }

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      {screen}
    </>
  );
}
