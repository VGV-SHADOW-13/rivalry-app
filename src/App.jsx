import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, query, orderBy, limit } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCKYJ9h-YbW-KpztJblsfAcF9NMNAA-s8Q",
  authDomain: "rivalry-app-4060c.firebaseapp.com",
  projectId: "rivalry-app-4060c",
  storageBucket: "rivalry-app-4060c.firebasestorage.app",
  messagingSenderId: "955000103805",
  appId: "1:955000103805:web:f642374c6f4275a7a4a214",
  measurementId: "G-EPJYVGK71K"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

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

function getRank(points) {
  return [...RANKS].reverse().find((r) => points >= r.min) || RANKS[0];
}

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

function initPlayerState(tasks) {
  return tasks.reduce((acc, t) => {
    acc[t.id] = { target: t.defaultValue, completed: false, actual: 0 };
    return acc;
  }, {});
}

function buildInitialData() {
  const today = getTodayKey();
  return {
    tasks: DEFAULT_TASKS,
    names: { player1: "Player 1", player2: "Player 2" },
    player1: { totalPoints: 0, history: {}, daily: { [today]: initPlayerState(DEFAULT_TASKS) } },
    player2: { totalPoints: 0, history: {}, daily: { [today]: initPlayerState(DEFAULT_TASKS) } },
  };
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RivalryApp() {
  const [screen, setScreen] = useState("login");
  const [activeUser, setActiveUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const docRef = doc(db, "rivalry", "shared");
  const chatRef = collection(db, "rivalry-chat");

  useEffect(() => {
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setData(snap.data());
      } else {
        const initial = buildInitialData();
        setDoc(docRef, initial);
        setData(initial);
      }
      setLoading(false);
    }, (err) => {
      console.error("Firestore error:", err);
      setData(buildInitialData());
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(chatRef, orderBy("timestamp", "asc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
      if (activeTab !== "chat") {
        setUnread(u => u + snap.docChanges().filter(c => c.type === "added").length);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (activeTab === "chat") {
      setUnread(0);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [activeTab, messages]);

  async function saveData(newData) {
    setData(newData);
    try { await setDoc(docRef, newData); } catch (e) { console.error("Save failed", e); }
  }

  async function sendMessage(text) {
    if (!text.trim() || !activeUser) return;
    setChatInput("");
    try {
      await addDoc(chatRef, {
        text: text.trim(),
        sender: activeUser,
        senderName: data?.names?.[activeUser] || activeUser,
        timestamp: new Date(),
      });
    } catch (e) { console.error("Chat error", e); }
  }

  function showFlash(msg, type = "success") {
    setFlash({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  }

  function getOrCreateToday(playerData) {
    const today = getTodayKey();
    if (!playerData.daily[today]) playerData.daily[today] = initPlayerState(data.tasks);
    return today;
  }

  function completeTask(taskId) {
    const d = JSON.parse(JSON.stringify(data));
    const player = d[activeUser];
    const today = getOrCreateToday(player);
    const taskState = player.daily[today][taskId];
    const task = d.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!taskState.completed) {
      taskState.completed = true;
      taskState.actual = taskState.target;
      player.totalPoints += task.points;
      saveData(d);
      showFlash(`+${task.points} pts — ${task.name} done! 🔥`);
      sendMessage(`🔥 Just completed: ${task.name} (+${task.points}pts)`);
    } else {
      taskState.completed = false;
      taskState.actual = 0;
      player.totalPoints = Math.max(0, player.totalPoints - task.points);
      saveData(d);
      showFlash(`Task unmarked`, "info");
    }
  }

  function updateTarget(taskId, value) {
    const d = JSON.parse(JSON.stringify(data));
    const player = d[activeUser];
    const today = getOrCreateToday(player);
    if (!player.daily[today][taskId]) player.daily[today][taskId] = { target: value, completed: false, actual: 0 };
    else player.daily[today][taskId].target = Number(value);
    saveData(d);
  }

  function addTask() {
    if (!newTask.name.trim()) return;
    const d = JSON.parse(JSON.stringify(data));
    const id = "custom_" + Date.now();
    const task = { ...newTask, id, defaultValue: Number(newTask.defaultValue), points: Number(newTask.points) };
    d.tasks.push(task);
    const today = getTodayKey();
    ["player1", "player2"].forEach((p) => {
      if (!d[p].daily[today]) d[p].daily[today] = {};
      d[p].daily[today][id] = { target: task.defaultValue, completed: false, actual: 0 };
    });
    saveData(d);
    setShowAddTask(false);
    setNewTask({ name: "", category: "custom", unit: "reps", defaultValue: 10, points: 5 });
    showFlash("Task added for both players!");
  }

  function deleteTask(taskId) {
    const d = JSON.parse(JSON.stringify(data));
    d.tasks = d.tasks.filter((t) => t.id !== taskId);
    saveData(d);
    showFlash("Task removed", "info");
  }

  function saveName() {
    const d = JSON.parse(JSON.stringify(data));
    d.names[activeUser] = tempName || d.names[activeUser];
    saveData(d);
    setSettingName(false);
    showFlash("Name updated!");
  }

  if (loading) {
    return (
      <div style={{ background: "#0a0a0a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ff4d4d", fontFamily: "monospace", fontSize: 18, letterSpacing: 4 }}>CONNECTING...</div>
      </div>
    );
  }

  if (!data) return null;

  const today = getTodayKey();
  const names = data.names || { player1: "Player 1", player2: "Player 2" };
  const p1Today = data.player1.daily[today] || initPlayerState(data.tasks);
  const p2Today = data.player2.daily[today] || initPlayerState(data.tasks);
  const meToday = activeUser === "player1" ? p1Today : p2Today;
  const themToday = activeUser === "player1" ? p2Today : p1Today;
  const meData = activeUser ? data[activeUser] : null;
  const themData = activeUser ? data[activeUser === "player1" ? "player2" : "player1"] : null;
  const myName = activeUser ? names[activeUser] : "";
  const theirName = activeUser ? names[activeUser === "player1" ? "player2" : "player1"] : "";
  const myRank = meData ? getRank(meData.totalPoints) : RANKS[0];
  const theirRank = themData ? getRank(themData.totalPoints) : RANKS[0];
  const myCompletedToday = data.tasks.filter((t) => meToday[t.id]?.completed).length;
  const theirCompletedToday = data.tasks.filter((t) => themToday[t.id]?.completed).length;
  const leading = meData && themData ? (meData.totalPoints >= themData.totalPoints ? "me" : "them") : "me";
  const myColor = activeUser === "player1" ? "#ff4d4d" : "#4d9fff";
  const theirColor = activeUser === "player1" ? "#4d9fff" : "#ff4d4d";

  if (screen === "login") {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0a",
        backgroundImage: "radial-gradient(ellipse at 20% 50%, #1a0a2e 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a2e 0%, transparent 60%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "'Courier New', monospace", padding: 20
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Space+Mono:wght@400;700&display=swap');
          .login-btn { background: transparent; border: 2px solid; padding: 20px 40px; font-family: 'Space Mono', monospace; font-size: 18px; font-weight: 700; cursor: pointer; transition: all 0.2s; letter-spacing: 2px; text-transform: uppercase; }
          .login-btn:hover { transform: scale(1.05); }
          .glow { animation: glow 2s ease-in-out infinite alternate; }
          @keyframes glow { from { text-shadow: 0 0 20px #ff4d4d; } to { text-shadow: 0 0 40px #ff4d4d, 0 0 60px #ff4d4d; } }
          .pulse { animation: pulse 1.5s ease-in-out infinite; }
          @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        `}</style>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 64, marginBottom: 8 }}>⚔️</div>
          <h1 className="glow" style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: "clamp(40px,10vw,72px)", color: "#ff4d4d", margin: 0, letterSpacing: 8 }}>RIVALRY</h1>
          <p style={{ color: "#666", letterSpacing: 4, fontSize: 13, marginTop: 8 }}>COMPETE. COMPLETE. CONQUER.</p>
        </div>
        <p style={{ color: "#888", marginBottom: 32, letterSpacing: 3, fontSize: 13 }}>WHO ARE YOU?</p>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          {["player1", "player2"].map((p) => {
            const r = getRank(data[p].totalPoints);
            return (
              <button key={p} className="login-btn"
                style={{ borderColor: p === "player1" ? "#ff4d4d" : "#4d9fff", color: p === "player1" ? "#ff4d4d" : "#4d9fff" }}
                onClick={() => { setActiveUser(p); setScreen("app"); setUnread(0); }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{r.icon}</div>
                <div>{names[p]}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{r.name} · {data[p].totalPoints} pts</div>
              </button>
            );
          })}
        </div>
        <p className="pulse" style={{ color: "#333", marginTop: 60, fontSize: 11, letterSpacing: 3 }}>🔥 LIVE SYNC — REAL TIME</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "'Space Mono', monospace", paddingBottom: 100 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; }
        .task-card { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 16px; margin-bottom: 12px; transition: border-color 0.2s; }
        .task-card:hover { border-color: #333; }
        .task-card.done { border-color: #1a3a1a; background: #0d1a0d; }
        .tab-btn { background: transparent; border: none; color: #555; padding: 10px 14px; font-family: 'Space Mono', monospace; font-size: 12px; cursor: pointer; letter-spacing: 2px; text-transform: uppercase; border-bottom: 2px solid transparent; transition: all 0.2s; position: relative; }
        .tab-btn.active { color: #fff; border-bottom-color: #ff4d4d; }
        .check-btn { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #333; background: transparent; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
        .check-btn.done { background: #1a3a1a; border-color: #4dff91; }
        .check-btn:hover { transform: scale(1.1); }
        .input-sm { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 6px 10px; border-radius: 6px; font-family: 'Space Mono', monospace; font-size: 13px; width: 70px; text-align: center; }
        .input-sm:focus { outline: none; border-color: #555; }
        .action-btn { background: transparent; border: 1px solid #333; color: #aaa; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; transition: all 0.2s; }
        .action-btn:hover { border-color: #666; color: #fff; }
        .action-btn.primary { border-color: #ff4d4d; color: #ff4d4d; }
        .action-btn.primary:hover { background: #ff4d4d22; }
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
      `}</style>

      {flash && (
        <div className="flash" style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: flash.type === "success" ? "#0d2a0d" : "#1a1a2a",
          border: `1px solid ${flash.type === "success" ? "#4dff91" : "#4d9fff"}`,
          color: flash.type === "success" ? "#4dff91" : "#4d9fff",
          padding: "10px 24px", borderRadius: 8, fontSize: 13, letterSpacing: 2, whiteSpace: "nowrap"
        }}>{flash.msg}</div>
      )}

      {/* Header */}
      <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1e1e1e", padding: "16px 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setScreen("login")} style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 18, padding: 0 }}>←</button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 20, color: myColor, letterSpacing: 2 }}>{myName}</span>
                <button onClick={() => { setTempName(myName); setSettingName(true); }} style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: 12 }}>✏️</button>
              </div>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2 }}>{myRank.icon} {myRank.name}</div>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 4 }}><span className="live-dot"></span>LIVE</div>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 28, color: myColor }}>{meData?.totalPoints || 0}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 4 }}>{theirName}</div>
            <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 22, color: theirColor }}>{themData?.totalPoints || 0}</div>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>{theirRank.icon} {theirRank.name}</div>
          </div>
        </div>
        {meData && themData && (
          <div style={{ maxWidth: 600, margin: "12px auto 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginBottom: 4, letterSpacing: 1 }}>
              <span>{myName} {myCompletedToday}/{data.tasks.length} today</span>
              <span>{leading === "me" ? "YOU LEAD ↑" : "BEHIND ↓"}</span>
              <span>{theirCompletedToday}/{data.tasks.length} today {theirName}</span>
            </div>
            <div style={{ height: 6, background: "#1e1e1e", borderRadius: 3, overflow: "hidden", display: "flex" }}>
              {(() => {
                const total = (meData.totalPoints + themData.totalPoints) || 1;
                const myPct = (meData.totalPoints / total) * 100;
                return <>
                  <div style={{ width: `${myPct}%`, background: myColor, transition: "width 0.5s" }} />
                  <div style={{ flex: 1, background: theirColor }} />
                </>;
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ maxWidth: 600, margin: "0 auto", borderBottom: "1px solid #1e1e1e", display: "flex" }}>
        {[["today", "TODAY"], ["rival", "RIVAL"], ["board", "BOARD"], ["chat", "CHAT"]].map(([id, label]) => (
          <button key={id} className={`tab-btn ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>
            {label}
            {id === "chat" && unread > 0 && <span className="badge">{unread}</span>}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: activeTab === "chat" ? "0" : "20px 16px" }}>

        {/* TODAY TAB */}
        {activeTab === "today" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 3 }}>TODAY'S TASKS</div>
                <div style={{ fontSize: 24, fontFamily: "'Black Han Sans', sans-serif", color: "#fff", marginTop: 2 }}>
                  {myCompletedToday} <span style={{ color: "#333" }}>/ {data.tasks.length}</span>
                </div>
              </div>
              <button className="action-btn primary" onClick={() => setShowAddTask(true)}>+ ADD TASK</button>
            </div>
            {Object.entries(
              data.tasks.reduce((acc, t) => { (acc[t.category] = acc[t.category] || []).push(t); return acc; }, {})
            ).map(([cat, tasks]) => (
              <div key={cat} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: 3, color: CATEGORIES[cat]?.color || "#888", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{CATEGORIES[cat]?.icon || "★"}</span>
                  <span>{cat.toUpperCase()}</span>
                  <div style={{ flex: 1, height: 1, background: "#1e1e1e" }} />
                </div>
                {tasks.map((task) => {
                  const state = meToday[task.id] || { target: task.defaultValue, completed: false, actual: 0 };
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
            {data.tasks.length === 0 && (
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
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{theirCompletedToday}/{data.tasks.length} done today · {themData?.totalPoints || 0} total pts</div>
            </div>
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 12, padding: 16, marginBottom: 20, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 28, fontFamily: "'Black Han Sans', sans-serif", color: myColor }}>{meData?.totalPoints || 0}</div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>{myName}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", color: "#333", fontSize: 20 }}>VS</div>
              <div>
                <div style={{ fontSize: 28, fontFamily: "'Black Han Sans', sans-serif", color: theirColor }}>{themData?.totalPoints || 0}</div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>{theirName}</div>
              </div>
            </div>
            {data.tasks.map((task) => {
              const myState = meToday[task.id] || { completed: false, target: task.defaultValue };
              const theirState = themToday[task.id] || { completed: false, target: task.defaultValue };
              return (
                <div key={task.id} className="task-card" style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{task.name}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>+{task.points}pts</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{myState.completed ? "✅" : "⬜"}</span>
                      <span style={{ fontSize: 12, color: "#aaa" }}>{myState.target} {task.unit}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#333", letterSpacing: 1 }}>YOU · THEM</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#aaa" }}>{theirState.target} {task.unit}</span>
                      <span style={{ fontSize: 14 }}>{theirState.completed ? "✅" : "⬜"}</span>
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
            {[
              { user: "player1", name: names.player1, pts: data.player1.totalPoints, today: Object.values(data.player1.daily[today] || {}).filter((s) => s.completed).length },
              { user: "player2", name: names.player2, pts: data.player2.totalPoints, today: Object.values(data.player2.daily[today] || {}).filter((s) => s.completed).length },
            ].sort((a, b) => b.pts - a.pts).map((p, i) => {
              const rank = getRank(p.pts);
              const isMe = p.user === activeUser;
              const color = p.user === "player1" ? "#ff4d4d" : "#4d9fff";
              return (
                <div key={p.user} style={{ background: isMe ? "#141014" : "#111", border: `1px solid ${isMe ? color + "44" : "#1e1e1e"}`, borderRadius: 12, padding: 20, marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 32, minWidth: 40, textAlign: "center" }}>{i === 0 ? "🥇" : "🥈"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 20, color }}>{p.name}</span>
                      {isMe && <span style={{ fontSize: 10, background: color + "22", color, padding: "2px 6px", borderRadius: 4 }}>YOU</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>{rank.icon} {rank.name} · {p.today}/{data.tasks.length} today</div>
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <div className="progress-fill" style={{ width: `${Math.min(100, (p.pts / (Math.max(data.player1.totalPoints, data.player2.totalPoints) || 1)) * 100)}%`, background: color }} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Black Han Sans', sans-serif", fontSize: 32, color }}>{p.pts}</div>
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
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#333", padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
                  <div style={{ letterSpacing: 2, fontSize: 12 }}>NO MESSAGES YET</div>
                  <div style={{ fontSize: 11, color: "#222", marginTop: 8 }}>Trash talk your rival!</div>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.sender === activeUser;
                const isSystem = msg.text?.startsWith("🔥");
                if (isSystem) {
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

            {/* Quick replies */}
            <div style={{ padding: "8px 16px", display: "flex", gap: 8, overflowX: "auto", borderTop: "1px solid #1a1a1a" }}>
              {QUICK_REPLIES.map((q) => (
                <button key={q} className="quick-btn" onClick={() => sendMessage(q)}>{q}</button>
              ))}
            </div>

            {/* Input */}
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
            <h3 style={{ margin: "0 0 20px", fontFamily: "'Black Han Sans', sans-serif", letterSpacing: 3, color: "#ff4d4d" }}>+ NEW TASK</h3>
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
            <input className="input-full" value={tempName} onChange={(e) => setTempName(e.target.value)} placeholder="Enter name" onKeyDown={(e) => e.key === "Enter" && saveName()} />
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
