import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "./LoginPage.jsx";
import TripPlanner from "./TripPlanner.jsx";
import { supabase, signOut } from "./supabase.js";

function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    // Controlla sessione esistente
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    // Ascolta cambiamenti auth (login/logout/callback OAuth)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await signOut();
    setUser(null);
  }

  if (user === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", color: "#888" }}>
      Caricamento…
    </div>
  );

  if (!user) return <LoginPage onAuthenticated={() => {}} />;

  return <TripPlanner currentUser={user} onLogout={handleLogout} />;
}

createRoot(document.getElementById("root")).render(<App />);
