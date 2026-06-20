import React, { useState, useEffect, useRef, useCallback } from "react";
import { Plus, MapPin, Plane, Bed, UtensilsCrossed, Compass, ArrowLeft, X, Camera, ChevronRight, Trash2, Pencil, LogOut, Paperclip, Wallet, Map as MapIcon, BookOpen, Download, FileText, Cloud, CloudRain, CloudSnow, Sun, CloudLightning, Wind, ExternalLink, Car } from "lucide-react";
import { jsPDF } from "jspdf";

// ---------- meteo (Open-Meteo, gratuito, senza API key) ----------
const geocodeCache = new Map();
const weatherCache = new Map();

async function geocodeLocation(query) {
  if (!query || !query.trim()) return null;
  const key = query.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=it`);
    const data = await res.json();
    const result = data.results && data.results[0] ? { lat: data.results[0].latitude, lon: data.results[0].longitude, name: data.results[0].name } : null;
    geocodeCache.set(key, result);
    return result;
  } catch (e) {
    return null;
  }
}

// Mappa codici meteo WMO -> icona + etichetta in italiano
function weatherCodeInfo(code) {
  if (code === 0) return { label: "Sereno", Icon: Sun };
  if (code <= 2) return { label: "Poco nuvoloso", Icon: Sun };
  if (code === 3) return { label: "Nuvoloso", Icon: Cloud };
  if (code >= 45 && code <= 48) return { label: "Nebbia", Icon: Cloud };
  if (code >= 51 && code <= 67) return { label: "Pioggia", Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: "Neve", Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: "Rovesci", Icon: CloudRain };
  if (code >= 95) return { label: "Temporale", Icon: CloudLightning };
  return { label: "Variabile", Icon: Cloud };
}

// Ritorna { label, tempMax, tempMin, windMax, Icon, isForecast } per una data e luogo, o null
async function fetchDayWeather(location, dateStr) {
  if (!location || !location.trim()) return null;
  const geo = await geocodeLocation(location);
  if (!geo) return null;

  const cacheKey = `${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}_${dateStr}`;
  if (weatherCache.has(cacheKey)) return weatherCache.get(cacheKey);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((target - today) / 86400000);

  // Previsione fino a 16 giorni nel futuro; oltre, usiamo medie storiche (anno scorso) come stima climatica
  const isForecast = diffDays >= -2 && diffDays <= 16;
  let url;
  if (isForecast) {
    url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
  } else {
    // stima climatica: stessa data dell'anno scorso, dati storici
    const lastYear = dateStr.replace(/^\d{4}/, String(target.getFullYear() - 1));
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max&timezone=auto&start_date=${lastYear}&end_date=${lastYear}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.daily || !data.daily.time || data.daily.time.length === 0) {
      weatherCache.set(cacheKey, null);
      return null;
    }
    const code = data.daily.weathercode[0];
    const result = {
      ...weatherCodeInfo(code),
      tempMax: Math.round(data.daily.temperature_2m_max[0]),
      tempMin: Math.round(data.daily.temperature_2m_min[0]),
      windMax: Math.round(data.daily.windspeed_10m_max[0]),
      isForecast
    };
    weatherCache.set(cacheKey, result);
    return result;
  } catch (e) {
    weatherCache.set(cacheKey, null);
    return null;
  }
}

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
    currency: "CHF",
    participants: ["Tu"],
    days: [
      {
        date: "2026-09-12",
        items: [
          { id: "i1", type: "flight", title: "Volo Zurigo → Lisbona", time: "09:40", note: "TAP1234 · Terminal 2", location: "Aeroporto di Lisbona", cost: 180, attachment: null },
          { id: "i2", type: "hotel", title: "Check-in · Hotel Borges", time: "15:00", note: "Rua Garrett 108", location: "Rua Garrett 108, Lisbona", cost: 420, attachment: null }
        ],
        photos: [],
        journal: ""
      },
      {
        date: "2026-09-13",
        items: [
          { id: "i3", type: "tour", title: "Tour a piedi · Alfama", time: "10:00", note: "2 ore · con guida", location: "Alfama, Lisbona", cost: 25, attachment: null },
          { id: "i4", type: "restaurant", title: "Cena · Taberna da Rua das Flores", time: "20:00", note: "prenotazione per 2", location: "Rua das Flores, Lisbona", cost: 60, attachment: null }
        ],
        photos: [],
        journal: ""
      },
      { date: "2026-09-14", items: [], photos: [], journal: "" },
      { date: "2026-09-15", items: [], photos: [], journal: "" },
      { date: "2026-09-16", items: [], photos: [], journal: "" }
    ]
  }
]);

// ---------- category config ----------
const TRANSPORT_MODES = { taxi: "Taxi", treno: "Treno", bus: "Bus", auto: "Auto a noleggio", traghetto: "Traghetto", altro: "Altro" };

const CATEGORY = {
  flight: { label: "Volo", icon: Plane, bg: "#FAECE7", fg: "#712B13" },
  hotel: { label: "Alloggio", icon: Bed, bg: "#E6F1FB", fg: "#0C447C" },
  restaurant: { label: "Ristorante", icon: UtensilsCrossed, bg: "#FBEAF0", fg: "#72243E" },
  tour: { label: "Tour / attività", icon: Compass, bg: "#EAF3DE", fg: "#27500A" },
  transport: { label: "Trasporto", icon: Car, bg: "#EFEAF7", fg: "#4A2E8C" }
};

function uid(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateRangeDays(startDate, endDate) {
  const days = [];
  let d = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (d <= end) {
    days.push(toLocalISODate(d));
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

// Costruisce la riga di dettagli leggibile in base al tipo di attività e ai suoi campi specifici
function buildItemSummary(item) {
  const parts = [];
  if (item.type === "flight") {
    if (item.flightNumber) parts.push(item.flightNumber);
    if (item.departureAirport || item.arrivalAirport) {
      parts.push(`${item.departureAirport || "?"} → ${item.arrivalAirport || "?"}`);
    }
    if (item.arrivalTime) parts.push(`arrivo ${item.arrivalTime}`);
    if (item.terminal) parts.push(`Terminal ${item.terminal}`);
    if (item.passengers && item.passengers.length) {
      parts.push(item.passengers.map((p) => p.seat ? `${p.name} (${p.seat})` : p.name).join(", "));
    }
    if (item.baggage && item.baggage.length) {
      const baggageArr = Array.isArray(item.baggage) ? item.baggage : [item.baggage];
      const labels = baggageArr.map((b) => (b === "stiva" ? "stiva" : "mano"));
      parts.push(`bagaglio: ${labels.join(" + ")}`);
    }
  } else if (item.type === "hotel") {
    if (item.checkOut) parts.push(`check-out ${item.checkOut}`);
    if (item.nights) parts.push(`${item.nights} ${item.nights === 1 ? "notte" : "notti"}`);
    if (item.confirmationCode) parts.push(`cod. ${item.confirmationCode}`);
    if (item.hotelGuests && item.hotelGuests.length) parts.push(item.hotelGuests.map((g) => g.name).join(", "));
  } else if (item.type === "restaurant") {
    if (item.guests) parts.push(`${item.guests} persone`);
    if (item.cuisine) parts.push(item.cuisine);
  } else if (item.type === "tour") {
    if (item.duration) parts.push(item.duration);
    if (item.meetingPoint) parts.push(`ritrovo: ${item.meetingPoint}`);
    if (item.guided) parts.push(item.guided === "si" ? "con guida" : "senza guida");
  } else if (item.type === "transport") {
    if (item.transportMode) parts.push(TRANSPORT_MODES[item.transportMode] || item.transportMode);
    if (item.fromPlace || item.toPlace) parts.push(`${item.fromPlace || "?"} → ${item.toPlace || "?"}`);
  }
  if (item.note) parts.push(item.note);
  return parts.join(" · ");
}

const rotations = [-3, 2, -2, 3, -1, 1.5];

// Costruisce un URL Google Maps con percorso multi-tappa (origine, tappe intermedie, destinazione)
function buildMapsUrl(stops) {
  if (stops.length === 0) return null;
  if (stops.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stops[0])}`;
  }
  const origin = encodeURIComponent(stops[0]);
  const destination = encodeURIComponent(stops[stops.length - 1]);
  const waypoints = stops.slice(1, -1).map((s) => encodeURIComponent(s)).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

// ============================================================
export default function TripPlanner({ currentUser, onLogout }) {
  const [trips, setTrips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ screen: "list" }); // list | itinerary | memories
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [showEditTrip, setShowEditTrip] = useState(false);
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

  function addTrip(name, startDate, endDate, currency, participants) {
    const days = dateRangeDays(startDate, endDate).map((date) => ({ date, items: [], photos: [], journal: "" }));
    const newTrip = { id: uid("trip"), name, startDate, endDate, currency: currency || "CHF", participants: participants || [], days };
    const next = [...trips, newTrip];
    persist(next);
    setShowNewTrip(false);
    setView({ screen: "itinerary", tripId: newTrip.id });
  }

  function deleteTrip(tripId) {
    persist(trips.filter((t) => t.id !== tripId));
    setView({ screen: "list" });
  }

  function updateTrip(tripId, updates) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      let updatedTrip = { ...t, ...updates };
      // Se cambiano le date, riallinea i giorni: mantiene items/foto/journal dei giorni esistenti, aggiunge/rimuove giorni
      if (updates.startDate || updates.endDate) {
        const newDates = dateRangeDays(updatedTrip.startDate, updatedTrip.endDate);
        const existingByDate = Object.fromEntries(t.days.map((d) => [d.date, d]));
        updatedTrip.days = newDates.map((date) => existingByDate[date] || { date, items: [], photos: [], journal: "" });
      }
      return updatedTrip;
    });
    persist(next);
    setShowEditTrip(false);
  }

  function addParticipant(tripId, participant) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, participants: [...(t.participants || []), participant] } : t));
    persist(next);
  }

  function removeParticipant(tripId, name) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, participants: (t.participants || []).filter((p) => (typeof p === "string" ? p : p.name) !== name) } : t));
    persist(next);
  }

  function setParticipantDocument(tripId, participantName, document) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      const participants = (t.participants || []).map((p) => {
        const pName = typeof p === "string" ? p : p.name;
        if (pName !== participantName) return typeof p === "string" ? { name: p, document: null } : p;
        return { name: pName, document };
      });
      return { ...t, participants };
    });
    persist(next);
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

  function updateItem(tripId, date, itemId, updates) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date
            ? { ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)) }
            : d
        )
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

  function updateJournal(tripId, date, text) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) => (d.date === date ? { ...d, journal: text } : d))
      };
    });
    persist(next);
  }

  function setItemAttachment(tripId, date, itemId, attachment) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date
            ? { ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, attachment } : i)) }
            : d
        )
      };
    });
    persist(next);
  }

  function exportTripPdf(trip) {
    const doc = new jsPDF();
    const marginX = 16;
    let y = 20;
    const pageHeight = doc.internal.pageSize.height;

    function ensureSpace(needed) {
      if (y + needed > pageHeight - 16) {
        doc.addPage();
        y = 20;
      }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(trip.name, marginX, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(110, 110, 110);
    doc.text(`${formatDateRange(trip.startDate, trip.endDate)} · ${trip.days.length} giorni`, marginX, y);
    y += 10;
    doc.setTextColor(20, 20, 20);

    trip.days.forEach((day, dIdx) => {
      ensureSpace(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(`Giorno ${dIdx + 1} · ${formatDateShort(day.date)}`, marginX, y);
      y += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      if (day.items.length === 0) {
        doc.setTextColor(140, 140, 140);
        doc.text("Nessuna attività pianificata", marginX + 2, y);
        doc.setTextColor(20, 20, 20);
        y += 6;
      } else {
        day.items.forEach((item) => {
          ensureSpace(8);
          const cat = CATEGORY[item.type] || CATEGORY.tour;
          const summary = buildItemSummary(item);
          const line = `${item.time}  ·  [${cat.label}] ${item.title}${summary ? " — " + summary : ""}${item.cost ? `  (${item.cost} ${trip.currency || "CHF"})` : ""}`;
          const wrapped = doc.splitTextToSize(line, 175);
          doc.text(wrapped, marginX + 2, y);
          y += 5.5 * wrapped.length + 1;
        });
      }

      if (day.journal && day.journal.trim()) {
        ensureSpace(12);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        const wrapped = doc.splitTextToSize(day.journal.trim(), 175);
        ensureSpace(5.5 * wrapped.length);
        doc.text(wrapped, marginX + 2, y);
        y += 5.5 * wrapped.length + 2;
        doc.setTextColor(20, 20, 20);
        doc.setFont("helvetica", "normal");
      }

      y += 5;
    });

    const totalCost = trip.days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + (Number(i.cost) || 0), 0), 0);
    ensureSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Spesa totale stimata: ${totalCost} ${trip.currency || "CHF"}`, marginX, y);

    doc.save(`${trip.name.replace(/\s+/g, "_")}_viaggio.pdf`);
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
          onAddItem={(date, item) => setShowAddItem({ tripId: activeTrip.id, date, item: item || null })}
          onDeleteItem={(date, itemId) => deleteItem(activeTrip.id, date, itemId)}
          onDeleteTrip={() => deleteTrip(activeTrip.id)}
          onAddPhotos={(date, files) => addPhotos(activeTrip.id, date, files)}
          onSetAttachment={(date, itemId, attachment) => setItemAttachment(activeTrip.id, date, itemId, attachment)}
          onUpdateJournal={(date, text) => updateJournal(activeTrip.id, date, text)}
          onExportPdf={() => exportTripPdf(activeTrip)}
          onEditTrip={() => setShowEditTrip(true)}
          onSetParticipantDocument={(name, doc) => setParticipantDocument(activeTrip.id, name, doc)}
          onViewExpenses={() => setView({ screen: "expenses", tripId: activeTrip.id })}
        />
      )}

      {view.screen === "expenses" && activeTrip && (
        <ExpensesView
          trip={activeTrip}
          onBack={() => setView({ screen: "itinerary", tripId: activeTrip.id })}
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

      {showEditTrip && activeTrip && (
        <EditTripModal
          trip={activeTrip}
          onClose={() => setShowEditTrip(false)}
          onSave={(updates) => updateTrip(activeTrip.id, updates)}
        />
      )}

      {showAddItem && (
        <AddItemModal
          editingItem={showAddItem.item || null}
          currency={trips.find((t) => t.id === showAddItem.tripId)?.currency || "CHF"}
          onClose={() => setShowAddItem(null)}
          onAdd={(item) => addItem(showAddItem.tripId, showAddItem.date, item)}
          onUpdate={(updates) => updateItem(showAddItem.tripId, showAddItem.date, showAddItem.item.id, updates)}
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
function DayWeather({ location, dateStr }) {
  const [weather, setWeather] = useState(undefined); // undefined = loading, null = non disponibile

  useEffect(() => {
    let cancelled = false;
    setWeather(undefined);
    fetchDayWeather(location, dateStr).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => { cancelled = true; };
  }, [location, dateStr]);

  if (weather === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#B4B2A9", marginBottom: 10 }}>
        <Cloud size={13} /> Meteo…
      </div>
    );
  }
  if (!weather) return null;

  const { Icon, label, tempMax, tempMin, windMax, isForecast } = weather;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5F5E5A", marginBottom: 10 }}>
      <Icon size={15} color="#5F8FB5" />
      <span>{label}, {tempMin}°–{tempMax}°C</span>
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#888780" }}>
        <Wind size={11} /> {windMax} km/h
      </span>
      {!isForecast && <span style={{ fontSize: 10, color: "#B4B2A9", fontStyle: "italic" }}>· stima climatica</span>}
    </div>
  );
}

// ============================================================
// ============================================================
function ExpensesView({ trip, onBack }) {
  const curr = trip.currency || "CHF";
  const allExpenses = [];
  trip.days.forEach((day, dIdx) => {
    day.items.forEach((item) => {
      if (item.cost) {
        allExpenses.push({ ...item, dayIndex: dIdx, date: day.date });
      }
    });
  });

  const total = allExpenses.reduce((s, i) => s + Number(i.cost), 0);
  const byCategory = {};
  allExpenses.forEach((i) => {
    const cat = i.type;
    byCategory[cat] = (byCategory[cat] || 0) + Number(i.cost);
  });

  const sortedExpenses = [...allExpenses].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <button className="tp-btn" onClick={onBack} style={{ background: "transparent", color: "#5F5E5A", fontSize: 13, display: "flex", alignItems: "center", gap: 5, padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={15} /> Itinerario
      </button>

      <div style={{ marginBottom: 22 }}>
        <p className="tp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>Spese · {trip.name}</p>
        <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0 0" }}>Totale: {total} {curr}</p>
      </div>

      {Object.keys(byCategory).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([catKey, amount]) => {
            const cat = CATEGORY[catKey] || CATEGORY.tour;
            const Icon = cat.icon;
            const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
            return (
              <div key={catKey} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={14} color={cat.fg} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ color: "#3C3B38" }}>{cat.label}</span>
                    <span style={{ color: "#5F5E5A", fontWeight: 500 }}>{amount} {curr}</span>
                  </div>
                  <div style={{ height: 5, background: "#EDEBE2", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: cat.fg, borderRadius: 999 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px" }}>Tutte le spese</p>

      {sortedExpenses.length === 0 ? (
        <div style={{ border: "1px dashed #D3D1C7", borderRadius: 12, padding: 24, textAlign: "center", color: "#888780", fontSize: 13 }}>
          Nessuna spesa registrata. Aggiungi un costo quando crei o modifichi un'attività.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedExpenses.map((item) => {
            const cat = CATEGORY[item.type] || CATEGORY.tour;
            const Icon = cat.icon;
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #E3E1D8", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={14} color={cat.fg} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{item.title}</p>
                  <p style={{ fontSize: 11, color: "#888780", margin: "2px 0 0" }}>Giorno {item.dayIndex + 1} · {formatDateShort(item.date)}</p>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#8A4B1E", margin: 0, flexShrink: 0 }}>{item.cost} {curr}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
function ItineraryView({ trip, onBack, onViewMemories, onAddItem, onDeleteItem, onDeleteTrip, onAddPhotos, onSetAttachment, onUpdateJournal, onExportPdf, onEditTrip, onSetParticipantDocument, onViewExpenses }) {
  const fileInputs = useRef({});
  const attachInputs = useRef({});
  const docInputs = useRef({});
  const totalPhotos = trip.days.reduce((sum, d) => sum + d.photos.length, 0);
  const totalItems = trip.days.reduce((sum, d) => sum + d.items.length, 0);
  const totalCost = trip.days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + (Number(i.cost) || 0), 0), 0);
  const participantObjs = (trip.participants || []).map((p) => (typeof p === "string" ? { name: p, document: null } : p));

  async function handleAttach(date, itemId, file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    onSetAttachment(date, itemId, { name: file.name, src: dataUrl });
  }

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <button className="tp-btn" onClick={onBack} style={{ background: "transparent", color: "#5F5E5A", fontSize: 13, display: "flex", alignItems: "center", gap: 5, padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={15} /> Tutti i viaggi
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <p className="tp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>{trip.name}</p>
          <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0 0" }}>{formatDateRange(trip.startDate, trip.endDate)} · {trip.days.length} giorni</p>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="tp-btn" onClick={onEditTrip} title="Modifica viaggio" style={{ background: "transparent", color: "#5F5E5A", padding: 6 }}>
            <Pencil size={15} />
          </button>
          <button className="tp-btn" onClick={onExportPdf} title="Esporta come PDF" style={{ background: "transparent", color: "#5F5E5A", padding: 6 }}>
            <Download size={16} />
          </button>
          <button className="tp-btn" onClick={onDeleteTrip} title="Elimina viaggio" style={{ background: "transparent", color: "#B4B2A9", padding: 6 }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {participantObjs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px" }}>Partecipanti</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {participantObjs.map((p) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #E3E1D8", borderRadius: 10, padding: "8px 12px", background: "#fff" }}>
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{p.name}</span>
                {p.document ? (
                  <a href={p.document.src} download={p.document.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "4px 9px", borderRadius: 999 }}>
                    <FileText size={11} /> {p.document.name.length > 16 ? p.document.name.slice(0, 14) + "…" : p.document.name}
                  </a>
                ) : (
                  <button className="tp-btn" onClick={() => docInputs.current[p.name]?.click()} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888780", background: "transparent", border: "1px dashed #D3D1C7", padding: "4px 9px", borderRadius: 999 }}>
                    <Paperclip size={11} /> Allega passaporto/CI
                  </button>
                )}
                <input
                  ref={(el) => (docInputs.current[p.name] = el)}
                  type="file"
                  accept=".pdf,image/*"
                  style={{ display: "none" }}
                  onChange={async (ev) => {
                    const file = ev.target.files[0];
                    if (file) {
                      const dataUrl = await fileToDataUrl(file);
                      onSetParticipantDocument(p.name, { name: file.name, src: dataUrl });
                    }
                    ev.target.value = "";
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        className="tp-btn"
        onClick={onViewExpenses}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "#FBEEE5", border: "1px solid #F0D9C5", borderRadius: 10, padding: "10px 14px", marginBottom: 24, textAlign: "left" }}
      >
        <Wallet size={16} color="#8A4B1E" />
        <p style={{ fontSize: 13, color: "#6B3D17", margin: 0, fontWeight: 500, flex: 1 }}>Spesa totale stimata: {totalCost} {trip.currency || "CHF"}</p>
        <ChevronRight size={15} color="#8A4B1E" />
      </button>

      <div style={{ position: "relative", paddingLeft: 28, marginBottom: 28 }}>
        <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 1.5, background: "#E3E1D8" }} />

        {trip.days.map((day, dIdx) => {
          const dayCost = day.items.reduce((s, i) => s + (Number(i.cost) || 0), 0);
          const stops = day.items
            .filter((i) => i.location && i.location.trim())
            .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
            .map((i) => i.location.trim());
          const mapsUrl = buildMapsUrl(stops);
          return (
          <div key={day.date} style={{ position: "relative", marginBottom: 22 }}>
            <div style={{ position: "absolute", left: -28, top: 2, width: 13, height: 13, borderRadius: "50%", background: day.items.length > 0 ? "#993C1D" : "#D3D1C7", border: "2px solid #FBFAF6" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "#5F5E5A", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Giorno {dIdx + 1} · {formatDateShort(day.date)}
              </p>
              {dayCost > 0 && <p style={{ fontSize: 11, color: "#8A4B1E", margin: 0 }}>{dayCost} {trip.currency || "CHF"}</p>}
            </div>

            <DayWeather location={stops[0] || trip.name} dateStr={day.date} />

            {day.items.map((item) => {
              const cat = CATEGORY[item.type] || CATEGORY.tour;
              const Icon = cat.icon;
              return (
                <div key={item.id} style={{ border: "1px solid #E3E1D8", borderRadius: 12, padding: "12px 14px", marginBottom: 8, background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={16} color={cat.fg} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{item.title}</p>
                      <p style={{ fontSize: 12, color: "#5F5E5A", margin: "2px 0 0" }}>
                        {item.time}{buildItemSummary(item) ? ` · ${buildItemSummary(item)}` : ""}{item.cost ? ` · ${item.cost} ${trip.currency || "CHF"}` : ""}
                      </p>
                      {item.location && (
                        <p style={{ fontSize: 11, color: "#888780", margin: "2px 0 0", display: "flex", alignItems: "center", gap: 3 }}>
                          <MapPin size={10} /> {item.location}
                        </p>
                      )}
                    </div>
                    <button className="tp-btn" onClick={() => onAddItem(day.date, item)} title="Modifica" style={{ background: "transparent", color: "#B4B2A9", padding: 4, flexShrink: 0 }}>
                      <Pencil size={13} />
                    </button>
                    <button className="tp-btn" onClick={() => onDeleteItem(day.date, item.id)} style={{ background: "transparent", color: "#B4B2A9", padding: 4, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, paddingLeft: 44 }}>
                    {item.attachment ? (
                      <a href={item.attachment.src} download={item.attachment.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "4px 9px", borderRadius: 999 }}>
                        <FileText size={11} /> {item.attachment.name.length > 18 ? item.attachment.name.slice(0, 16) + "…" : item.attachment.name}
                      </a>
                    ) : (
                      <button className="tp-btn" onClick={() => attachInputs.current[item.id]?.click()} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888780", background: "transparent", border: "1px dashed #D3D1C7", padding: "4px 9px", borderRadius: 999 }}>
                        <Paperclip size={11} /> Allega documento
                      </button>
                    )}
                    <input
                      ref={(el) => (attachInputs.current[item.id] = el)}
                      type="file"
                      accept=".pdf,image/*"
                      style={{ display: "none" }}
                      onChange={(e) => { handleAttach(day.date, item.id, e.target.files[0]); e.target.value = ""; }}
                    />
                    {item.type === "flight" && (
                      <a href="https://turbli.com/" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#5F5E5A", textDecoration: "none", background: "#F0EEE6", padding: "4px 9px", borderRadius: 999 }}>
                        <Wind size={11} /> Turbolenze su Turbli <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {stops.length > 0 && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#27500A", background: "#EAF3DE", border: "1px solid #D7E8C4", borderRadius: 10, padding: "9px 12px", textDecoration: "none", marginTop: 4, marginBottom: 4 }}
              >
                <MapIcon size={14} /> Vedi l'itinerario del giorno sulla mappa ({stops.length} {stops.length === 1 ? "tappa" : "tappe"})
              </a>
            )}

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

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <BookOpen size={12} color="#888780" />
                <span style={{ fontSize: 11, color: "#888780", fontWeight: 500 }}>Note di giornata</span>
              </div>
              <textarea
                defaultValue={day.journal}
                placeholder="Com'è andata questa giornata? Scrivi qualche riga da ricordare…"
                onBlur={(e) => onUpdateJournal(day.date, e.target.value)}
                rows={2}
                style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12.5, color: "#3C3B38", border: "1px solid #E3E1D8", borderRadius: 10, padding: "8px 10px", resize: "vertical", background: "#fff" }}
              />
            </div>

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
        );})}
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
const CURRENCIES = [
  { code: "CHF", label: "CHF" },
  { code: "EUR", label: "EUR €" },
  { code: "USD", label: "USD $" },
  { code: "GBP", label: "GBP £" }
];

function NewTripModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currency, setCurrency] = useState("CHF");
  const [participantInput, setParticipantInput] = useState("");
  const [participants, setParticipants] = useState([]);
  const valid = name.trim() && startDate && endDate && endDate >= startDate;

  function addParticipant() {
    const n = participantInput.trim();
    if (n && !participants.includes(n)) {
      setParticipants([...participants, n]);
      setParticipantInput("");
    }
  }

  return (
    <ModalShell onClose={onClose} title="Nuovo viaggio">
      <label className="tp-label">Destinazione</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Lisbona" autoFocus />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data inizio</label>
          <input className="tp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data fine</label>
          <input className="tp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <label className="tp-label">Valuta per i costi</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            className="tp-btn"
            onClick={() => setCurrency(c.code)}
            style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: currency === c.code ? "1.5px solid #D85A30" : "1px solid #E3E1D8", background: currency === c.code ? "#FBEEE5" : "#fff", color: currency === c.code ? "#993C1D" : "#5F5E5A", fontSize: 12.5, fontWeight: 500 }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="tp-label">Partecipanti</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          className="tp-input"
          value={participantInput}
          onChange={(e) => setParticipantInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addParticipant(); } }}
          placeholder="es. Marco"
        />
        <button className="tp-btn" onClick={addParticipant} style={{ background: "#F0EEE6", color: "#5F5E5A", borderRadius: 8, padding: "0 14px", fontSize: 13, fontWeight: 500 }}>
          Aggiungi
        </button>
      </div>
      {participants.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {participants.map((p) => (
            <span key={p} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: "#F0EEE6", color: "#3C3B38", padding: "4px 10px", borderRadius: 999 }}>
              {p}
              <button className="tp-btn" onClick={() => setParticipants(participants.filter((x) => x !== p))} style={{ background: "transparent", color: "#888780", padding: 0, display: "flex" }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {participants.length === 0 && <div style={{ marginBottom: 18 }} />}

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={() => valid && onCreate(name.trim(), startDate, endDate, currency, participants)}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        Crea viaggio
      </button>
    </ModalShell>
  );
}

// ============================================================
function EditTripModal({ trip, onClose, onSave }) {
  const [name, setName] = useState(trip.name || "");
  const [startDate, setStartDate] = useState(trip.startDate || "");
  const [endDate, setEndDate] = useState(trip.endDate || "");
  const [currency, setCurrency] = useState(trip.currency || "CHF");
  const [participantInput, setParticipantInput] = useState("");
  const [participants, setParticipants] = useState(
    (trip.participants || []).map((p) => (typeof p === "string" ? { name: p, document: null } : p))
  );
  const valid = name.trim() && startDate && endDate && endDate >= startDate;

  function addParticipant() {
    const n = participantInput.trim();
    if (n && !participants.some((p) => p.name === n)) {
      setParticipants([...participants, { name: n, document: null }]);
      setParticipantInput("");
    }
  }

  return (
    <ModalShell onClose={onClose} title="Modifica viaggio">
      <label className="tp-label">Destinazione</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data inizio</label>
          <input className="tp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data fine</label>
          <input className="tp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#888780", margin: "-9px 0 14px" }}>Cambiando le date, i giorni già pianificati restano collegati alla loro data originale</p>

      <label className="tp-label">Valuta per i costi</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            className="tp-btn"
            onClick={() => setCurrency(c.code)}
            style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: currency === c.code ? "1.5px solid #D85A30" : "1px solid #E3E1D8", background: currency === c.code ? "#FBEEE5" : "#fff", color: currency === c.code ? "#993C1D" : "#5F5E5A", fontSize: 12.5, fontWeight: 500 }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="tp-label">Partecipanti</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          className="tp-input"
          value={participantInput}
          onChange={(e) => setParticipantInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addParticipant(); } }}
          placeholder="es. Marco"
        />
        <button className="tp-btn" onClick={addParticipant} style={{ background: "#F0EEE6", color: "#5F5E5A", borderRadius: 8, padding: "0 14px", fontSize: 13, fontWeight: 500 }}>
          Aggiungi
        </button>
      </div>
      {participants.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          {participants.map((p) => (
            <span key={p.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: "#F0EEE6", color: "#3C3B38", padding: "4px 10px", borderRadius: 999 }}>
              {p.name}{p.document ? " 📎" : ""}
              <button className="tp-btn" onClick={() => setParticipants(participants.filter((x) => x.name !== p.name))} style={{ background: "transparent", color: "#888780", padding: 0, display: "flex" }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {participants.length === 0 && <div style={{ marginBottom: 18 }} />}

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={() => valid && onSave({ name: name.trim(), startDate, endDate, currency, participants })}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        Salva modifiche
      </button>
    </ModalShell>
  );
}

function AddItemModal({ onClose, onAdd, onUpdate, editingItem, currency }) {
  const isEditing = !!editingItem;
  const e = editingItem || {};
  const [type, setType] = useState(e.type || "flight");

  // campi comuni
  const [title, setTitle] = useState(e.title || "");
  const [time, setTime] = useState(e.time && e.time !== "--:--" ? e.time : "");
  const [location, setLocation] = useState(e.location || "");
  const [cost, setCost] = useState(e.cost ? String(e.cost) : "");
  const [note, setNote] = useState(e.note || "");

  // campi volo
  const [departureAirport, setDepartureAirport] = useState(e.departureAirport || "");
  const [arrivalAirport, setArrivalAirport] = useState(e.arrivalAirport || "");
  const [arrivalTime, setArrivalTime] = useState(e.arrivalTime || "");
  const [flightNumber, setFlightNumber] = useState(e.flightNumber || "");
  const [terminal, setTerminal] = useState(e.terminal || "");
  const [baggage, setBaggage] = useState(e.baggage ? (Array.isArray(e.baggage) ? e.baggage : [e.baggage]) : []);
  const [passengers, setPassengers] = useState(e.passengers && e.passengers.length ? e.passengers : [{ name: "", seat: "" }]);

  // campi hotel
  const [checkOut, setCheckOut] = useState(e.checkOut || "");
  const [nights, setNights] = useState(e.nights ? String(e.nights) : "");
  const [confirmationCode, setConfirmationCode] = useState(e.confirmationCode || "");
  const [hotelGuests, setHotelGuests] = useState(e.hotelGuests && e.hotelGuests.length ? e.hotelGuests : [{ name: "" }]);

  // campi ristorante
  const [guests, setGuests] = useState(e.guests ? String(e.guests) : "");
  const [cuisine, setCuisine] = useState(e.cuisine || "");

  // campi tour
  const [duration, setDuration] = useState(e.duration || "");
  const [meetingPoint, setMeetingPoint] = useState(e.meetingPoint || "");
  const [guided, setGuided] = useState(e.guided || "");

  // campi trasporto
  const [transportMode, setTransportMode] = useState(e.transportMode || "");
  const [fromPlace, setFromPlace] = useState(e.fromPlace || "");
  const [toPlace, setToPlace] = useState(e.toPlace || "");

  const valid = title.trim();
  const curr = currency || "CHF";

  function updatePassenger(idx, field, value) {
    setPassengers(passengers.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }
  function addPassengerRow() {
    setPassengers([...passengers, { name: "", seat: "" }]);
  }
  function removePassengerRow(idx) {
    setPassengers(passengers.length > 1 ? passengers.filter((_, i) => i !== idx) : passengers);
  }

  function updateHotelGuest(idx, value) {
    setHotelGuests(hotelGuests.map((g, i) => (i === idx ? { name: value } : g)));
  }
  function addHotelGuestRow() {
    setHotelGuests([...hotelGuests, { name: "" }]);
  }
  function removeHotelGuestRow(idx) {
    setHotelGuests(hotelGuests.length > 1 ? hotelGuests.filter((_, i) => i !== idx) : hotelGuests);
  }

  function handleSubmit() {
    if (!valid) return;
    const cleanPassengers = passengers.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), seat: p.seat.trim() }));
    const cleanHotelGuests = hotelGuests.filter((g) => g.name.trim()).map((g) => ({ name: g.name.trim() }));
    const payload = {
      type, title: title.trim(), time: time || "--:--",
      location: location.trim(), cost: cost ? Number(cost) : 0, note: note.trim(),
      departureAirport: departureAirport.trim(), arrivalAirport: arrivalAirport.trim(),
      arrivalTime, flightNumber: flightNumber.trim(), terminal: terminal.trim(), baggage,
      passengers: cleanPassengers,
      checkOut, nights: nights ? Number(nights) : 0, confirmationCode: confirmationCode.trim(),
      hotelGuests: cleanHotelGuests,
      guests: guests ? Number(guests) : 0, cuisine: cuisine.trim(),
      duration: duration.trim(), meetingPoint: meetingPoint.trim(), guided,
      transportMode, fromPlace: fromPlace.trim(), toPlace: toPlace.trim()
    };
    if (isEditing) {
      onUpdate(payload);
    } else {
      onAdd({ ...payload, attachment: null });
    }
  }

  const titlePlaceholder = {
    flight: "es. Volo Zurigo → Lisbona",
    hotel: "es. Hotel Borges",
    restaurant: "es. Cena da Maria",
    tour: "es. Tour a piedi · Alfama",
    transport: "es. Taxi aeroporto → appartamento"
  }[type];

  return (
    <ModalShell onClose={onClose} title={isEditing ? "Modifica attività" : "Aggiungi attività"}>
      <label className="tp-label">Tipo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {Object.entries(CATEGORY).map(([key, cat]) => {
          const Icon = cat.icon;
          const active = type === key;
          return (
            <button
              key={key}
              className="tp-btn"
              onClick={() => setType(key)}
              style={{ flex: "1 1 30%", minWidth: 90, padding: "10px 4px", borderRadius: 8, border: active ? `1.5px solid ${cat.fg}` : "1px solid #E3E1D8", background: active ? cat.bg : "#fff", color: cat.fg, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
            >
              <Icon size={16} />
              <span style={{ fontSize: 10 }}>{cat.label}</span>
            </button>
          );
        })}
      </div>

      <label className="tp-label">Titolo</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder={titlePlaceholder} />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">{type === "flight" ? "Orario partenza" : type === "hotel" ? "Check-in" : "Orario"}</label>
          <input className="tp-input" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Costo ({curr})</label>
          <input className="tp-input" type="number" min="0" step="0.01" value={cost} onChange={(ev) => setCost(ev.target.value)} placeholder="opzionale" />
        </div>
      </div>

      {/* ---- campi specifici VOLO ---- */}
      {type === "flight" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Aeroporto partenza</label>
              <input className="tp-input" value={departureAirport} onChange={(ev) => setDepartureAirport(ev.target.value)} placeholder="es. Zurigo ZRH" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Aeroporto arrivo</label>
              <input className="tp-input" value={arrivalAirport} onChange={(ev) => setArrivalAirport(ev.target.value)} placeholder="es. Lisbona LIS" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Orario arrivo</label>
              <input className="tp-input" type="time" value={arrivalTime} onChange={(ev) => setArrivalTime(ev.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Numero volo</label>
              <input className="tp-input" value={flightNumber} onChange={(ev) => setFlightNumber(ev.target.value)} placeholder="es. TAP1234" />
            </div>
          </div>
          <label className="tp-label">Terminal</label>
          <input className="tp-input" style={{ marginBottom: 14 }} value={terminal} onChange={(ev) => setTerminal(ev.target.value)} placeholder="opzionale" />

          <label className="tp-label">Passeggeri e posti</label>
          {passengers.map((p, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="tp-input" style={{ flex: 2 }} value={p.name} onChange={(ev) => updatePassenger(idx, "name", ev.target.value)} placeholder="es. Stefano" />
              <input className="tp-input" style={{ flex: 1 }} value={p.seat} onChange={(ev) => updatePassenger(idx, "seat", ev.target.value)} placeholder="posto" />
              <button className="tp-btn" onClick={() => removePassengerRow(idx)} style={{ background: "transparent", color: "#B4B2A9", padding: "0 6px" }}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="tp-btn" onClick={addPassengerRow} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#888780", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "7px 12px", fontSize: 12, marginBottom: 14 }}>
            <Plus size={12} /> Aggiungi passeggero
          </button>

          <label className="tp-label">Bagaglio</label>
          <p style={{ fontSize: 11, color: "#888780", margin: "-3px 0 8px" }}>Puoi selezionare più opzioni</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ v: "mano", l: "A mano" }, { v: "stiva", l: "In stiva" }].map((opt) => {
              const active = baggage.includes(opt.v);
              return (
                <button
                  key={opt.v}
                  className="tp-btn"
                  onClick={() => setBaggage(active ? baggage.filter((b) => b !== opt.v) : [...baggage, opt.v])}
                  style={{ flex: 1, padding: "9px", borderRadius: 8, border: active ? "1.5px solid #712B13" : "1px solid #E3E1D8", background: active ? "#FAECE7" : "#fff", color: "#712B13", fontSize: 12.5 }}
                >
                  {active ? "✓ " : ""}{opt.l}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ---- campi specifici HOTEL ---- */}
      {type === "hotel" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Check-out</label>
              <input className="tp-input" type="time" value={checkOut} onChange={(ev) => setCheckOut(ev.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Numero notti</label>
              <input className="tp-input" type="number" min="0" value={nights} onChange={(ev) => setNights(ev.target.value)} placeholder="opzionale" />
            </div>
          </div>
          <label className="tp-label">Codice prenotazione</label>
          <input className="tp-input" style={{ marginBottom: 14 }} value={confirmationCode} onChange={(ev) => setConfirmationCode(ev.target.value)} placeholder="opzionale" />

          <label className="tp-label">Ospiti</label>
          {hotelGuests.map((g, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="tp-input" value={g.name} onChange={(ev) => updateHotelGuest(idx, ev.target.value)} placeholder="es. Stefano" />
              <button className="tp-btn" onClick={() => removeHotelGuestRow(idx)} style={{ background: "transparent", color: "#B4B2A9", padding: "0 6px" }}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="tp-btn" onClick={addHotelGuestRow} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#888780", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "7px 12px", fontSize: 12, marginBottom: 14 }}>
            <Plus size={12} /> Aggiungi ospite
          </button>
        </>
      )}

      {/* ---- campi specifici RISTORANTE ---- */}
      {type === "restaurant" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label className="tp-label">Numero persone</label>
            <input className="tp-input" type="number" min="1" value={guests} onChange={(ev) => setGuests(ev.target.value)} placeholder="opzionale" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="tp-label">Tipo di cucina</label>
            <input className="tp-input" value={cuisine} onChange={(ev) => setCuisine(ev.target.value)} placeholder="es. portoghese" />
          </div>
        </div>
      )}

      {/* ---- campi specifici TOUR ---- */}
      {type === "tour" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Durata</label>
              <input className="tp-input" value={duration} onChange={(ev) => setDuration(ev.target.value)} placeholder="es. 2 ore" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Punto d'incontro</label>
              <input className="tp-input" value={meetingPoint} onChange={(ev) => setMeetingPoint(ev.target.value)} placeholder="opzionale" />
            </div>
          </div>
          <label className="tp-label">Guida</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ v: "si", l: "Con guida" }, { v: "no", l: "Senza guida" }].map((opt) => (
              <button key={opt.v} className="tp-btn" onClick={() => setGuided(guided === opt.v ? "" : opt.v)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: guided === opt.v ? "1.5px solid #27500A" : "1px solid #E3E1D8", background: guided === opt.v ? "#EAF3DE" : "#fff", color: "#27500A", fontSize: 12.5 }}>
                {opt.l}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- campi specifici TRASPORTO ---- */}
      {type === "transport" && (
        <>
          <label className="tp-label">Mezzo</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.entries(TRANSPORT_MODES).map(([key, label]) => (
              <button
                key={key}
                className="tp-btn"
                onClick={() => setTransportMode(transportMode === key ? "" : key)}
                style={{ padding: "7px 12px", borderRadius: 999, border: transportMode === key ? "1.5px solid #4A2E8C" : "1px solid #E3E1D8", background: transportMode === key ? "#EFEAF7" : "#fff", color: "#4A2E8C", fontSize: 12 }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Da</label>
              <input className="tp-input" value={fromPlace} onChange={(ev) => setFromPlace(ev.target.value)} placeholder="es. Aeroporto" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">A</label>
              <input className="tp-input" value={toPlace} onChange={(ev) => setToPlace(ev.target.value)} placeholder="es. Appartamento" />
            </div>
          </div>
        </>
      )}

      <label className="tp-label">Luogo (indirizzo o nome del posto)</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={location} onChange={(ev) => setLocation(ev.target.value)} placeholder="es. Rua Garrett 108, Lisbona" />
      <p style={{ fontSize: 11, color: "#888780", margin: "-9px 0 14px" }}>Usato per mostrare questa tappa sulla mappa del giorno</p>

      <label className="tp-label">Altre note</label>
      <input className="tp-input" style={{ marginBottom: 18 }} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="opzionale" />

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={handleSubmit}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        {isEditing ? "Salva modifiche" : "Aggiungi"}
      </button>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(44,44,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000, overflowY: "auto" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBFAF6", borderRadius: 14, padding: 22, width: "100%", maxWidth: 380, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.18)", margin: "auto" }}>
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
