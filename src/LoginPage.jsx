import React, { useState } from "react";
import { Mail, Lock, MapPin, Eye, EyeOff } from "lucide-react";
import { signUpWithEmail, signInWithEmail, signInWithGoogle } from "./supabase.js";

export default function LoginPage({ onAuthenticated }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isSignup = mode === "signup";
  const valid = email.trim().includes("@") && password.length >= 6;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(""); setMessage("");
    setLoading(true);
    try {
      if (isSignup) {
        await signUpWithEmail(email.trim(), password);
        setMessage("Controlla la tua email per confermare la registrazione.");
      } else {
        await signInWithEmail(email.trim(), password);
        // onAuthStateChange in main.jsx gestisce il redirect
      }
    } catch (err) {
      setError(err?.message || "Qualcosa è andato storto. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(""); setLoading(true);
    try {
      await signInWithGoogle();
      // redirect gestito da OAuth
    } catch (err) {
      setError(err?.message || "Accesso con Google non riuscito.");
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", minHeight: "100vh", background: "#FBFAF6", color: "#2C2C2A", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@500;700&family=Inter:wght@400;500;600&display=swap');
        .lp-display { font-family: 'Archivo Expanded', sans-serif; letter-spacing: -0.01em; }
        .lp-btn { cursor: pointer; border: none; font-family: inherit; }
        .lp-btn:active { transform: scale(0.98); }
        .lp-btn:disabled { cursor: not-allowed; }
        .lp-input { width: 100%; box-sizing: border-box; padding: 11px 12px 11px 38px; border: 1px solid #D3D1C7; border-radius: 8px; font-size: 14px; font-family: inherit; background: #fff; color: #2C2C2A; }
        .lp-input:focus { outline: none; border-color: #D85A30; }
        .lp-field-wrap { position: relative; }
        .lp-field-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #888780; pointer-events: none; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "linear-gradient(135deg,#F0997B,#D85A30)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <MapPin size={26} color="#fff" />
          </div>
          <p className="lp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>
            {isSignup ? "Crea il tuo account" : "Bentornato"}
          </p>
          <p style={{ fontSize: 13, color: "#5F5E5A", margin: "6px 0 0" }}>
            {isSignup ? "Inizia a pianificare il tuo prossimo viaggio" : "Accedi per ritrovare i tuoi viaggi e ricordi"}
          </p>
        </div>

        <button type="button" className="lp-btn" onClick={handleGoogle} disabled={loading}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px", borderRadius: 8, border: "1px solid #D3D1C7", background: "#fff", fontSize: 14, fontWeight: 500, color: "#2C2C2A", marginBottom: 16, opacity: loading ? 0.6 : 1 }}>
          <GoogleIcon /> Continua con Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 18px" }}>
          <div style={{ flex: 1, height: 1, background: "#E3E1D8" }} />
          <span style={{ fontSize: 12, color: "#888780" }}>oppure</span>
          <div style={{ flex: 1, height: 1, background: "#E3E1D8" }} />
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "#5F5E5A", marginBottom: 5, display: "block" }}>Email</label>
          <div className="lp-field-wrap" style={{ marginBottom: 14 }}>
            <Mail size={16} className="lp-field-icon" />
            <input className="lp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@esempio.com" autoComplete="email" />
          </div>

          <label style={{ fontSize: 12, fontWeight: 500, color: "#5F5E5A", marginBottom: 5, display: "block" }}>Password</label>
          <div className="lp-field-wrap" style={{ marginBottom: 18 }}>
            <Lock size={16} className="lp-field-icon" />
            <input className="lp-input" style={{ paddingRight: 38 }} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="almeno 6 caratteri" autoComplete={isSignup ? "new-password" : "current-password"} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "#888780", cursor: "pointer", padding: 4 }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 13, padding: "10px 12px", borderRadius: 8, marginBottom: 14 }}>{error}</div>}
          {message && <div style={{ background: "#EAF3DE", color: "#27500A", fontSize: 13, padding: "10px 12px", borderRadius: 8, marginBottom: 14 }}>{message}</div>}

          <button type="submit" className="lp-btn" disabled={!valid || loading}
            style={{ width: "100%", background: valid && !loading ? "#D85A30" : "#E3E1D8", color: valid && !loading ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 500 }}>
            {loading ? "Attendere…" : isSignup ? "Crea account" : "Accedi"}
          </button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: "#5F5E5A", marginTop: 22 }}>
          {isSignup ? "Hai già un account?" : "Non hai un account?"}{" "}
          <button type="button" className="lp-btn" onClick={() => { setMode(isSignup ? "signin" : "signup"); setError(""); setMessage(""); }}
            style={{ background: "transparent", color: "#D85A30", fontWeight: 500, padding: 0, fontSize: 13 }}>
            {isSignup ? "Accedi" : "Registrati"}
          </button>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20.5H24v7h11.3C33.7 31.5 29.3 34.5 24 34.5c-6.9 0-12.5-5.6-12.5-12.5S17.1 9.5 24 9.5c3.2 0 6.1 1.2 8.3 3.2l5-5C33.9 4.7 29.2 2.5 24 2.5 12.4 2.5 3 11.9 3 23.5S12.4 44.5 24 44.5 45 35.1 45 23.5c0-1-.1-1.9-.4-3z"/>
      <path fill="#FF3D00" d="M6.3 14.7l5.8 4.2C13.7 15.3 18.5 12.5 24 12.5c3.2 0 6.1 1.2 8.3 3.2l5-5C33.9 7.7 29.2 5.5 24 5.5c-7.7 0-14.3 4.4-17.7 9.2z"/>
      <path fill="#4CAF50" d="M24 44.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.1c-2 1.4-4.5 2.3-7.2 2.3-5.3 0-9.7-3-11.3-7.5l-6.4 4.9C9.5 39.9 16.2 44.5 24 44.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20.5H24v7h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.1C40.9 35.5 45 30 45 23.5c0-1-.1-1.9-.4-3z"/>
    </svg>
  );
}
