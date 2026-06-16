import React, { useState, useEffect, useRef, useCallback } from "react";
import { Plus, MapPin, Plane, Bed, UtensilsCrossed, Compass, ArrowLeft, X, Camera, ChevronRight, Trash2, Pencil, LogOut } from "lucide-react";

// ---------- storage helpers ----------
// Versione web standalone: usa localStorage del browser.
// Per il salvataggio lato server condiviso tra dispositivi, sostituire
// queste due funzioni con chiamate al database Supabase.
const STORAGE_KEY = "trips:data";

async function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function saveTrips(trips) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch (e) {
    console.error("Errore salvataggio", e);
  }
}

// ---------- sample seed data (only used first run) ----------
const seedTrips = () => ([
  {
    id: "trip_" + Date.now(),
    name: "Lisbona",
    startDate: "2026-09-12",
    endDate: "2026-09-16",
    days: [
      {
        date: "2026-09-12",
        items: [
          { id: "i1", type: "flight", title: "Volo Zurigo → Lisbona", time: "09:40", note: "TAP1234 · Terminal 2" },
          { id: "i2", type: "hotel", title: "Check-in · Hotel Borges", time: "15:00", note: "Rua Garrett 108" }
        ],
        photos: []
      },
      {
        date: "2026-09-13",
        items: [
          { id: "i3", type: "tour", title: "Tour a piedi · Alfama", time: "10:00", note: "2 ore · con guida" },
          { id: "i4", type: "restaurant", title: "Cena · Taberna da Rua das Flores", time: "20:00", note: "prenotazione per 2" }
        ],
        photos: []
      },
      { date: "2026-09-14", items: [], photos: [] },
      { date: "2026-09-15", items: [], photos: [] },
      { date: "2026-09-16", items: [], photos: [] }
    ]
  }
]);

// ---------- category config ----------
const CATEGORY = {
  flight: { label: "Volo", icon: Plane, bg: "#FAECE7", fg: "#712B13" },
  hotel: { label: "Alloggio", icon: Bed, bg: "#E6F1FB", fg: "#0C447C" },
  restaurant: { label: "Ristorante", icon: UtensilsCrossed, bg: "#FBEAF0", fg: "#72243E" },
  tour: { label: "Tour / attività", icon: Compass, bg: "#EAF3DE", fg: "#27500A" }
};

function uid(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function dateRangeDays(startDate, endDate) {
  const days = [];
  let d = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function formatDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

function formatDateRange(startDate, endDate) {
  const s = new Date(startDate + "T00:00:00");
  const e = new Date(endDate + "T00:00:00");
  const sStr = s.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  const eStr = e.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return `${sStr} – ${eStr}`;
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.round((target - today) / 86400000);
  return diff;
}

// ---------- file -> base64 ----------
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const rotations = [-3, 2, -2, 3, -1, 1.5];

// ============================================================
export default function TripPlanner({ currentUser, onLogout }) {
  const [trips, setTrips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ screen: "list" }); // list | itinerary | memories
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [showAddItem, setShowAddItem] = useState(null); // { tripId, date }
  const [editingTrip, setEditingTrip] = useState(null);

  useEffect(() => {
    (async () => {
      const stored = await loadTrips();
      if (stored && Array.isArray(stored) && stored.length > 0) {
        setTrips(stored);
      } else {
        const seed = seedTrips();
        setTrips(seed);
        saveTrips(seed);
      }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback((next) => {
    setTrips(next);
    saveTrips(next);
  }, []);

  function addTrip(name, startDate, endDate) {
    const days = dateRangeDays(startDate, endDate).map((date) => ({ date, items: [], photos: [] }));
    const newTrip = { id: uid("trip"), name, startDate, endDate, days };
    const next = [...trips, newTrip];
    persist(next);
    setShowNewTrip(false);
    setView({ screen: "itinerary", tripId: newTrip.id });
  }

  function deleteTrip(tripId) {
    persist(trips.filter((t) => t.id !== tripId));
    setView({ screen: "list" });
  }

  function addItem(tripId, date, item) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) => (d.date === date ? { ...d, items: [...d.items, { ...item, id: uid("item") }] } : d))
      };
    });
    persist(next);
    setShowAddItem(null);
  }

  function deleteItem(tripId, date, itemId) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) => (d.date === date ? { ...d, items: d.items.filter((i) => i.id !== itemId) } : d))
      };
    });
    persist(next);
  }

  async function addPhotos(tripId, date, files) {
    const dataUrls = await Promise.all(Array.from(files).map(fileToDataUrl));
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date
            ? { ...d, photos: [...d.photos, ...dataUrls.map((src) => ({ id: uid("photo"), src, caption: "" }))] }
            : d
        )
      };
    });
    persist(next);
  }

  function updatePhotoCaption(tripId, date, photoId, caption) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date ? { ...d, photos: d.photos.map((p) => (p.id === photoId ? { ...p, caption } : p)) } : d
        )
      };
    });
    persist(next);
  }

  function deletePhoto(tripId, date, photoId) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) => (d.date === date ? { ...d, photos: d.photos.filter((p) => p.id !== photoId) } : d))
      };
    });
    persist(next);
  }

  if (loading) {
    return (
      <div style={{ minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "#888780", fontFamily: "Inter, sans-serif", fontSize: 14 }}>
        Caricamento dei tuoi viaggi…
      </div>
    );
  }

  const activeTrip = view.tripId ? trips.find((t) => t.id === view.tripId) : null;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", maxWidth: 720, margin: "0 auto", color: "#2C2C2A", background: "#FBFAF6", minHeight: 500 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@500;700&family=Inter:wght@400;500;600&display=swap');
        .tp-display { font-family: 'Archivo Expanded', sans-serif; letter-spacing: -0.01em; }
        .tp-btn { cursor: pointer; border: none; font-family: inherit; }
        .tp-btn:active { transform: scale(0.98); }
        .tp-card-hover { transition: border-color 0.15s ease; }
        .tp-input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid #D3D1C7; border-radius: 8px; font-size: 14px; font-family: inherit; background: #fff; color: #2C2C2A; }
        .tp-input:focus { outline: none; border-color: #D85A30; }
        .tp-label { font-size: 12px; font-weight: 500; color: #5F5E5A; margin-bottom: 5px; display: block; }
      `}</style>

      {view.screen === "list" && (
        <TripList
          trips={trips}
          onOpenTrip={(id) => setView({ screen: "itinerary", tripId: id })}
          onNewTrip={() => setShowNewTrip(true)}
          onLogout={onLogout}
        />
      )}

      {view.screen === "itinerary" && activeTrip && (
        <ItineraryView
          trip={activeTrip}
          onBack={() => setView({ screen: "list" })}
          onViewMemories={() => setView({ screen: "memories", tripId: activeTrip.id })}
          onAddItem={(date) => setShowAddItem({ tripId: activeTrip.id, date })}
          onDeleteItem={(date, itemId) => deleteItem(activeTrip.id, date, itemId)}
          onDeleteTrip={() => deleteTrip(activeTrip.id)}
          onAddPhotos={(date, files) => addPhotos(activeTrip.id, date, files)}
        />
      )}

      {view.screen === "memories" && activeTrip && (
        <MemoriesView
          trip={activeTrip}
          onBack={() => setView({ screen: "itinerary", tripId: activeTrip.id })}
          onAddPhotos={(date, files) => addPhotos(activeTrip.id, date, files)}
          onCaption={(date, photoId, caption) => updatePhotoCaption(activeTrip.id, date, photoId, caption)}
          onDeletePhoto={(date, photoId) => deletePhoto(activeTrip.id, date, photoId)}
        />
      )}

      {showNewTrip && (
        <NewTripModal onClose={() => setShowNewTrip(false)} onCreate={addTrip} />
      )}

      {showAddItem && (
        <AddItemModal
          onClose={() => setShowAddItem(null)}
          onAdd={(item) => addItem(showAddItem.tripId, showAddItem.date, item)}
        />
      )}
    </div>
  );
}

// ============================================================
function TripList({ trips, onOpenTrip, onNewTrip, onLogout }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = trips.filter((t) => new Date(t.endDate + "T00:00:00") >= today)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const past = trips.filter((t) => new Date(t.endDate + "T00:00:00") < today)
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  const gradients = ["linear-gradient(135deg,#F0997B,#D85A30)", "linear-gradient(135deg,#85B7EB,#378ADD)", "linear-gradient(135deg,#F4C0D1,#993556)", "linear-gradient(135deg,#FAC775,#854F0B)", "linear-gradient(135deg,#9FE1CB,#085041)"];

  return (
    <div style={{ padding: "28px 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 26 }}>
        <p className="tp-display" style={{ fontWeight: 700, fontSize: 24, margin: 0 }}>I tuoi viaggi</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="tp-btn" onClick={onNewTrip} style={{ background: "#D85A30", color: "#fff", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Nuovo viaggio
          </button>
          {onLogout && (
            <button className="tp-btn" onClick={onLogout} title="Esci" style={{ background: "transparent", color: "#888780", padding: 8, border: "1px solid #E3E1D8", borderRadius: 8 }}>
              <LogOut size={15} />
            </button>
          )}
        </div>
      </div>

      {upcoming.length === 0 && (
        <div style={{ border: "1px dashed #D3D1C7", borderRadius: 12, padding: 28, textAlign: "center", color: "#888780", fontSize: 13, marginBottom: 24 }}>
          Nessun viaggio in programma. Creane uno per iniziare a pianificare.
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px" }}>In programma</p>
          {upcoming.map((trip, idx) => {
            const totalDays = trip.days.length;
            const plannedDays = trip.days.filter((d) => d.items.length > 0).length;
            const diff = daysUntil(trip.startDate);
            const subtitle = diff > 0 ? `tra ${diff} giorni` : diff === 0 ? "oggi" : "in corso";
            return (
              <div key={trip.id} className="tp-card-hover" onClick={() => onOpenTrip(trip.id)} style={{ cursor: "pointer", border: "1px solid #E3E1D8", borderRadius: 12, padding: 16, marginBottom: 12, display: "flex", gap: 14, alignItems: "center", background: "#fff" }}>
                <div style={{ width: 52, height: 52, borderRadius: 8, background: gradients[idx % gradients.length], flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MapPin size={22} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{trip.name}</p>
                  <p style={{ fontSize: 12, color: "#5F5E5A", margin: "3px 0 0" }}>{formatDateRange(trip.startDate, trip.endDate)} · {subtitle}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ fontSize: 11, color: "#888780", margin: 0 }}>{totalDays} giorni</p>
                  <div style={{ display: "flex", gap: 3, marginTop: 6, justifyContent: "flex-end" }}>
                    {trip.days.slice(0, 5).map((d, i) => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: d.items.length > 0 ? "#D85A30" : "#E3E1D8" }} />
                    ))}
                  </div>
                </div>
                <ChevronRight size={18} color="#B4B2A9" />
              </div>
            );
          })}
        </>
      )}

      {past.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "24px 0 10px" }}>Ricordi passati</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {past.map((trip, idx) => {
              const firstPhoto = trip.days.flatMap((d) => d.photos)[0];
              return (
                <div key={trip.id} onClick={() => onOpenTrip(trip.id)} style={{ borderRadius: 10, overflow: "hidden", cursor: "pointer" }}>
                  <div style={{ height: 80, background: firstPhoto ? `url(${firstPhoto.src}) center/cover` : gradients[(idx + 2) % gradients.length] }} />
                  <div style={{ padding: "8px 2px" }}>
                    <p style={{ fontSize: 12, fontWeight: 500, margin: 0 }}>{trip.name}</p>
                    <p style={{ fontSize: 10, color: "#888780", margin: "2px 0 0" }}>{formatDateShort(trip.startDate)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
function ItineraryView({ trip, onBack, onViewMemories, onAddItem, onDeleteItem, onDeleteTrip, onAddPhotos }) {
  const fileInputs = useRef({});
  const totalPhotos = trip.days.reduce((sum, d) => sum + d.photos.length, 0);
  const totalItems = trip.days.reduce((sum, d) => sum + d.items.length, 0);

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <button className="tp-btn" onClick={onBack} style={{ background: "transparent", color: "#5F5E5A", fontSize: 13, display: "flex", alignItems: "center", gap: 5, padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={15} /> Tutti i viaggi
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p className="tp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>{trip.name}</p>
          <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0 0" }}>{formatDateRange(trip.startDate, trip.endDate)} · {trip.days.length} giorni</p>
        </div>
        <button className="tp-btn" onClick={onDeleteTrip} title="Elimina viaggio" style={{ background: "transparent", color: "#B4B2A9", padding: 6 }}>
          <Trash2 size={16} />
        </button>
      </div>

      <div style={{ position: "relative", paddingLeft: 28, marginBottom: 28 }}>
        <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 1.5, background: "#E3E1D8" }} />

        {trip.days.map((day, dIdx) => (
          <div key={day.date} style={{ position: "relative", marginBottom: 22 }}>
            <div style={{ position: "absolute", left: -28, top: 2, width: 13, height: 13, borderRadius: "50%", background: day.items.length > 0 ? "#993C1D" : "#D3D1C7", border: "2px solid #FBFAF6" }} />
            <p style={{ fontSize: 12, fontWeight: 500, color: "#5F5E5A", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Giorno {dIdx + 1} · {formatDateShort(day.date)}
            </p>

            {day.items.map((item) => {
              const cat = CATEGORY[item.type] || CATEGORY.tour;
              const Icon = cat.icon;
              return (
                <div key={item.id} style={{ border: "1px solid #E3E1D8", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, marginBottom: 8, background: "#fff" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={16} color={cat.fg} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{item.title}</p>
                    <p style={{ fontSize: 12, color: "#5F5E5A", margin: "2px 0 0" }}>{item.time}{item.note ? ` · ${item.note}` : ""}</p>
                  </div>
                  <button className="tp-btn" onClick={() => onDeleteItem(day.date, item.id)} style={{ background: "transparent", color: "#B4B2A9", padding: 4, flexShrink: 0 }}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}

            {day.photos.length > 0 && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14, paddingLeft: 4 }}>
                {day.photos.map((photo, pIdx) => (
                  <div key={photo.id} style={{ background: "#fff", padding: "6px 6px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transform: `rotate(${rotations[pIdx % rotations.length]}deg)`, width: 84 }}>
                    <div style={{ width: "100%", height: 64, borderRadius: 2, background: `url(${photo.src}) center/cover`, overflow: "hidden" }} />
                    <p className="tp-display" style={{ fontSize: 9, textAlign: "center", margin: "6px 0 0", color: "#444" }}>{photo.caption || formatDateShort(day.date)}</p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tp-btn" onClick={() => onAddItem(day.date)} style={{ flex: 1, border: "1px dashed #D3D1C7", borderRadius: 10, padding: "10px", background: "transparent", color: "#888780", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Plus size={13} /> Attività
              </button>
              <button className="tp-btn" onClick={() => fileInputs.current[day.date]?.click()} style={{ flex: 1, border: "1px dashed #D3D1C7", borderRadius: 10, padding: "10px", background: "transparent", color: "#888780", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Camera size={13} /> Foto
              </button>
              <input
                ref={(el) => (fileInputs.current[day.date] = el)}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files.length) onAddPhotos(day.date, e.target.files); e.target.value = ""; }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid #E3E1D8", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ fontSize: 12, color: "#888780", margin: 0 }}>{totalItems} elementi · {totalPhotos} ricordi salvati</p>
        <button className="tp-btn" onClick={onViewMemories} style={{ background: "#D85A30", color: "#fff", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
          Vedi ricordi <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
function MemoriesView({ trip, onBack, onAddPhotos, onCaption, onDeletePhoto }) {
  const fileInputRef = useRef(null);
  const [addingTo, setAddingTo] = useState(null);
  const totalPhotos = trip.days.reduce((sum, d) => sum + d.photos.length, 0);
  const daysWithPhotos = trip.days.filter((d) => d.photos.length > 0);

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <button className="tp-btn" onClick={onBack} style={{ background: "transparent", color: "#5F5E5A", fontSize: 13, display: "flex", alignItems: "center", gap: 5, padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={15} /> Itinerario
      </button>

      <div style={{ marginBottom: 22 }}>
        <p className="tp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>Ricordi · {trip.name}</p>
        <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0 0" }}>{totalPhotos} foto · {formatDateRange(trip.startDate, trip.endDate)}</p>
      </div>

      {daysWithPhotos.length === 0 && (
        <div style={{ border: "1px dashed #D3D1C7", borderRadius: 12, padding: 28, textAlign: "center", color: "#888780", fontSize: 13, marginBottom: 20 }}>
          Nessuna foto ancora. Aggiungi i tuoi primi ricordi da un giorno qui sotto.
        </div>
      )}

      {trip.days.map((day, dIdx) => (
        day.photos.length > 0 && (
          <div key={day.date} style={{ marginBottom: 26 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 12px" }}>
              Giorno {dIdx + 1} · {formatDateShort(day.date)}
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {day.photos.map((photo, pIdx) => (
                <div key={photo.id} style={{ background: "#fff", padding: "8px 8px 10px", boxShadow: "0 1px 4px rgba(0,0,0,0.18)", transform: `rotate(${rotations[pIdx % rotations.length]}deg)`, width: 130, position: "relative" }}>
                  <button className="tp-btn" onClick={() => onDeletePhoto(day.date, photo.id)} style={{ position: "absolute", top: 4, right: 4, background: "rgba(255,255,255,0.85)", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "#712B13" }}>
                    <X size={11} />
                  </button>
                  <div style={{ width: "100%", height: 104, borderRadius: 2, background: `url(${photo.src}) center/cover` }} />
                  <input
                    className="tp-display"
                    defaultValue={photo.caption}
                    placeholder="aggiungi didascalia"
                    onBlur={(e) => onCaption(day.date, photo.id, e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 10, textAlign: "center", margin: "8px 0 0", color: "#444", border: "none", background: "transparent", outline: "none" }}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      <div style={{ marginTop: 8 }}>
        <label className="tp-label">Aggiungi foto a un giorno specifico</label>
        <select
          className="tp-input"
          style={{ marginBottom: 10 }}
          value={addingTo || ""}
          onChange={(e) => setAddingTo(e.target.value)}
        >
          <option value="">Scegli un giorno…</option>
          {trip.days.map((d, i) => (
            <option key={d.date} value={d.date}>Giorno {i + 1} · {formatDateShort(d.date)}</option>
          ))}
        </select>
        <button
          className="tp-btn"
          disabled={!addingTo}
          onClick={() => fileInputRef.current?.click()}
          style={{ width: "100%", border: "1px dashed #D3D1C7", borderRadius: 10, padding: 14, background: "transparent", color: addingTo ? "#5F5E5A" : "#B4B2A9", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: addingTo ? "pointer" : "not-allowed" }}
        >
          <Camera size={15} /> Carica foto
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files.length && addingTo) onAddPhotos(addingTo, e.target.files); e.target.value = ""; }}
        />
      </div>
    </div>
  );
}

// ============================================================
function NewTripModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const valid = name.trim() && startDate && endDate && endDate >= startDate;

  return (
    <ModalShell onClose={onClose} title="Nuovo viaggio">
      <label className="tp-label">Destinazione</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Lisbona" autoFocus />

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data inizio</label>
          <input className="tp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data fine</label>
          <input className="tp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={() => valid && onCreate(name.trim(), startDate, endDate)}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        Crea viaggio
      </button>
    </ModalShell>
  );
}

function AddItemModal({ onClose, onAdd }) {
  const [type, setType] = useState("flight");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const valid = title.trim();

  return (
    <ModalShell onClose={onClose} title="Aggiungi attività">
      <label className="tp-label">Tipo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {Object.entries(CATEGORY).map(([key, cat]) => {
          const Icon = cat.icon;
          const active = type === key;
          return (
            <button
              key={key}
              className="tp-btn"
              onClick={() => setType(key)}
              style={{ flex: 1, padding: "10px 4px", borderRadius: 8, border: active ? `1.5px solid ${cat.fg}` : "1px solid #E3E1D8", background: active ? cat.bg : "#fff", color: cat.fg, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
            >
              <Icon size={16} />
              <span style={{ fontSize: 10 }}>{cat.label}</span>
            </button>
          );
        })}
      </div>

      <label className="tp-label">Titolo</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="es. Cena al ristorante X" />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Orario</label>
          <input className="tp-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div style={{ flex: 2 }}>
          <label className="tp-label">Nota (indirizzo, codice prenotazione…)</label>
          <input className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opzionale" />
        </div>
      </div>

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={() => valid && onAdd({ type, title: title.trim(), time: time || "--:--", note: note.trim() })}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        Aggiungi
      </button>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{ position: "static", minHeight: 300, background: "rgba(44,44,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, borderRadius: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBFAF6", borderRadius: 14, padding: 22, width: "100%", maxWidth: 380, boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <p className="tp-display" style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>{title}</p>
          <button className="tp-btn" onClick={onClose} style={{ background: "transparent", color: "#888780", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
