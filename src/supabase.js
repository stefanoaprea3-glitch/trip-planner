import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zuaargcxbehiuqpeiknl.supabase.co";
const SUPABASE_KEY = "sb_publishable_7wZuYhTxXZAQ6vaCGxmVFQ_2mq1dWaG";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- Auth helpers ----

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ---- Trips helpers ----

// Carica tutti i viaggi dell'utente loggato
export async function loadTripsFromDB() {
  const { data, error } = await supabase
    .from("trips")
    .select("id, data, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // I viaggi sono salvati come JSONB nel campo "data"
  return data.map((row) => ({ ...row.data, _dbId: row.id }));
}

// Salva/aggiorna un singolo viaggio
export async function saveTripToDB(trip) {
  const session = await getSession();
  if (!session) return null;

  const { _dbId, ...tripData } = trip;

  if (_dbId) {
    // Aggiorna esistente
    const { error } = await supabase
      .from("trips")
      .update({ data: tripData })
      .eq("id", _dbId);
    if (error) throw error;
    return _dbId;
  } else {
    // Inserisce nuovo
    const { data, error } = await supabase
      .from("trips")
      .insert({ user_id: session.user.id, data: tripData })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
}

// Elimina un viaggio
export async function deleteTripFromDB(dbId) {
  if (!dbId) return;
  const { error } = await supabase.from("trips").delete().eq("id", dbId);
  if (error) throw error;
}
