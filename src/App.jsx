import { useState, useEffect } from "react";
import { auth, db } from "./firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import {
  collection, doc, getDoc, setDoc, updateDoc, addDoc,
  query, orderBy, onSnapshot,
  serverTimestamp, increment, Timestamp,
} from "firebase/firestore";

function SlotsBar({ taken, total = 10, size = 10 }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: 2,
            background: i < taken ? "#6C63FF" : "rgba(108,99,255,0.12)",
            border: i < taken ? "none" : "1px solid rgba(108,99,255,0.25)",
            transition: "background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

function Badge({ children, color }) {
  const colors = {
    green: { bg: "#e6faf3", text: "#0f7a4e" },
    yellow: { bg: "#fff8e1", text: "#b45309" },
    blue: { bg: "#eef2ff", text: "#4338ca" },
    gray: { bg: "#f3f4f6", text: "#6b7280" },
    red: { bg: "#fef2f2", text: "#b91c1c" },
    purple: { bg: "rgba(108,99,255,0.1)", text: "#6C63FF" },
  };
  const c = colors[color] || colors.gray;
  return (
    <span style={{
      display: "inline-block", fontSize: 11, padding: "3px 9px",
      borderRadius: 20, fontWeight: 600, letterSpacing: 0.2,
      background: c.bg, color: c.text,
    }}>{children}</span>
  );
}

function Timer({ seconds, onExpire }) {
  const [secs, setSecs] = useState(seconds);
  useEffect(() => {
    if (secs <= 0) { onExpire?.(); return; }
    const t = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);
  const h = String(Math.floor(secs / 3600)).padStart(2, "0");
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{h}:{m}:{s}</span>;
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [codes, setCodes] = useState([]);
  const [loginError, setLoginError] = useState("");
  const [uploadCode, setUploadCode] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [reportedIds, setReportedIds] = useState(new Set());

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        const userRef = doc(db, "users", u.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            email: u.email,
            hasReceivedCode: false,
            hasUploadedCode: false,
            lastReceivedCodeId: null,
            lastReceivedCode: null,
            markedTaken: false,
            lockoutEnds: null,
            uploadedCodeId: null,
            uploadedCode: null,
            notifications: { newCodes: true, renewal: true },
            history: [],
            createdAt: serverTimestamp(),
          });
        }
      }
    });
    return unsub;
  }, []);

  // Real-time profile listener
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (snap.exists()) setProfile({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [user]);

  // Real-time codes listener
  useEffect(() => {
    const q = query(collection(db, "codes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      setCodes(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // Computed values
  const lockoutDate = profile?.lockoutEnds?.toDate ? profile.lockoutEnds.toDate() : (profile?.lockoutEnds ? new Date(profile.lockoutEnds) : null);
  const isLocked = lockoutDate && Date.now() < lockoutDate.getTime();
  const lockSecsLeft = isLocked ? Math.floor((lockoutDate.getTime() - Date.now()) / 1000) : 0;
  const mustUpload = !!user && !!profile?.markedTaken && !profile?.hasUploadedCode;
  const receivedCodeData = codes.find(c => c.id === profile?.lastReceivedCodeId);
  const myCodeData = codes.find(c => c.id === profile?.uploadedCodeId);
  const totalShared = codes.reduce((sum, c) => sum + (c.takenSlots || 0), 0);

  function timeAgo(timestamp) {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "עכשיו";
    if (diffMins < 60) return `לפני ${diffMins} דקות`;
    if (diffHours < 24) return `לפני ${diffHours} שעות`;
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString("he-IL");
  }

  // Login with Google
  async function login() {
    setLoginError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setScreen("home");
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setLoginError("שגיאה בכניסה עם גוגל. נסה שוב.");
      }
      console.error(err);
    }
  }

  async function logout() {
    await signOut(auth);
    setScreen("home");
  }

  // Get a random available code
  async function getCode() {
    if (!user || !profile || isLocked) return;
    const available = codes.filter(c => c.remainingSlots > 0 && c.uploadedBy !== user.uid);
    if (!available.length) return;
    const pick = available[Math.floor(Math.random() * available.length)];
    try {
      await updateDoc(doc(db, "codes", pick.id), {
        remainingSlots: increment(-1),
        takenSlots: increment(1),
      });
      await updateDoc(doc(db, "users", user.uid), {
        hasReceivedCode: true,
        lastReceivedCodeId: pick.id,
        lastReceivedCode: pick.code,
        markedTaken: false,
      });
      setScreen("get");
    } catch (err) {
      console.error("Error getting code:", err);
    }
  }

  // Mark code as taken — starts 24h lockout
  async function markTaken() {
    if (!user || !profile) return;
    const lockoutEnds = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const historyEntry = {
      code: profile.lastReceivedCode,
      date: new Date().toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" }),
      status: "active",
    };
    try {
      await updateDoc(doc(db, "users", user.uid), {
        markedTaken: true,
        lockoutEnds,
        history: [historyEntry, ...(profile.history || [])],
      });
    } catch (err) {
      console.error("Error marking taken:", err);
    }
  }

  // Upload a new code
  async function submitUpload(e) {
    e.preventDefault();
    setUploadError("");
    const code = uploadCode.trim().toUpperCase();
    if (!code || code.length < 10) {
      setUploadError("קוד לא תקין — בדוק שוב");
      return;
    }
    if (!/^[A-Z0-9-]+$/.test(code)) {
      setUploadError("קוד יכול להכיל רק אותיות באנגלית, מספרים ומקפים");
      return;
    }
    if (codes.some(c => c.code === code)) {
      setUploadError("קוד זה כבר קיים במערכת");
      return;
    }
    try {
      const codeRef = await addDoc(collection(db, "codes"), {
        code,
        remainingSlots: 10,
        takenSlots: 0,
        uploadedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "users", user.uid), {
        hasUploadedCode: true,
        uploadedCodeId: codeRef.id,
        uploadedCode: code,
      });
      setUploadCode("");
    } catch (err) {
      setUploadError("שגיאה בהעלאת הקוד. נסה שוב.");
      console.error(err);
    }
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function reportCode(id) {
    if (!user) return;
    try {
      await addDoc(collection(db, "reports"), {
        codeId: id,
        reportedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setReportedIds(prev => new Set([...prev, id]));
    } catch (err) {
      console.error("Error reporting:", err);
    }
  }

  async function toggleNotification(key) {
    if (!user || !profile) return;
    await updateDoc(doc(db, "users", user.uid), {
      [`notifications.${key}`]: !profile.notifications?.[key],
    });
  }

  const NAV = [
    { id: "home", label: "בית" },
    { id: "get", label: "חלק קוד" },
    { id: "bank", label: "בנק קודים" },
    ...(user ? [{ id: "profile", label: "האזור שלי" }] : []),
  ];

  if (authLoading) {
    return (
      <div dir="rtl" style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#faf9ff", fontFamily: "'Assistant', sans-serif",
      }}>
        <p style={{ color: "#6C63FF", fontSize: 16 }}>טוען...</p>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{
      minHeight: "100vh",
      background: "#faf9ff",
      fontFamily: "'Noto Sans Hebrew', 'Assistant', sans-serif",
      color: "#1a1523",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* header */}
      <header style={{
        background: "#fff",
        borderBottom: "1px solid #ede9fe",
        padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56, position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, #6C63FF, #a78bfa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 14,
          }}>G</div>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>GeminiShare</span>
        </div>
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#7c6fcd" }}>{user.email}</span>
            <button onClick={logout}
              style={{ fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>
              יציאה
            </button>
          </div>
        ) : (
          <button onClick={() => setScreen("login")} style={{
            fontSize: 13, padding: "6px 16px", borderRadius: 20,
            border: "1px solid #ede9fe", background: "#fff", cursor: "pointer",
            color: "#6C63FF", fontWeight: 600,
          }}>כניסה / הרשמה</button>
        )}
      </header>

      {/* nav */}
      <nav style={{
        background: "#fff", borderBottom: "1px solid #ede9fe",
        display: "flex", padding: "0 16px", gap: 4,
      }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => {
            if (!user && ["get", "profile", "notifications"].includes(n.id)) {
              setScreen("login");
            } else {
              setScreen(n.id);
            }
          }} style={{
            padding: "12px 16px", fontSize: 14, fontWeight: screen === n.id ? 600 : 400,
            color: screen === n.id ? "#6C63FF" : "#6b7280",
            background: "none", border: "none", cursor: "pointer",
            borderBottom: screen === n.id ? "2px solid #6C63FF" : "2px solid transparent",
            transition: "all 0.2s",
          }}>{n.label}</button>
        ))}
      </nav>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>

        {/* HOME */}
        {screen === "home" && (
          <div>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: -0.5 }}>
                Gemini Pro בחינם
              </h1>
              <p style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.7 }}>
                חלק קוד הצטרפות ל-Gemini Pro כולל 2TB אחסון — בתמורה, שתף את הקוד שלך עם הקהילה.
              </p>
            </div>

            {/* stats — real-time from Firestore */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
              {[
                { num: codes.filter(c => c.remainingSlots > 0).length, label: "קודים זמינים" },
                { num: codes.length, label: "קודים בבנק" },
                { num: totalShared, label: "קודים שחולקו" },
              ].map(s => (
                <div key={s.label} style={{
                  background: "#fff", border: "1px solid #ede9fe",
                  borderRadius: 14, padding: "14px 12px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#6C63FF" }}>{s.num}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* steps */}
            <div style={{
              background: "#fff", border: "1px solid #ede9fe",
              borderRadius: 16, padding: "20px 20px", marginBottom: 24,
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>איך זה עובד</h2>
              {[
                { n: 1, text: "הירשם עם אימייל — תקבל לינק לכניסה ישירה" },
                { n: 2, text: "חלק קוד Gemini Pro מהבנק — מיידי, ללא תנאים מוקדמים" },
                { n: 3, text: "לחץ \"לקחתי\" אחרי שהפעלת את הקוד" },
                { n: 4, text: "העלה קוד משלך כדי שתוכל לחלק שוב בעתיד" },
              ].map(s => (
                <div key={s.n} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: "rgba(108,99,255,0.12)", color: "#6C63FF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1,
                  }}>{s.n}</div>
                  <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, margin: 0 }}>{s.text}</p>
                </div>
              ))}
            </div>

            {isLocked ? (
              <div style={{
                background: "#fff8e1", border: "1px solid #fcd34d",
                borderRadius: 14, padding: "16px 20px", marginBottom: 16,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 14, color: "#92400e" }}>קוד חדש זמין בעוד:</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: "#b45309", fontVariantNumeric: "tabular-nums" }}>
                  <Timer seconds={lockSecsLeft} />
                </span>
              </div>
            ) : mustUpload ? (
              <div style={{
                background: "#fff7ed", border: "1px solid #fb923c",
                borderRadius: 14, padding: "16px 20px", marginBottom: 16,
              }}>
                <p style={{ fontSize: 14, color: "#c2410c", fontWeight: 600, marginBottom: 6 }}>
                  העלה קוד כדי לחלק שוב
                </p>
                <p style={{ fontSize: 13, color: "#9a3412", margin: 0 }}>
                  השתמשת בקוד שחלקת. עכשיו הגיע תורך לתרום — העלה קוד משלך כדי לפתוח את האפשרות לחלק קוד נוסף.
                </p>
                <button onClick={() => setScreen("get")} style={{
                  marginTop: 12, padding: "8px 20px", borderRadius: 20,
                  background: "#6C63FF", color: "#fff", border: "none",
                  cursor: "pointer", fontWeight: 600, fontSize: 14,
                }}>העלה קוד עכשיו →</button>
              </div>
            ) : (
              <button onClick={() => user ? getCode() : setScreen("login")} style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "linear-gradient(135deg, #6C63FF, #8b5cf6)",
                color: "#fff", border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: 16, letterSpacing: -0.2,
                boxShadow: "0 4px 20px rgba(108,99,255,0.3)",
              }}>
                {user ? "חלק קוד Gemini Pro חינם ←" : "הירשם וחלק קוד ←"}
              </button>
            )}
          </div>
        )}

        {/* LOGIN */}
        {screen === "login" && (
          <div style={{ maxWidth: 380, margin: "0 auto", textAlign: "center", paddingTop: 40 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #6C63FF, #a78bfa)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, color: "#fff", fontWeight: 700,
            }}>G</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>כניסה ל-GeminiShare</h2>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 32, lineHeight: 1.6 }}>
              התחבר עם חשבון Google שלך — מהיר, בטוח, ללא סיסמה
            </p>
            <button onClick={login} style={{
              width: "100%", padding: "13px 20px", borderRadius: 12,
              background: "#fff", border: "1.5px solid #e5e7eb",
              cursor: "pointer", fontSize: 15, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
              transition: "box-shadow 0.2s",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              המשך עם Google
            </button>
            {loginError && <p style={{ fontSize: 13, color: "#dc2626", marginTop: 14 }}>{loginError}</p>}
          </div>
        )}

        {/* SHARE / GET CODE */}
        {screen === "get" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>חלק קוד</h2>

            {/* received code display */}
            {profile?.hasReceivedCode && profile?.lastReceivedCode && (
              <div style={{
                background: "#fff", border: "1.5px solid #c4b5fd",
                borderRadius: 16, padding: 20, marginBottom: 20,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>הקוד שלך</h3>
                  <Badge color={profile.markedTaken ? "gray" : "purple"}>
                    {profile.markedTaken ? "נלקח ✓" : `${receivedCodeData?.remainingSlots ?? "?"} מקומות פנויים`}
                  </Badge>
                </div>
                <div style={{
                  background: "#f5f3ff", borderRadius: 10, padding: "12px 16px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: 12,
                }}>
                  <code style={{ fontSize: 14, fontFamily: "monospace", color: "#4c1d95", letterSpacing: 0.5 }}>
                    {profile.lastReceivedCode}
                  </code>
                  <button onClick={() => copyCode(profile.lastReceivedCode)} style={{
                    fontSize: 12, padding: "4px 12px", borderRadius: 20,
                    border: "1px solid #c4b5fd", background: copied ? "#e9d5ff" : "#fff",
                    cursor: "pointer", color: "#6C63FF", fontWeight: 600,
                    transition: "all 0.2s",
                  }}>{copied ? "הועתק!" : "העתק"}</button>
                </div>

                {!profile.markedTaken && !isLocked ? (
                  <>
                    <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>
                      לאחר שתפעיל את הקוד ב-Gemini, לחץ כדי לאשר. תוכל לחלק קוד נוסף רק אחרי 24 שעות ואחרי שתעלה קוד משלך.
                    </p>
                    <button onClick={markTaken} style={{
                      width: "100%", padding: "11px", borderRadius: 12,
                      background: "#ecfdf5", border: "1px solid #6ee7b7",
                      color: "#065f46", cursor: "pointer", fontWeight: 700, fontSize: 14,
                    }}>לקחתי ✓</button>
                  </>
                ) : isLocked ? (
                  <div style={{
                    background: "#fff8e1", borderRadius: 10, padding: "12px 16px",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ fontSize: 13, color: "#92400e" }}>קוד חדש זמין בעוד:</span>
                    <strong style={{ color: "#b45309", fontVariantNumeric: "tabular-nums" }}>
                      <Timer seconds={lockSecsLeft} />
                    </strong>
                  </div>
                ) : null}
              </div>
            )}

            {/* must upload */}
            {mustUpload && (
              <div style={{
                background: "#fff7ed", border: "1px solid #fdba74",
                borderRadius: 16, padding: 20, marginBottom: 20,
              }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#c2410c", marginBottom: 8 }}>
                  כעת תורך לתרום
                </h3>
                <p style={{ fontSize: 13, color: "#9a3412", marginBottom: 0 }}>
                  השתמשת בקוד שחלקת. העלה קוד Gemini שלך כדי להמשיך להשתמש בשירות.
                </p>
              </div>
            )}

            {/* upload form */}
            {!profile?.hasUploadedCode && (profile?.markedTaken || !profile?.hasReceivedCode) && user && (
              <div style={{
                background: "#fff", border: "1px solid #ede9fe",
                borderRadius: 16, padding: 20, marginBottom: 20,
              }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>העלה קוד שלך</h3>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 14 }}>
                  הקוד שלך יחולק עם עד 10 משתמשים אחרים.
                </p>
                <form onSubmit={submitUpload}>
                  <input
                    value={uploadCode} onChange={e => setUploadCode(e.target.value)}
                    placeholder="GEMINI-XXXX-XXXX-XXXX"
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      border: `1px solid ${uploadError ? "#f87171" : "#ede9fe"}`,
                      fontSize: 14, fontFamily: "monospace", marginBottom: 8,
                      background: "#fafafa", boxSizing: "border-box",
                    }}
                  />
                  {uploadError && <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 8 }}>{uploadError}</p>}
                  <button type="submit" style={{
                    width: "100%", padding: "11px", borderRadius: 12,
                    background: "linear-gradient(135deg, #6C63FF, #8b5cf6)",
                    color: "#fff", border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 14,
                  }}>העלה קוד ←</button>
                </form>
              </div>
            )}

            {/* initial get */}
            {!profile?.hasReceivedCode && user && (
              <div style={{
                background: "#fff", border: "1px solid #ede9fe",
                borderRadius: 16, padding: 20,
              }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>חלק קוד עכשיו</h3>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                  {codes.filter(c => c.remainingSlots > 0).length} קודים זמינים כרגע
                </p>
                <button onClick={getCode} style={{
                  width: "100%", padding: "12px", borderRadius: 12,
                  background: "linear-gradient(135deg, #6C63FF, #8b5cf6)",
                  color: "#fff", border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: 15,
                }}>חלק קוד ←</button>
              </div>
            )}

            {!user && (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>צריך להיות מחובר כדי לחלק קוד</p>
                <button onClick={() => setScreen("login")} style={{
                  padding: "10px 28px", borderRadius: 12,
                  background: "#6C63FF", color: "#fff", border: "none",
                  cursor: "pointer", fontWeight: 700, fontSize: 14,
                }}>כניסה / הרשמה</button>
              </div>
            )}
          </div>
        )}

        {/* BANK */}
        {screen === "bank" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>בנק קודים</h2>
            <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>
              {codes.filter(c => c.remainingSlots > 0).length} קודים פעילים כרגע
            </p>

            {codes.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <p style={{ fontSize: 14, color: "#9ca3af" }}>אין קודים בבנק כרגע. היה הראשון להעלות!</p>
              </div>
            )}

            {codes.map(c => (
              <div key={c.id} style={{
                background: "#fff", border: "1px solid #ede9fe",
                borderRadius: 14, padding: "16px 18px", marginBottom: 12,
                opacity: c.remainingSlots === 0 ? 0.5 : 1,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <code style={{ fontSize: 13, fontFamily: "monospace", color: "#4c1d95" }}>{c.code}</code>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>נוסף {timeAgo(c.createdAt)}</div>
                  </div>
                  <Badge color={c.remainingSlots === 0 ? "gray" : c.remainingSlots <= 2 ? "yellow" : "green"}>
                    {c.remainingSlots === 0 ? "מלא" : `${c.remainingSlots} מקומות פנויים`}
                  </Badge>
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <SlotsBar taken={c.takenSlots || 0} />
                  {reportedIds.has(c.id) ? (
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>דווח ✓</span>
                  ) : (
                    <button onClick={() => reportCode(c.id)} style={{
                      fontSize: 11, color: "#9ca3af", background: "none",
                      border: "none", cursor: "pointer", textDecoration: "underline",
                    }}>דווח על קוד שבור</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PROFILE */}
        {screen === "profile" && user && profile && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>האזור שלי</h2>

            {/* my code */}
            <div style={{
              background: "#fff", border: "1px solid #ede9fe",
              borderRadius: 14, padding: "18px 18px", marginBottom: 16,
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>הקוד שהעלתי</h3>
              {profile.uploadedCode ? (
                <>
                  <div style={{
                    background: "#f5f3ff", borderRadius: 10, padding: "10px 14px", marginBottom: 12,
                  }}>
                    <code style={{ fontSize: 13, fontFamily: "monospace", color: "#4c1d95" }}>{profile.uploadedCode}</code>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: "#6b7280" }}>נלקח על ידי</span>
                    <strong style={{ fontSize: 14 }}>{myCodeData?.takenSlots || 0} / 10 אנשים</strong>
                  </div>
                  <SlotsBar taken={myCodeData?.takenSlots || 0} size={14} />
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>עדיין לא העלית קוד</p>
                  <button onClick={() => setScreen("get")} style={{
                    padding: "8px 20px", borderRadius: 20,
                    background: "rgba(108,99,255,0.1)", border: "1px solid #c4b5fd",
                    color: "#6C63FF", cursor: "pointer", fontWeight: 600, fontSize: 13,
                  }}>העלה קוד →</button>
                </div>
              )}
            </div>

            {/* history */}
            <div style={{
              background: "#fff", border: "1px solid #ede9fe",
              borderRadius: 14, padding: "18px 18px", marginBottom: 16,
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>היסטוריית קודים שלקחתי</h3>
              {(!profile.history || profile.history.length === 0) ? (
                <p style={{ fontSize: 13, color: "#9ca3af" }}>עדיין לא לקחת קודים</p>
              ) : (
                profile.history.map((h, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < profile.history.length - 1 ? "1px solid #f3f4f6" : "none",
                  }}>
                    <div>
                      <code style={{ fontSize: 12, fontFamily: "monospace", color: "#374151" }}>{h.code}</code>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{h.date}</div>
                    </div>
                    <Badge color={h.status === "active" ? "green" : h.status === "expired" ? "yellow" : "gray"}>
                      {h.status === "active" ? "פעיל" : h.status === "expired" ? "פג — חדש!" : "בוטל"}
                    </Badge>
                  </div>
                ))
              )}
            </div>

            {/* notifications */}
            <div style={{
              background: "#fff", border: "1px solid #ede9fe",
              borderRadius: 14, padding: "18px 18px",
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>התראות אימייל</h3>
              {[
                { key: "newCodes", label: "כשנכנסים קודים חדשים לבנק" },
                { key: "renewal", label: "תזכורת חידוש מנוי (אחרי 4 חודשים)" },
              ].map(n => (
                <div key={n.key} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 0",
                  borderBottom: n.key === "newCodes" ? "1px solid #f3f4f6" : "none",
                }}>
                  <span style={{ fontSize: 14, color: "#374151" }}>{n.label}</span>
                  <div
                    onClick={() => toggleNotification(n.key)}
                    style={{
                      width: 40, height: 22, borderRadius: 11, cursor: "pointer",
                      background: profile.notifications?.[n.key] ? "#6C63FF" : "#e5e7eb",
                      position: "relative", transition: "background 0.2s",
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", background: "#fff",
                      position: "absolute", top: 2,
                      right: profile.notifications?.[n.key] ? 2 : 20,
                      transition: "right 0.2s",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      <footer style={{
        textAlign: "center", padding: "20px 16px",
        fontSize: 13, color: "#9ca3af",
        borderTop: "1px solid #f3f4f6", marginTop: 8,
      }}>
        נבנה ע"י{" "}
        <a
          href="https://mitmachim.top/user/%D7%9E%D7%93%D7%A8%D7%99%D7%9A-html"
          target="_blank" rel="noopener noreferrer"
          style={{ color: "#6C63FF", textDecoration: "none", fontWeight: 600 }}
        >@מדריך html</a>
      </footer>
      </main>
    </div>
  );
}
