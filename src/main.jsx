import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "./LoginPage.jsx";
import TripPlanner from "./TripPlanner.jsx";

const SESSION_KEY = "trip_planner_session";

function App() {
  const [user, setUser] = useState(undefined); // undefined = caricamento, null = non loggato

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    setUser(saved ? JSON.parse(saved) : null);
  }, []);

  function handleAuthenticated(userInfo) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(userInfo));
    setUser(userInfo);
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }

  if (user === undefined) return null;

  if (!user) {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  return <TripPlanner currentUser={user} onLogout={handleLogout} />;
}

createRoot(document.getElementById("root")).render(<App />);
