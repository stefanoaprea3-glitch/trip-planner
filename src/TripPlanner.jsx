import React, { useState, useEffect, useRef, useCallback } from "react";
import { Plus, MapPin, Plane, Bed, UtensilsCrossed, Compass, ArrowLeft, X, Camera, ChevronRight, Trash2, Pencil, LogOut, Paperclip, Wallet, Map as MapIcon, BookOpen, Download, FileText, Cloud, CloudRain, CloudSnow, Sun, CloudLightning, Wind, ExternalLink, Car, TramFront, Bus, Ship, Bike } from "lucide-react";
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

// Geocoding preciso per la mappa — usa Nominatim (OpenStreetMap), molto più preciso per luoghi specifici
const nominatimCache = new Map();
async function geocodeForMap(query) {
  if (!query || !query.trim()) return null;
  const key = query.trim().toLowerCase();
  if (nominatimCache.has(key)) return nominatimCache.get(key);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "it", "User-Agent": "TripPlannerApp/1.0" } }
    );
    const data = await res.json();
    const result = data && data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name.split(",")[0] } : null;
    nominatimCache.set(key, result);
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

// ---------- storage helpers (Supabase + localStorage fallback) ----------
import { supabase, loadTripsFromDB, saveTripToDB, deleteTripFromDB } from "./supabase.js";

const STORAGE_KEY = "trips:data";

// Carica: prova Supabase prima, fallback localStorage
async function loadTrips() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const dbTrips = await loadTripsFromDB();
      if (dbTrips && dbTrips.length > 0) {
        // Sincronizza anche localStorage come cache offline
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dbTrips));
        return dbTrips;
      }
    }
  } catch (e) {
    console.warn("Supabase non disponibile, uso localStorage", e);
  }
  // Fallback localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Salva: sempre su localStorage (veloce, offline), e su Supabase se loggato
async function saveTrips(trips) {
  // Salva subito in localStorage (esperienza fluida senza latenza)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch (e) {
    console.error("Errore localStorage", e);
  }
  // Sincronizza su Supabase in background
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    // Salva ogni viaggio modificato
    for (const trip of trips) {
      await saveTripToDB(trip);
    }
  } catch (e) {
    console.warn("Sync Supabase fallita, dati salvati solo in locale", e);
  }
}

async function deleteTripRemote(trip) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && trip._dbId) await deleteTripFromDB(trip._dbId);
  } catch (e) {
    console.warn("Errore eliminazione remota", e);
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
    accommodations: [
      { id: "stay1", name: "Hotel Borges", location: "Rua Garrett 108, Lisbona", checkIn: "2026-09-12", checkOut: "2026-09-16", cost: 420, confirmationCode: "" }
    ],
    days: [
      {
        date: "2026-09-12",
        items: [
          { id: "i1", type: "flight", title: "Volo Zurigo → Lisbona", time: "09:40", note: "TAP1234 · Terminal 2", location: "Aeroporto di Lisbona", cost: 180, attachment: null }
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
const TRANSPORT_MODES = { taxi: "Taxi", treno: "Treno", bus: "Bus", auto: "Auto a noleggio", traghetto: "Traghetto", aereo: "Volo", altro: "Altro" };
const TRANSPORT_ICONS = { taxi: Car, treno: TramFront, bus: Bus, auto: Car, traghetto: Ship, aereo: Plane, altro: Car };
const RENTAL_VEHICLE_TYPES = { auto: "Auto", scooter: "Scooter/Moto", bici: "Bici" };
const RENTAL_VEHICLE_ICONS = { auto: Car, scooter: Bike, bici: Bike, altro: Bike };
const RENTAL_VEHICLE_TYPES_COMPAT = { altro: "Scooter/Moto" }; // alias chiavi vecchie
function rentalVehicleLabel(vehicleType) {
  return RENTAL_VEHICLE_TYPES[vehicleType] || RENTAL_VEHICLE_TYPES_COMPAT[vehicleType] || "Noleggio";
}

const CATEGORY = {
  flight: { label: "Volo", icon: Plane, bg: "#FAECE7", fg: "#712B13" },
  restaurant: { label: "Ristorante", icon: UtensilsCrossed, bg: "#FBEAF0", fg: "#72243E" },
  tour: { label: "Tour / attività", icon: Compass, bg: "#EAF3DE", fg: "#27500A" },
  transport: { label: "Trasporto", icon: Car, bg: "#EFEAF7", fg: "#4A2E8C" }
};

// Usata solo nella vista riepilogo spese, include "hotel" per gli alloggi (non più un tipo attività selezionabile)
const EXPENSE_CATEGORY = {
  ...CATEGORY,
  hotel: { label: "Alloggio", icon: Bed, bg: "#E6F1FB", fg: "#0C447C" }
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
// ============================================================
// DayMap — mappa Leaflet embedded con pin sui luoghi del giorno
// Geocodifica i luoghi usando la stessa funzione del meteo (Open-Meteo)
// ============================================================
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";

// Fix icone Leaflet con Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function FitBounds({ markers }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lon], 15);
    } else {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lon]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [markers]);
  return null;
}

function DayMap({ stops, onClose }) {
  // stops: [{ name, location }]
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function geocodeAll() {
      const results = await Promise.all(
        stops.map(async (stop) => {
          // Prova prima con la query completa, poi solo col nome se fallisce
          let geo = await geocodeForMap(stop.location || stop.name);
          if (!geo && stop.location) geo = await geocodeForMap(stop.name);
          if (!geo) return null;
          return { name: stop.name, location: stop.location || stop.name, lat: geo.lat, lon: geo.lon };
        })
      );
      if (!cancelled) {
        setMarkers(results.filter(Boolean));
        setLoading(false);
      }
    }
    geocodeAll();
    return () => { cancelled = true; };
  }, []);

  const center = markers.length > 0
    ? [markers.reduce((s, m) => s + m.lat, 0) / markers.length, markers.reduce((s, m) => s + m.lon, 0) / markers.length]
    : [41.9, 12.5];

  return (
    <div style={{ marginBottom: 12, borderRadius: 12, overflow: "hidden", border: "1px solid #E3E1D8", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#F0F7ED", borderBottom: "1px solid #D7E8C4" }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "#27500A", display: "flex", alignItems: "center", gap: 6 }}>
          <MapIcon size={13} /> {markers.length > 0 ? `${markers.length} posti sulla mappa` : "Caricamento…"}
        </span>
        <button className="tp-btn" onClick={onClose} style={{ background: "transparent", color: "#888780", padding: 2 }}>
          <X size={15} />
        </button>
      </div>
      {loading ? (
        <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAF6", color: "#888780", fontSize: 13 }}>
          Caricamento mappa…
        </div>
      ) : markers.length === 0 ? (
        <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAF6", color: "#888780", fontSize: 13 }}>
          Nessun luogo geocodificato trovato
        </div>
      ) : (
        <MapContainer center={center} zoom={13} style={{ height: 240, width: "100%" }} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <FitBounds markers={markers} />
          {markers.map((m, idx) => (
            <Marker
              key={idx}
              position={[m.lat, m.lon]}
              eventHandlers={{
                click: () => window.open(buildNavigateUrl(m.location || m.name), "_blank")
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", color: "#2C2C2A" }}>{m.name}</span>
              </Tooltip>
              <Popup>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{m.name}</div>
                <a
                  href={buildNavigateUrl(m.location || m.name)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "#27500A", fontWeight: 500 }}
                >
                  🧭 Naviga da qui →
                </a>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}
    </div>
  );
}

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
    if (item.endTime) parts.push(`fino alle ${item.endTime}`);
    if (item.duration) parts.push(item.duration);
    if (item.meetingPoint) parts.push(`ritrovo: ${item.meetingPoint}`);
    if (item.guided) parts.push(item.guided === "si" ? "con guida" : "senza guida");
    if (item.tourStops && item.tourStops.length) {
      parts.push(item.tourStops.map((s) => s.name).join(", "));
    }
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
    // Un solo posto: cerca su Apple Maps
    return `https://maps.apple.com/?q=${encodeURIComponent(stops[0])}`;
  }
  // Più posti: Apple Maps supporta pin multipli con il parametro q multiplo
  const params = stops.map((s) => `q=${encodeURIComponent(s)}`).join("&");
  return `https://maps.apple.com/?${params}`;
}

function buildNavigateUrl(location) {
  // Naviga dalla posizione attuale — usa Google Maps per la navigazione
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}&travelmode=walking`;
}

// ============================================================
export default function TripPlanner({ currentUser, onLogout }) {
  const [trips, setTrips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ screen: "list" }); // list | itinerary | memories
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [showEditTrip, setShowEditTrip] = useState(false);
  const [showAddStay, setShowAddStay] = useState(null); // { tripId, accommodation? }
  const [showAddLeg, setShowAddLeg] = useState(null); // { tripId, leg? }
  const [showJourneyModal, setShowJourneyModal] = useState(null); // { tripId, direction }
  const [showAddRental, setShowAddRental] = useState(null); // { tripId, rental? }
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
    const newTrip = { id: uid("trip"), name, startDate, endDate, currency: currency || "CHF", participants: participants || [], accommodations: [], days };
    const next = [...trips, newTrip];
    persist(next);
    setShowNewTrip(false);
    setView({ screen: "itinerary", tripId: newTrip.id });
  }

  function deleteTrip(tripId) {
    const trip = trips.find((t) => t.id === tripId);
    if (trip) deleteTripRemote(trip);
    persist(trips.filter((t) => t.id !== tripId));
    setView({ screen: "list" });
  }

  function addAccommodation(tripId, accommodation) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, accommodations: [...(t.accommodations || []), { ...accommodation, id: uid("stay") }] } : t));
    persist(next);
    setShowAddStay(null);
  }

  function updateAccommodation(tripId, stayId, updates) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return { ...t, accommodations: (t.accommodations || []).map((a) => (a.id === stayId ? { ...a, ...updates } : a)) };
    });
    persist(next);
    setShowAddStay(null);
  }

  function deleteAccommodation(tripId, stayId) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, accommodations: (t.accommodations || []).filter((a) => a.id !== stayId) } : t));
    persist(next);
  }

  // ---- Tappe (legs): raggruppano un intervallo di giorni con nome, luogo, alloggio e trasferimento ----
  function addLeg(tripId, leg) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, legs: [...(t.legs || []), { ...leg, id: uid("leg") }] } : t));
    persist(next);
    setShowAddLeg(null);
  }

  function updateLeg(tripId, legId, updates) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return { ...t, legs: (t.legs || []).map((l) => (l.id === legId ? { ...l, ...updates } : l)) };
    });
    persist(next);
    setShowAddLeg(null);
  }

  function deleteLeg(tripId, legId) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, legs: (t.legs || []).filter((l) => l.id !== legId) } : t));
    persist(next);
  }

  function reorderLegs(tripId, fromIndex, toIndex) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      const legs = [...(t.legs || [])];
      const [moved] = legs.splice(fromIndex, 1);
      legs.splice(toIndex, 0, moved);
      return { ...t, legs };
    });
    persist(next);
  }

  function setJourneyTransport(tripId, direction, data) {
    // direction: "outboundTransport" | "returnTransport"
    const next = trips.map((t) => (t.id === tripId ? { ...t, [direction]: data } : t));
    persist(next);
    setShowJourneyModal(null);
  }

  function addRental(tripId, rental) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, rentals: [...(t.rentals || []), { ...rental, id: uid("rental") }] } : t));
    persist(next);
    setShowAddRental(null);
  }

  function updateRental(tripId, rentalId, updates) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return { ...t, rentals: (t.rentals || []).map((r) => (r.id === rentalId ? { ...r, ...updates } : r)) };
    });
    persist(next);
    setShowAddRental(null);
  }

  function deleteRental(tripId, rentalId) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, rentals: (t.rentals || []).filter((r) => r.id !== rentalId) } : t));
    persist(next);
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

  function moveItem(tripId, fromDate, toDate, itemId) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      let movedItem = null;
      const days = t.days.map((d) => {
        if (d.date === fromDate) {
          movedItem = d.items.find((i) => i.id === itemId);
          return { ...d, items: d.items.filter((i) => i.id !== itemId) };
        }
        return d;
      });
      return {
        ...t,
        days: days.map((d) =>
          d.date === toDate && movedItem ? { ...d, items: [...d.items, movedItem] } : d
        )
      };
    });
    persist(next);
  }

  function updateBudget(tripId, budget) {
    const next = trips.map((t) => (t.id === tripId ? { ...t, budget: budget ? Number(budget) : 0 } : t));
    persist(next);
  }

  function addQuickExpense(tripId, date, expense) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date
            ? { ...d, quickExpenses: [...(d.quickExpenses || []), { ...expense, id: uid("qexp") }] }
            : d
        )
      };
    });
    persist(next);
  }

  function deleteQuickExpense(tripId, date, expenseId) {
    const next = trips.map((t) => {
      if (t.id !== tripId) return t;
      return {
        ...t,
        days: t.days.map((d) =>
          d.date === date
            ? { ...d, quickExpenses: (d.quickExpenses || []).filter((e) => e.id !== expenseId) }
            : d
        )
      };
    });
    persist(next);
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

    if (trip.outboundTransport || trip.returnTransport) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Andata e ritorno", marginX, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      [["Andata", trip.outboundTransport], ["Ritorno", trip.returnTransport]].forEach(([label, t]) => {
        if (!t) return;
        ensureSpace(6);
        const summary = buildItemSummary(t);
        const line = `${label}: ${t.title}${t.time && t.time !== "--:--" ? " · " + t.time : ""}${summary ? " · " + summary : ""}${t.cost ? `  (${t.cost} ${trip.currency || "CHF"})` : ""}`;
        const wrapped = doc.splitTextToSize(line, 175);
        doc.text(wrapped, marginX + 2, y);
        y += 5.5 * wrapped.length;
      });
      y += 6;
    }

    if (trip.legs && trip.legs.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Tappe del viaggio", marginX, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const sortedLegs = [...trip.legs].sort((a, b) => a.startDate.localeCompare(b.startDate));
      sortedLegs.forEach((leg, idx) => {
        ensureSpace(6);
        const line = `${formatDateShort(leg.startDate)} → ${formatDateShort(leg.endDate)}  ·  ${leg.name}${leg.accommodationName ? " — alloggio: " + leg.accommodationName : ""}${leg.accommodationCost ? `  (${leg.accommodationCost} ${trip.currency || "CHF"})` : ""}`;
        const wrapped = doc.splitTextToSize(line, 175);
        doc.text(wrapped, marginX + 2, y);
        y += 5.5 * wrapped.length;
        if (idx < sortedLegs.length - 1) {
          ensureSpace(5);
          doc.setFont("helvetica", "italic");
          doc.setTextColor(110, 110, 110);
          const transferLabel = leg.transferMode ? TRANSPORT_MODES[leg.transferMode] : (leg.transferNote || "trasferimento");
          const transferLine = `   ↳ ${transferLabel}${leg.transferDetails ? " · " + leg.transferDetails : ""} verso ${sortedLegs[idx + 1].name}${leg.transferDuration ? " · ~" + leg.transferDuration : ""}`;
          doc.text(transferLine, marginX + 2, y);
          y += 5.5;
          doc.setFont("helvetica", "normal");
          doc.setTextColor(20, 20, 20);
        }
      });
      y += 6;
    }

    if (trip.rentals && trip.rentals.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Noleggi", marginX, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      [...trip.rentals].sort((a, b) => a.pickupDate.localeCompare(b.pickupDate)).forEach((rental) => {
        ensureSpace(6);
        const line = `${formatDateShort(rental.pickupDate)}${rental.pickupLocation ? " (" + rental.pickupLocation + ")" : ""} → ${formatDateShort(rental.dropoffDate)}${rental.dropoffLocation ? " (" + rental.dropoffLocation + ")" : ""}  ·  ${rental.name}${rental.cost ? `  (${rental.cost} ${trip.currency || "CHF"})` : ""}`;
        const wrapped = doc.splitTextToSize(line, 175);
        doc.text(wrapped, marginX + 2, y);
        y += 5.5 * wrapped.length;
      });
      y += 6;
    }

    if (trip.accommodations && trip.accommodations.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Soggiorni senza tappa", marginX, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      [...trip.accommodations].sort((a, b) => a.checkIn.localeCompare(b.checkIn)).forEach((stay) => {
        ensureSpace(6);
        const line = `${formatDateShort(stay.checkIn)} → ${formatDateShort(stay.checkOut)}  ·  ${stay.name}${stay.location ? " — " + stay.location : ""}${stay.cost ? `  (${stay.cost} ${trip.currency || "CHF"})` : ""}`;
        const wrapped = doc.splitTextToSize(line, 175);
        doc.text(wrapped, marginX + 2, y);
        y += 5.5 * wrapped.length;
      });
      y += 6;
    }

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

    const totalCost = trip.days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + (Number(i.cost) || 0), 0), 0) + (trip.accommodations || []).reduce((s, a) => s + (Number(a.cost) || 0), 0) + (trip.legs || []).reduce((s, l) => s + (Number(l.accommodationCost) || 0), 0) + (Number(trip.outboundTransport?.cost) || 0) + (Number(trip.returnTransport?.cost) || 0) + (trip.rentals || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
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
          onMoveItem={(fromDate, toDate, itemId) => moveItem(activeTrip.id, fromDate, toDate, itemId)}
          onDeleteTrip={() => deleteTrip(activeTrip.id)}
          onAddPhotos={(date, files) => addPhotos(activeTrip.id, date, files)}
          onSetAttachment={(date, itemId, attachment) => setItemAttachment(activeTrip.id, date, itemId, attachment)}
          onUpdateJournal={(date, text) => updateJournal(activeTrip.id, date, text)}
          onExportPdf={() => exportTripPdf(activeTrip)}
          onEditTrip={() => setShowEditTrip(true)}
          onSetParticipantDocument={(name, doc) => setParticipantDocument(activeTrip.id, name, doc)}
          onViewExpenses={() => setView({ screen: "expenses", tripId: activeTrip.id })}
          onAddStay={(stay) => setShowAddStay({ tripId: activeTrip.id, accommodation: stay || null })}
          onDeleteStay={(stayId) => deleteAccommodation(activeTrip.id, stayId)}
          onAddLeg={(leg) => setShowAddLeg({ tripId: activeTrip.id, leg: leg || null })}
          onDeleteLeg={(legId) => deleteLeg(activeTrip.id, legId)}
          onReorderLegs={(from, to) => reorderLegs(activeTrip.id, from, to)}
          onEditJourney={(direction) => setShowJourneyModal({ tripId: activeTrip.id, direction })}
          onAddRental={(rental) => setShowAddRental({ tripId: activeTrip.id, rental: rental || null })}
          onDeleteRental={(rentalId) => deleteRental(activeTrip.id, rentalId)}
        />
      )}

      {view.screen === "expenses" && activeTrip && (
        <ExpensesView
          trip={activeTrip}
          onBack={() => setView({ screen: "itinerary", tripId: activeTrip.id })}
          onUpdateBudget={(budget) => updateBudget(activeTrip.id, budget)}
          onAddQuickExpense={(date, expense) => addQuickExpense(activeTrip.id, date, expense)}
          onDeleteQuickExpense={(date, expenseId) => deleteQuickExpense(activeTrip.id, date, expenseId)}
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

      {showAddStay && activeTrip && (
        <StayModal
          trip={activeTrip}
          editingStay={showAddStay.accommodation}
          onClose={() => setShowAddStay(null)}
          onAdd={(stay) => addAccommodation(showAddStay.tripId, stay)}
          onUpdate={(updates) => updateAccommodation(showAddStay.tripId, showAddStay.accommodation.id, updates)}
        />
      )}

      {showAddLeg && activeTrip && (
        <LegModal
          trip={activeTrip}
          editingLeg={showAddLeg.leg}
          onClose={() => setShowAddLeg(null)}
          onAdd={(leg) => addLeg(showAddLeg.tripId, leg)}
          onUpdate={(updates) => updateLeg(showAddLeg.tripId, showAddLeg.leg.id, updates)}
        />
      )}

      {showJourneyModal && activeTrip && (
        <JourneyModal
          trip={activeTrip}
          direction={showJourneyModal.direction}
          existingData={activeTrip[showJourneyModal.direction]}
          onClose={() => setShowJourneyModal(null)}
          onSave={(data) => setJourneyTransport(showJourneyModal.tripId, showJourneyModal.direction, data)}
        />
      )}

      {showAddRental && activeTrip && (
        <RentalModal
          trip={activeTrip}
          editingRental={showAddRental.rental}
          onClose={() => setShowAddRental(null)}
          onAdd={(rental) => addRental(showAddRental.tripId, rental)}
          onUpdate={(updates) => updateRental(showAddRental.tripId, showAddRental.rental.id, updates)}
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
function ExpensesView({ trip, onBack, onUpdateBudget, onAddQuickExpense, onDeleteQuickExpense }) {
  const curr = trip.currency || "CHF";
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(trip.budget ? String(trip.budget) : "");
  const [quickInputs, setQuickInputs] = useState({}); // { date: { label, amount, category } }

  // --- raccolta spese fisse ---
  const fixedExpenses = [];
  if (trip.outboundTransport?.cost) fixedExpenses.push({ label: "Andata · " + (trip.outboundTransport.title || ""), amount: trip.outboundTransport.cost, cat: "transport" });
  if (trip.returnTransport?.cost) fixedExpenses.push({ label: "Ritorno · " + (trip.returnTransport.title || ""), amount: trip.returnTransport.cost, cat: "transport" });
  (trip.legs || []).forEach((l) => { if (l.accommodationCost) fixedExpenses.push({ label: l.accommodationName || l.name, amount: l.accommodationCost, cat: "hotel" }); });
  (trip.accommodations || []).forEach((a) => { if (a.cost) fixedExpenses.push({ label: a.name, amount: a.cost, cat: "hotel" }); });
  (trip.rentals || []).forEach((r) => { if (r.cost) fixedExpenses.push({ label: r.name, amount: r.cost, cat: "transport" }); });
  const fixedTotal = fixedExpenses.reduce((s, e) => s + Number(e.amount), 0);

  // --- spese per giorno ---
  const dayTotals = trip.days.map((day) => {
    const fromItems = day.items.reduce((s, i) => s + (Number(i.cost) || 0), 0);
    const fromQuick = (day.quickExpenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { date: day.date, fromItems, fromQuick, total: fromItems + fromQuick, items: day.items.filter((i) => i.cost), quickExpenses: day.quickExpenses || [] };
  });
  const dailyTotal = dayTotals.reduce((s, d) => s + d.total, 0);
  const grandTotal = fixedTotal + dailyTotal;
  const budget = Number(trip.budget) || 0;

  // --- breakdown per categoria ---
  const catTotals = { transport: 0, hotel: 0, restaurant: 0, tour: 0, altro: 0 };
  fixedExpenses.forEach((e) => { catTotals[e.cat] = (catTotals[e.cat] || 0) + Number(e.amount); });
  trip.days.forEach((day) => {
    day.items.forEach((i) => {
      if (!i.cost) return;
      const cat = i.type === "flight" || i.type === "transport" ? "transport" : i.type === "restaurant" ? "restaurant" : i.type === "tour" ? "tour" : "altro";
      catTotals[cat] = (catTotals[cat] || 0) + Number(i.cost);
    });
    (day.quickExpenses || []).forEach((e) => {
      const cat = e.category || "altro";
      catTotals[cat] = (catTotals[cat] || 0) + Number(e.amount);
    });
  });

  const CAT_LABELS = { transport: "Trasporti", hotel: "Alloggi", restaurant: "Cibo", tour: "Attività", altro: "Altro" };
  const CAT_COLORS = { transport: "#712B13", hotel: "#0C447C", restaurant: "#72243E", tour: "#27500A", altro: "#4A2E8C" };
  const CAT_BG = { transport: "#FAECE7", hotel: "#E6F1FB", restaurant: "#FBEAF0", tour: "#EAF3DE", altro: "#EFEAF7" };

  const QUICK_CATEGORIES = [
    { key: "restaurant", label: "Cibo" },
    { key: "transport", label: "Trasporto" },
    { key: "tour", label: "Attività" },
    { key: "altro", label: "Altro" }
  ];

  function initQuickInput(date) {
    if (!quickInputs[date]) {
      setQuickInputs((prev) => ({ ...prev, [date]: { label: "", amount: "", category: "altro", open: false } }));
    }
  }

  return (
    <div style={{ padding: "24px 20px 40px", fontFamily: "'Inter', sans-serif" }}>
      <button className="tp-btn" onClick={onBack} style={{ background: "transparent", color: "#5F5E5A", fontSize: 13, display: "flex", alignItems: "center", gap: 5, padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={15} /> Itinerario
      </button>

      <div style={{ marginBottom: 22 }}>
        <p className="tp-display" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>Contabilità · {trip.name}</p>
      </div>

      {/* ---- RIEPILOGO TOTALI ---- */}
      <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 14, padding: "18px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: budget > 0 ? 14 : 0 }}>
          <div>
            <p style={{ fontSize: 12, color: "#888780", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Spesa totale</p>
            <p className="tp-display" style={{ fontSize: 26, fontWeight: 700, margin: 0, color: budget > 0 && grandTotal > budget ? "#993C1D" : "#2C2C2A" }}>{grandTotal} {curr}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            {editingBudget ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="tp-input"
                  type="number"
                  min="0"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="es. 2000"
                  style={{ width: 100, fontSize: 13 }}
                  autoFocus
                />
                <button className="tp-btn" onClick={() => { onUpdateBudget(budgetInput); setEditingBudget(false); }} style={{ background: "#D85A30", color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>OK</button>
                <button className="tp-btn" onClick={() => setEditingBudget(false)} style={{ background: "transparent", color: "#888780", padding: 4 }}><X size={14} /></button>
              </div>
            ) : (
              <button className="tp-btn" onClick={() => setEditingBudget(true)} style={{ background: "transparent", color: budget > 0 ? "#5F5E5A" : "#B4B2A9", fontSize: 12, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                <Wallet size={13} /> {budget > 0 ? `Budget: ${budget} ${curr}` : "Imposta budget"}
              </button>
            )}
          </div>
        </div>
        {budget > 0 && (
          <div>
            <div style={{ height: 8, background: "#F0EEE6", borderRadius: 999, overflow: "hidden", marginBottom: 4 }}>
              <div style={{ height: "100%", width: `${Math.min((grandTotal / budget) * 100, 100)}%`, background: grandTotal > budget ? "#993C1D" : "#D85A30", borderRadius: 999, transition: "width 0.3s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888780" }}>
              <span>{grandTotal > budget ? `Sforato di ${grandTotal - budget} ${curr}` : `Rimangono ${budget - grandTotal} ${curr}`}</span>
              <span>{Math.round((grandTotal / budget) * 100)}% del budget</span>
            </div>
          </div>
        )}
      </div>

      {/* ---- BREAKDOWN CATEGORIE ---- */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px" }}>Per categoria</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(catTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: CAT_BG[cat], display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: CAT_COLORS[cat] }}>{CAT_LABELS[cat][0]}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ color: "#3C3B38" }}>{CAT_LABELS[cat]}</span>
                  <span style={{ color: "#5F5E5A", fontWeight: 500 }}>{amount} {curr}</span>
                </div>
                <div style={{ height: 5, background: "#EDEBE2", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: grandTotal > 0 ? `${(amount / grandTotal) * 100}%` : "0%", background: CAT_COLORS[cat], borderRadius: 999 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- SPESE FISSE ---- */}
      {fixedExpenses.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>Spese fisse pre-viaggio</p>
            <p style={{ fontSize: 12, fontWeight: 500, color: "#8A4B1E", margin: 0 }}>{fixedTotal} {curr}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {fixedExpenses.map((e, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #E3E1D8", borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: CAT_COLORS[e.cat] || "#888780", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "#2C2C2A" }}>{e.label}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#8A4B1E" }}>{e.amount} {curr}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- SPESE GIORNALIERE ---- */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>Spese giornaliere</p>
          <p style={{ fontSize: 12, fontWeight: 500, color: "#8A4B1E", margin: 0 }}>{dailyTotal} {curr}</p>
        </div>

        {dayTotals.map((day, dIdx) => {
          const qi = quickInputs[day.date] || {};
          return (
            <div key={day.date} style={{ border: "1px solid #E3E1D8", borderRadius: 12, marginBottom: 12, overflow: "hidden", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: day.total > 0 ? "#FBFAF6" : "#fff", borderBottom: day.total > 0 ? "1px solid #F0EEE6" : "none" }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Giorno {dIdx + 1} · {formatDateShort(day.date)}</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: day.total > 0 ? "#8A4B1E" : "#B4B2A9", margin: 0 }}>{day.total > 0 ? `${day.total} ${curr}` : "—"}</p>
              </div>

              {(day.items.length > 0 || day.quickExpenses.length > 0) && (
                <div style={{ padding: "8px 14px 4px" }}>
                  {day.items.map((item) => {
                    const cat = item.type === "flight" || item.type === "transport" ? "transport" : item.type === "restaurant" ? "restaurant" : item.type === "tour" ? "tour" : "altro";
                    return (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6, marginBottom: 6, borderBottom: "1px solid #F0EEE6" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLORS[cat], flexShrink: 0 }} />
                          <span style={{ fontSize: 12.5, color: "#3C3B38" }}>{item.title}</span>
                          <span style={{ fontSize: 10.5, color: "#B4B2A9" }}>{item.time && item.time !== "--:--" ? item.time : ""}</span>
                        </div>
                        <span style={{ fontSize: 12.5, color: "#5F5E5A", fontWeight: 500 }}>{item.cost} {curr}</span>
                      </div>
                    );
                  })}
                  {day.quickExpenses.map((qe) => (
                    <div key={qe.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6, marginBottom: 6, borderBottom: "1px solid #F0EEE6" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLORS[qe.category] || "#888780", flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, color: "#3C3B38" }}>{qe.label}</span>
                        <span style={{ fontSize: 10, color: "#B4B2A9", background: "#F0EEE6", padding: "1px 5px", borderRadius: 4 }}>{CAT_LABELS[qe.category] || "Altro"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12.5, color: "#5F5E5A", fontWeight: 500 }}>{qe.amount} {curr}</span>
                        <button className="tp-btn" onClick={() => onDeleteQuickExpense(day.date, qe.id)} style={{ background: "transparent", color: "#D3D1C7", padding: 2 }}><X size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- INPUT SPESA RAPIDA ---- */}
              <div style={{ padding: "8px 14px 10px" }}>
                {qi.open ? (
                  <div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {QUICK_CATEGORIES.map((c) => (
                        <button key={c.key} className="tp-btn" onClick={() => setQuickInputs((prev) => ({ ...prev, [day.date]: { ...prev[day.date], category: c.key } }))} style={{ padding: "5px 10px", borderRadius: 999, fontSize: 11, border: qi.category === c.key ? `1.5px solid ${CAT_COLORS[c.key]}` : "1px solid #E3E1D8", background: qi.category === c.key ? CAT_BG[c.key] : "#fff", color: CAT_COLORS[c.key] || "#5F5E5A" }}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        className="tp-input"
                        style={{ flex: 2, fontSize: 13 }}
                        value={qi.label || ""}
                        onChange={(e) => setQuickInputs((prev) => ({ ...prev, [day.date]: { ...prev[day.date], label: e.target.value } }))}
                        placeholder="es. Gelato, Parcheggio..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && qi.label?.trim() && qi.amount) {
                            onAddQuickExpense(day.date, { label: qi.label.trim(), amount: Number(qi.amount), category: qi.category || "altro" });
                            setQuickInputs((prev) => ({ ...prev, [day.date]: { label: "", amount: "", category: "altro", open: true } }));
                          }
                        }}
                      />
                      <input
                        className="tp-input"
                        style={{ flex: 1, fontSize: 13 }}
                        type="number"
                        min="0"
                        value={qi.amount || ""}
                        onChange={(e) => setQuickInputs((prev) => ({ ...prev, [day.date]: { ...prev[day.date], amount: e.target.value } }))}
                        placeholder={curr}
                      />
                      <button
                        className="tp-btn"
                        disabled={!qi.label?.trim() || !qi.amount}
                        onClick={() => {
                          if (!qi.label?.trim() || !qi.amount) return;
                          onAddQuickExpense(day.date, { label: qi.label.trim(), amount: Number(qi.amount), category: qi.category || "altro" });
                          setQuickInputs((prev) => ({ ...prev, [day.date]: { label: "", amount: "", category: "altro", open: true } }));
                        }}
                        style={{ background: qi.label?.trim() && qi.amount ? "#D85A30" : "#E3E1D8", color: qi.label?.trim() && qi.amount ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "0 12px", fontSize: 13, flexShrink: 0 }}
                      >
                        +
                      </button>
                      <button className="tp-btn" onClick={() => setQuickInputs((prev) => ({ ...prev, [day.date]: { ...prev[day.date], open: false } }))} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}><X size={14} /></button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="tp-btn"
                    onClick={() => setQuickInputs((prev) => ({ ...prev, [day.date]: { label: "", amount: "", category: "altro", open: true } }))}
                    style={{ fontSize: 12, color: "#888780", background: "transparent", display: "flex", alignItems: "center", gap: 5, padding: 0 }}
                  >
                    <Plus size={12} /> Aggiungi spesa
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ============================================================
function ItineraryView({ trip, onBack, onViewMemories, onAddItem, onDeleteItem, onDeleteTrip, onAddPhotos, onSetAttachment, onUpdateJournal, onExportPdf, onEditTrip, onSetParticipantDocument, onViewExpenses, onAddStay, onDeleteStay, onAddLeg, onDeleteLeg, onReorderLegs, onEditJourney, onAddRental, onDeleteRental, onMoveItem }) {
  const fileInputs = useRef({});
  const attachInputs = useRef({});
  const docInputs = useRef({});
  const [movingItem, setMovingItem] = useState(null); // { date, itemId }
  const [mapOpenDay, setMapOpenDay] = useState(null); // date string
  const totalPhotos = trip.days.reduce((sum, d) => sum + d.photos.length, 0);
  const totalItems = trip.days.reduce((sum, d) => sum + d.items.length, 0);
  const totalCost = trip.days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + (Number(i.cost) || 0), 0), 0) + (trip.accommodations || []).reduce((s, a) => s + (Number(a.cost) || 0), 0) + (trip.legs || []).reduce((s, l) => s + (Number(l.accommodationCost) || 0), 0) + (Number(trip.outboundTransport?.cost) || 0) + (Number(trip.returnTransport?.cost) || 0) + (trip.rentals || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const participantObjs = (trip.participants || []).map((p) => (typeof p === "string" ? { name: p, document: null } : p));

  async function handleAttach(date, itemId, file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    onSetAttachment(date, itemId, { name: file.name, src: dataUrl });
  }

  return (
    <div style={{ padding: "24px 20px 32px" }} onClick={() => movingItem && setMovingItem(null)}>
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

      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px" }}>Viaggio di andata e ritorno</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[{ direction: "outboundTransport", label: "Andata" }, { direction: "returnTransport", label: "Ritorno" }].map(({ direction, label }) => {
            const data = trip[direction];
            const Icon = data ? (TRANSPORT_ICONS[data.mode] || Plane) : Plane;
            return (
              <div key={direction}>
                <button
                  className="tp-btn"
                  onClick={() => onEditJourney(direction)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, border: data ? "1px solid #E3E1D8" : "1px dashed #D3D1C7", borderRadius: 10, padding: "10px 12px", background: "#fff", textAlign: "left" }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: data ? "#FAECE7" : "#F0EEE6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={15} color={data ? "#712B13" : "#B4B2A9"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {data ? (
                      <>
                        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{label} · {data.title || TRANSPORT_MODES[data.mode] || "Trasporto"}</p>
                        <p style={{ fontSize: 11, color: "#5F5E5A", margin: "1px 0 0" }}>{buildItemSummary(data) || (data.time && data.time !== "--:--" ? data.time : "")}</p>
                      </>
                    ) : (
                      <p style={{ fontSize: 13, color: "#B4B2A9", margin: 0 }}>{label}: aggiungi dettagli volo/trasporto</p>
                    )}
                  </div>
                  <Pencil size={13} color="#888780" />
                </button>
                {data && (data.attachment || data.type === "flight") && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0 0 12px" }}>
                    {data.attachment && (
                      <a href={data.attachment.src} download={data.attachment.name} onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "3px 8px", borderRadius: 999 }}>
                        <FileText size={10} /> Documento
                      </a>
                    )}
                    {data.type === "flight" && (
                      <a href="https://turbli.com/" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5F5E5A", textDecoration: "none", background: "#F0EEE6", padding: "3px 8px", borderRadius: 999 }}>
                        <Wind size={10} /> Turbolenze
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>Tappe del viaggio</p>
          <button className="tp-btn" onClick={() => onAddLeg()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#0C447C", background: "transparent", padding: 0 }}>
            <Plus size={12} /> Aggiungi tappa
          </button>
        </div>
        {(trip.legs || []).length === 0 ? (
          <p style={{ fontSize: 12, color: "#B4B2A9", margin: 0 }}>Nessuna tappa definita. Dividi il viaggio in zone (es. Palermo, San Vito Lo Capo) per tracciare dove dormi e cosa fai in ognuna.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...(trip.legs || [])].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((leg, idx, sortedLegs) => (
              <div key={leg.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #D7E3EE", background: "#F3F8FC", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button className="tp-btn" disabled={idx === 0} onClick={() => onReorderLegs(trip.legs.findIndex((l) => l.id === leg.id), trip.legs.findIndex((l) => l.id === leg.id) - 1)} style={{ background: "transparent", color: idx === 0 ? "#D3D1C7" : "#5F5E5A", padding: 0, lineHeight: 0.6 }}>▲</button>
                    <button className="tp-btn" disabled={idx === sortedLegs.length - 1} onClick={() => onReorderLegs(trip.legs.findIndex((l) => l.id === leg.id), trip.legs.findIndex((l) => l.id === leg.id) + 1)} style={{ background: "transparent", color: idx === sortedLegs.length - 1 ? "#D3D1C7" : "#5F5E5A", padding: 0, lineHeight: 0.6 }}>▼</button>
                  </div>
                  <MapPin size={14} color="#0C447C" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#0C447C" }}>{leg.name}</p>
                    <p style={{ fontSize: 11, color: "#5F5E5A", margin: "1px 0 0" }}>
                      {formatDateShort(leg.startDate)} → {formatDateShort(leg.endDate)}
                      {leg.accommodationName ? ` · 🛏 ${leg.accommodationName}` : ""}
                      {leg.accommodationCost ? ` · ${leg.accommodationCost} ${trip.currency || "CHF"}` : ""}
                    </p>
                  </div>
                  <button className="tp-btn" onClick={() => onAddLeg(leg)} style={{ background: "transparent", color: "#5F5E5A", padding: 4 }}>
                    <Pencil size={13} />
                  </button>
                  <button className="tp-btn" onClick={() => onDeleteLeg(leg.id)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
                    <X size={14} />
                  </button>
                </div>
                {(leg.accommodationAddress || leg.accommodationLink || leg.accommodationAttachment) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0 0 16px" }}>
                    {leg.accommodationAddress && (
                      <a href={buildMapsUrl([leg.accommodationAddress])} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#27500A", textDecoration: "none", background: "#EAF3DE", padding: "3px 8px", borderRadius: 999 }}>
                        <MapIcon size={10} /> Mappa
                      </a>
                    )}
                    {leg.accommodationLink && (
                      <a href={leg.accommodationLink} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "3px 8px", borderRadius: 999 }}>
                        <ExternalLink size={10} /> Prenotazione
                      </a>
                    )}
                    {leg.accommodationAttachment && (
                      <a href={leg.accommodationAttachment.src} download={leg.accommodationAttachment.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#712B13", textDecoration: "none", background: "#FAECE7", padding: "3px 8px", borderRadius: 999 }}>
                        <FileText size={10} /> Documento
                      </a>
                    )}
                  </div>
                )}
                {idx < sortedLegs.length - 1 && (() => {
                  const TransferIcon = TRANSPORT_ICONS[leg.transferMode] || Car;
                  const transferLabel = leg.transferMode ? TRANSPORT_MODES[leg.transferMode] : (leg.transferNote || `Trasferimento verso ${sortedLegs[idx + 1].name}`);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0 6px 16px", fontSize: 11, color: "#888780" }}>
                      <TransferIcon size={11} />
                      {transferLabel}{leg.transferDetails ? ` · ${leg.transferDetails}` : ""}
                      {leg.transferDuration ? ` · ~${leg.transferDuration}` : ""}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>Noleggi</p>
          <button className="tp-btn" onClick={() => onAddRental()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#4A2E8C", background: "transparent", padding: 0 }}>
            <Plus size={12} /> Aggiungi noleggio
          </button>
        </div>
        {(trip.rentals || []).length === 0 ? (
          <p style={{ fontSize: 12, color: "#B4B2A9", margin: 0 }}>Nessun noleggio. Aggiungi auto, scooter o altro mezzo a noleggio per il viaggio.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...(trip.rentals || [])].sort((a, b) => a.pickupDate.localeCompare(b.pickupDate)).map((rental) => {
              const RentalIcon = RENTAL_VEHICLE_ICONS[rental.vehicleType] || Car;
              return (
                <div key={rental.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #E3DCF2", background: "#F8F5FC", borderRadius: 10, padding: "10px 12px" }}>
                    <RentalIcon size={14} color="#4A2E8C" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#4A2E8C" }}>{rental.name}</p>
                      <p style={{ fontSize: 11, color: "#5F5E5A", margin: "1px 0 0" }}>
                        Ritiro {formatDateShort(rental.pickupDate)}{rental.pickupTime ? ` ${rental.pickupTime}` : ""}{rental.pickupLocation ? ` (${rental.pickupLocation})` : ""} → Consegna {formatDateShort(rental.dropoffDate)}{rental.dropoffTime ? ` ${rental.dropoffTime}` : ""}{rental.dropoffLocation ? ` (${rental.dropoffLocation})` : ""}
                        {rental.cost ? ` · ${rental.cost} ${trip.currency || "CHF"}` : ""}
                      </p>
                    </div>
                    <button className="tp-btn" onClick={() => onAddRental(rental)} style={{ background: "transparent", color: "#5F5E5A", padding: 4 }}>
                      <Pencil size={13} />
                    </button>
                    <button className="tp-btn" onClick={() => onDeleteRental(rental.id)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
                      <X size={14} />
                    </button>
                  </div>
                  {(rental.link || rental.attachment) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0 0 12px" }}>
                      {rental.link && (
                        <a href={rental.link} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "3px 8px", borderRadius: 999 }}>
                          <ExternalLink size={10} /> Prenotazione
                        </a>
                      )}
                      {rental.attachment && (
                        <a href={rental.attachment.src} download={rental.attachment.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#712B13", textDecoration: "none", background: "#FAECE7", padding: "3px 8px", borderRadius: 999 }}>
                          <FileText size={10} /> Documento
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>Soggiorni senza tappa</p>
          <button className="tp-btn" onClick={() => onAddStay()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#0C447C", background: "transparent", padding: 0 }}>
            <Plus size={12} /> Aggiungi
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#B4B2A9", margin: "0 0 8px" }}>Usa questo solo se non vuoi creare una tappa intera, ad esempio per un singolo pernottamento extra.</p>
        {(trip.accommodations || []).length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...(trip.accommodations || [])].sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map((stay) => (
              <div key={stay.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #D7E3EE", background: "#F3F8FC", borderRadius: 10, padding: "9px 12px" }}>
                <Bed size={14} color="#0C447C" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#0C447C" }}>{stay.name}</p>
                  <p style={{ fontSize: 11, color: "#5F5E5A", margin: "1px 0 0" }}>
                    {formatDateShort(stay.checkIn)} → {formatDateShort(stay.checkOut)}{stay.location ? ` · ${stay.location}` : ""}{stay.cost ? ` · ${stay.cost} ${trip.currency || "CHF"}` : ""}
                  </p>
                </div>
                <button className="tp-btn" onClick={() => onAddStay(stay)} style={{ background: "transparent", color: "#5F5E5A", padding: 4 }}>
                  <Pencil size={13} />
                </button>
                <button className="tp-btn" onClick={() => onDeleteStay(stay.id)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
            .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
            .flatMap((i) => {
              // Se è un tour con tappe interne, usa quelle per la mappa
              if (i.type === "tour" && i.tourStops && i.tourStops.length) {
                return i.tourStops.filter((s) => s.location && s.location.trim()).map((s) => s.location.trim());
              }
              // Altrimenti usa il luogo dell'attività stessa
              return i.location && i.location.trim() ? [i.location.trim()] : [];
            });
          const mapsUrl = buildMapsUrl(stops);
          const activeLeg = (trip.legs || []).find((l) => day.date >= l.startDate && day.date <= l.endDate);
          const activeStay = (trip.accommodations || []).find((a) => day.date >= a.checkIn && day.date <= a.checkOut);
          const activeRental = (trip.rentals || []).find((r) => day.date >= r.pickupDate && day.date <= r.dropoffDate);
          const weatherLocation = stops[0] || activeLeg?.accommodationAddress || activeLeg?.location || activeLeg?.name || activeStay?.location || activeStay?.name || trip.name;
          return (
          <div key={day.date} style={{ position: "relative", marginBottom: 22 }}>
            <div style={{ position: "absolute", left: -28, top: 2, width: 13, height: 13, borderRadius: "50%", background: day.items.length > 0 ? "#993C1D" : "#D3D1C7", border: "2px solid #FBFAF6" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "#5F5E5A", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Giorno {dIdx + 1} · {formatDateShort(day.date)}
              </p>
              {dayCost > 0 && <p style={{ fontSize: 11, color: "#8A4B1E", margin: 0 }}>{dayCost} {trip.currency || "CHF"}</p>}
            </div>

            <DayWeather location={weatherLocation} dateStr={day.date} />

            {activeLeg ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#0C447C", background: "#F3F8FC", border: "1px solid #D7E3EE", borderRadius: 8, padding: "6px 10px", marginBottom: 6, flexWrap: "wrap" }}>
                <MapPin size={12} /> {activeLeg.name}
                {activeLeg.accommodationName && <span>· 🛏 {activeLeg.accommodationName}</span>}
              </div>
            ) : activeStay ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#0C447C", background: "#F3F8FC", border: "1px solid #D7E3EE", borderRadius: 8, padding: "6px 10px", marginBottom: 6 }}>
                <Bed size={12} /> {activeStay.name}
              </div>
            ) : null}

            {activeRental && (() => {
              const RentalIcon = RENTAL_VEHICLE_ICONS[activeRental.vehicleType] || Car;
              const vehicleLabel = rentalVehicleLabel(activeRental.vehicleType);
              const isPickupDay = day.date === activeRental.pickupDate;
              const isDropoffDay = day.date === activeRental.dropoffDate;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4A2E8C", background: "#F8F5FC", border: "1px solid #E3DCF2", borderRadius: 8, padding: "6px 10px", marginBottom: 10, flexWrap: "wrap" }}>
                  <RentalIcon size={12} />
                  <span>{activeRental.name} · {vehicleLabel}</span>
                  {isPickupDay && activeRental.pickupTime && <span>· ritiro {activeRental.pickupTime}</span>}
                  {isDropoffDay && activeRental.dropoffTime && <span>· consegna {activeRental.dropoffTime}</span>}
                </div>
              );
            })()}

            {day.date === trip.startDate && trip.outboundTransport && (() => {
              const t = trip.outboundTransport;
              const Icon = t.type === "flight" ? Plane : (TRANSPORT_ICONS[t.transportMode] || Car);
              const summary = buildItemSummary(t);
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#712B13", background: "#FAECE7", border: "1px solid #F0D9C5", borderRadius: 8, padding: "8px 10px", marginBottom: 10, flexWrap: "wrap" }}>
                  <Icon size={13} />
                  <span style={{ fontWeight: 500 }}>Arrivo: {t.title}</span>
                  {t.time && t.time !== "--:--" && <span>· {t.time}</span>}
                  {summary && <span>· {summary}</span>}
                </div>
              );
            })()}

            {day.date === trip.endDate && trip.returnTransport && (() => {
              const t = trip.returnTransport;
              const Icon = t.type === "flight" ? Plane : (TRANSPORT_ICONS[t.transportMode] || Car);
              const summary = buildItemSummary(t);
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#712B13", background: "#FAECE7", border: "1px solid #F0D9C5", borderRadius: 8, padding: "8px 10px", marginBottom: 10, flexWrap: "wrap" }}>
                  <Icon size={13} />
                  <span style={{ fontWeight: 500 }}>Partenza: {t.title}</span>
                  {t.time && t.time !== "--:--" && <span>· {t.time}</span>}
                  {summary && <span>· {summary}</span>}
                </div>
              );
            })()}

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
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        className="tp-btn"
                        title="Sposta in un altro giorno"
                        onClick={() => setMovingItem(movingItem?.itemId === item.id ? null : { date: day.date, itemId: item.id })}
                        style={{ background: movingItem?.itemId === item.id ? "#F0EEE6" : "transparent", color: "#B4B2A9", padding: 4, borderRadius: 6 }}
                      >
                        <ArrowLeft size={13} style={{ transform: "rotate(270deg)" }} />
                      </button>
                      {movingItem?.itemId === item.id && (
                        <div style={{ position: "absolute", right: 0, top: 24, background: "#fff", border: "1px solid #E3E1D8", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                          <p style={{ fontSize: 11, color: "#888780", fontWeight: 500, padding: "8px 12px 4px", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>Sposta nel giorno</p>
                          {trip.days.filter((d) => d.date !== day.date).map((d, dIdx) => (
                            <button
                              key={d.date}
                              className="tp-btn"
                              onClick={() => { onMoveItem(day.date, d.date, item.id); setMovingItem(null); }}
                              style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12.5, color: "#2C2C2A", background: "transparent", display: "block", borderTop: "1px solid #F0EEE6" }}
                            >
                              Giorno {trip.days.indexOf(d) + 1} · {formatDateShort(d.date)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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
                    {item.type === "restaurant" && item.restaurantLink && (
                      <a href={item.restaurantLink} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#72243E", textDecoration: "none", background: "#FBEAF0", padding: "4px 9px", borderRadius: 999 }}>
                        <ExternalLink size={11} /> TripAdvisor
                      </a>
                    )}
                    {item.location && item.location.trim() && (
                      <a href={buildNavigateUrl(item.location)} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#27500A", textDecoration: "none", background: "#EAF3DE", padding: "4px 9px", borderRadius: 999 }}>
                        <MapPin size={11} /> Naviga
                      </a>
                    )}
                    {item.type === "tour" && item.tourStops && item.tourStops.some((s) => s.location) && (
                      <a href={buildMapsUrl(item.tourStops.filter((s) => s.location.trim()).map((s) => s.location.trim()))} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#27500A", textDecoration: "none", background: "#EAF3DE", padding: "4px 9px", borderRadius: 999 }}>
                        <MapIcon size={11} /> Tappe sulla mappa
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {stops.length > 0 && (
              <button
                className="tp-btn"
                onClick={() => setMapOpenDay(mapOpenDay === day.date ? null : day.date)}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#27500A", background: "#EAF3DE", border: "1px solid #D7E8C4", borderRadius: 10, padding: "9px 12px", marginTop: 4, marginBottom: 4, width: "100%", textAlign: "left" }}
              >
                <MapIcon size={14} />
                {mapOpenDay === day.date ? "Chiudi mappa" : `Vedi ${stops.length} ${stops.length === 1 ? "posto" : "posti"} sulla mappa`}
              </button>
            )}

            {mapOpenDay === day.date && stops.length > 0 && (
              <DayMap
                stops={day.items
                  .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
                  .flatMap((i) => {
                    if (i.type === "tour" && i.tourStops?.length) {
                      return i.tourStops.filter((s) => s.location?.trim()).map((s) => ({ name: s.name, location: s.location }));
                    }
                    return i.location?.trim() ? [{ name: i.title, location: i.location }] : [];
                  })}
                onClose={() => setMapOpenDay(null)}
              />
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

// ============================================================
function StayModal({ trip, editingStay, onClose, onAdd, onUpdate }) {
  const isEditing = !!editingStay;
  const s = editingStay || {};
  const [name, setName] = useState(s.name || "");
  const [location, setLocation] = useState(s.location || "");
  const [checkIn, setCheckIn] = useState(s.checkIn || trip.startDate);
  const [checkOut, setCheckOut] = useState(s.checkOut || trip.endDate);
  const [cost, setCost] = useState(s.cost ? String(s.cost) : "");
  const [confirmationCode, setConfirmationCode] = useState(s.confirmationCode || "");
  const curr = trip.currency || "CHF";

  const valid = name.trim() && checkIn && checkOut && checkOut >= checkIn;

  function handleSubmit() {
    if (!valid) return;
    const payload = { name: name.trim(), location: location.trim(), checkIn, checkOut, cost: cost ? Number(cost) : 0, confirmationCode: confirmationCode.trim() };
    if (isEditing) onUpdate(payload);
    else onAdd(payload);
  }

  return (
    <ModalShell onClose={onClose} title={isEditing ? "Modifica soggiorno" : "Aggiungi soggiorno"}>
      <label className="tp-label">Nome struttura</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Airbnb Centro Palermo" autoFocus />

      <label className="tp-label">Indirizzo / luogo</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="opzionale" />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Check-in</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Check-out</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#888780", margin: "-9px 0 14px" }}>Questo soggiorno coprirà tutti i giorni dell'itinerario in questo intervallo</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Costo totale ({curr})</label>
          <input className="tp-input" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opzionale" />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Codice prenotazione</label>
          <input className="tp-input" value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)} placeholder="opzionale" />
        </div>
      </div>

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={handleSubmit}
        style={{ width: "100%", background: valid ? "#0C447C" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        {isEditing ? "Salva modifiche" : "Aggiungi soggiorno"}
      </button>
    </ModalShell>
  );
}

// ============================================================
function LegModal({ trip, editingLeg, onClose, onAdd, onUpdate }) {
  const isEditing = !!editingLeg;
  const l = editingLeg || {};
  const [name, setName] = useState(l.name || "");
  const [location, setLocation] = useState(l.location || "");
  const [startDate, setStartDate] = useState(l.startDate || trip.startDate);
  const [endDate, setEndDate] = useState(l.endDate || trip.endDate);
  const [accommodationName, setAccommodationName] = useState(l.accommodationName || "");
  const [accommodationAddress, setAccommodationAddress] = useState(l.accommodationAddress || "");
  const [accommodationCost, setAccommodationCost] = useState(l.accommodationCost ? String(l.accommodationCost) : "");
  const [accommodationLink, setAccommodationLink] = useState(l.accommodationLink || "");
  const [accommodationAttachment, setAccommodationAttachment] = useState(l.accommodationAttachment || null);
  const [transferMode, setTransferMode] = useState(l.transferMode || "");
  const [transferNote, setTransferNote] = useState(l.transferNote || "");
  const [transferDetails, setTransferDetails] = useState(l.transferDetails || "");
  const [transferDuration, setTransferDuration] = useState(l.transferDuration || "");
  const fileInputRef = useRef(null);
  const curr = trip.currency || "CHF";

  const valid = name.trim() && startDate && endDate && endDate >= startDate;

  async function handleAttachFile(file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setAccommodationAttachment({ name: file.name, src: dataUrl });
  }

  function handleSubmit() {
    if (!valid) return;
    const payload = {
      name: name.trim(), location: location.trim(), startDate, endDate,
      accommodationName: accommodationName.trim(), accommodationAddress: accommodationAddress.trim(),
      accommodationCost: accommodationCost ? Number(accommodationCost) : 0,
      accommodationLink: accommodationLink.trim(), accommodationAttachment,
      transferMode, transferNote: transferNote.trim(), transferDetails: transferDetails.trim(), transferDuration: transferDuration.trim()
    };
    if (isEditing) onUpdate(payload);
    else onAdd(payload);
  }

  return (
    <ModalShell onClose={onClose} title={isEditing ? "Modifica tappa" : "Aggiungi tappa"}>
      <label className="tp-label">Nome tappa</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Palermo" autoFocus />

      <label className="tp-label">Zona (per meteo e mappa generale)</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="es. Palermo, Sicilia" />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Dal</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Al</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div style={{ borderTop: "1px solid #E3E1D8", margin: "4px 0 16px" }} />

      <label className="tp-label">Alloggio in questa tappa</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={accommodationName} onChange={(e) => setAccommodationName(e.target.value)} placeholder="es. Airbnb Centro Palermo" />

      <label className="tp-label">Indirizzo esatto dell'alloggio</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={accommodationAddress} onChange={(e) => setAccommodationAddress(e.target.value)} placeholder="es. Via Roma 45, Palermo" />
      <p style={{ fontSize: 11, color: "#888780", margin: "-9px 0 14px" }}>Usato per puntare la mappa e il meteo esattamente qui invece che sulla zona generale</p>

      <label className="tp-label">Costo alloggio ({curr})</label>
      <input className="tp-input" style={{ marginBottom: 14 }} type="number" min="0" value={accommodationCost} onChange={(e) => setAccommodationCost(e.target.value)} placeholder="opzionale" />

      <label className="tp-label">Link prenotazione (Airbnb, Booking…)</label>
      <input className="tp-input" style={{ marginBottom: 14 }} type="url" value={accommodationLink} onChange={(e) => setAccommodationLink(e.target.value)} placeholder="https://airbnb.com/..." />

      <label className="tp-label">Allega prenotazione</label>
      {accommodationAttachment ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <a href={accommodationAttachment.src} download={accommodationAttachment.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "6px 10px", borderRadius: 999, flex: 1, minWidth: 0 }}>
            <FileText size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accommodationAttachment.name}</span>
          </a>
          <button className="tp-btn" onClick={() => setAccommodationAttachment(null)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button className="tp-btn" onClick={() => fileInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5F5E5A", background: "transparent", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "9px 12px", marginBottom: 14 }}>
          <Paperclip size={13} /> Carica PDF o immagine
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => { handleAttachFile(e.target.files[0]); e.target.value = ""; }}
      />

      <div style={{ borderTop: "1px solid #E3E1D8", margin: "4px 0 16px" }} />

      <label className="tp-label">Trasferimento verso la tappa successiva</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.entries(TRANSPORT_MODES).map(([key, label]) => (
          <button
            key={key}
            className="tp-btn"
            onClick={() => setTransferMode(transferMode === key ? "" : key)}
            style={{ padding: "7px 12px", borderRadius: 999, border: transferMode === key ? "1.5px solid #0C447C" : "1px solid #E3E1D8", background: transferMode === key ? "#E6F1FB" : "#fff", color: "#0C447C", fontSize: 12 }}
          >
            {label}
          </button>
        ))}
      </div>
      <input className="tp-input" style={{ marginBottom: 8 }} value={transferDetails} onChange={(e) => setTransferDetails(e.target.value)} placeholder="dettagli (es. compagnia, numero corsa)" />
      <input className="tp-input" style={{ marginBottom: 14 }} value={transferDuration} onChange={(e) => setTransferDuration(e.target.value)} placeholder="durata stimata, es. 1h 30min" />

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={handleSubmit}
        style={{ width: "100%", background: valid ? "#0C447C" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        {isEditing ? "Salva modifiche" : "Aggiungi tappa"}
      </button>
    </ModalShell>
  );
}

// ============================================================
function JourneyModal({ trip, direction, existingData, onClose, onSave }) {
  const d = existingData || {};
  const isReturn = direction === "returnTransport";
  const [mode, setMode] = useState(d.mode || "aereo");
  const [title, setTitle] = useState(d.title || "");
  const [time, setTime] = useState(d.time && d.time !== "--:--" ? d.time : "");
  const [cost, setCost] = useState(d.cost ? String(d.cost) : "");
  const [departureAirport, setDepartureAirport] = useState(d.departureAirport || "");
  const [arrivalAirport, setArrivalAirport] = useState(d.arrivalAirport || "");
  const [arrivalTime, setArrivalTime] = useState(d.arrivalTime || "");
  const [flightNumber, setFlightNumber] = useState(d.flightNumber || "");
  const [terminal, setTerminal] = useState(d.terminal || "");
  const [passengers, setPassengers] = useState(d.passengers && d.passengers.length ? d.passengers : [{ name: "", seat: "" }]);
  const [baggage, setBaggage] = useState(d.baggage ? (Array.isArray(d.baggage) ? d.baggage : [d.baggage]) : []);
  const [fromPlace, setFromPlace] = useState(d.fromPlace || "");
  const [toPlace, setToPlace] = useState(d.toPlace || "");
  const [note, setNote] = useState(d.note || "");
  const [attachment, setAttachment] = useState(d.attachment || null);
  const fileInputRef = useRef(null);
  const curr = trip.currency || "CHF";

  const valid = title.trim();
  const isFlight = mode === "aereo";

  async function handleAttachFile(file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setAttachment({ name: file.name, src: dataUrl });
  }

  function updatePassenger(idx, field, value) {
    setPassengers(passengers.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }
  function addPassengerRow() { setPassengers([...passengers, { name: "", seat: "" }]); }
  function removePassengerRow(idx) { setPassengers(passengers.length > 1 ? passengers.filter((_, i) => i !== idx) : passengers); }

  function handleSubmit() {
    if (!valid) return;
    onSave({
      type: isFlight ? "flight" : "transport", mode, title: title.trim(), time: time || "--:--",
      cost: cost ? Number(cost) : 0, note: note.trim(), attachment,
      departureAirport: departureAirport.trim(), arrivalAirport: arrivalAirport.trim(), arrivalTime,
      flightNumber: flightNumber.trim(), terminal: terminal.trim(),
      passengers: passengers.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), seat: p.seat.trim() })),
      baggage,
      transportMode: !isFlight ? mode : "", fromPlace: fromPlace.trim(), toPlace: toPlace.trim()
    });
  }

  return (
    <ModalShell onClose={onClose} title={isReturn ? "Viaggio di ritorno" : "Viaggio di andata"}>
      <label className="tp-label">Mezzo</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {Object.entries(TRANSPORT_MODES).map(([key, label]) => (
          <button key={key} className="tp-btn" onClick={() => setMode(key)} style={{ padding: "7px 12px", borderRadius: 999, border: mode === key ? "1.5px solid #712B13" : "1px solid #E3E1D8", background: mode === key ? "#FAECE7" : "#fff", color: "#712B13", fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>

      <label className="tp-label">Titolo</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isFlight ? "es. Volo Zurigo → Palermo" : "es. Treno Roma → Palermo"} autoFocus />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Orario partenza</label>
          <input className="tp-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Costo ({curr})</label>
          <input className="tp-input" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opzionale" />
        </div>
      </div>

      {isFlight ? (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Da</label>
              <input className="tp-input" value={departureAirport} onChange={(e) => setDepartureAirport(e.target.value)} placeholder="es. Zurigo ZRH" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">A</label>
              <input className="tp-input" value={arrivalAirport} onChange={(e) => setArrivalAirport(e.target.value)} placeholder="es. Palermo PMO" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Orario arrivo</label>
              <input className="tp-input" type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Numero volo</label>
              <input className="tp-input" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} placeholder="es. EJU3511" />
            </div>
          </div>
          <label className="tp-label">Terminal</label>
          <input className="tp-input" style={{ marginBottom: 14 }} value={terminal} onChange={(e) => setTerminal(e.target.value)} placeholder="opzionale" />

          <label className="tp-label">Passeggeri e posti</label>
          {passengers.map((p, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="tp-input" style={{ flex: 2 }} value={p.name} onChange={(ev) => updatePassenger(idx, "name", ev.target.value)} placeholder="es. Stefano" />
              <input className="tp-input" style={{ flex: 1 }} value={p.seat} onChange={(ev) => updatePassenger(idx, "seat", ev.target.value)} placeholder="posto" />
              <button className="tp-btn" onClick={() => removePassengerRow(idx)} style={{ background: "transparent", color: "#B4B2A9", padding: "0 6px" }}><X size={15} /></button>
            </div>
          ))}
          <button className="tp-btn" onClick={addPassengerRow} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#888780", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "7px 12px", fontSize: 12, marginBottom: 14 }}>
            <Plus size={12} /> Aggiungi passeggero
          </button>

          <label className="tp-label">Bagaglio</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ v: "mano", l: "A mano" }, { v: "stiva", l: "In stiva" }].map((opt) => {
              const active = baggage.includes(opt.v);
              return (
                <button key={opt.v} className="tp-btn" onClick={() => setBaggage(active ? baggage.filter((b) => b !== opt.v) : [...baggage, opt.v])} style={{ flex: 1, padding: "9px", borderRadius: 8, border: active ? "1.5px solid #712B13" : "1px solid #E3E1D8", background: active ? "#FAECE7" : "#fff", color: "#712B13", fontSize: 12.5 }}>
                  {active ? "✓ " : ""}{opt.l}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label className="tp-label">Da</label>
            <input className="tp-input" value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} placeholder="es. Roma" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="tp-label">A</label>
            <input className="tp-input" value={toPlace} onChange={(e) => setToPlace(e.target.value)} placeholder="es. Palermo" />
          </div>
        </div>
      )}

      <label className="tp-label">Note</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="opzionale" />

      <label className="tp-label">Allega prenotazione</label>
      {attachment ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <a href={attachment.src} download={attachment.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "6px 10px", borderRadius: 999, flex: 1, minWidth: 0 }}>
            <FileText size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
          </a>
          <button className="tp-btn" onClick={() => setAttachment(null)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button className="tp-btn" onClick={() => fileInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5F5E5A", background: "transparent", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "9px 12px", marginBottom: 14 }}>
          <Paperclip size={13} /> Carica PDF o immagine
        </button>
      )}
      <input ref={fileInputRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { handleAttachFile(e.target.files[0]); e.target.value = ""; }} />

      {isFlight && (
        <a href="https://turbli.com/" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5F5E5A", textDecoration: "none", background: "#F0EEE6", padding: "8px 12px", borderRadius: 8, marginBottom: 18 }}>
          <Wind size={13} /> Controlla turbolenze su Turbli <ExternalLink size={11} />
        </a>
      )}
      {!isFlight && <div style={{ marginBottom: 18 }} />}

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={handleSubmit}
        style={{ width: "100%", background: valid ? "#D85A30" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        Salva
      </button>
    </ModalShell>
  );
}

// ============================================================
function RentalModal({ trip, editingRental, onClose, onAdd, onUpdate }) {
  const isEditing = !!editingRental;
  const r = editingRental || {};
  const [name, setName] = useState(r.name || "");
  const [vehicleType, setVehicleType] = useState(r.vehicleType || "auto");
  const [pickupDate, setPickupDate] = useState(r.pickupDate || trip.startDate);
  const [pickupTime, setPickupTime] = useState(r.pickupTime || "");
  const [pickupLocation, setPickupLocation] = useState(r.pickupLocation || "");
  const [dropoffDate, setDropoffDate] = useState(r.dropoffDate || trip.endDate);
  const [dropoffTime, setDropoffTime] = useState(r.dropoffTime || "");
  const [dropoffLocation, setDropoffLocation] = useState(r.dropoffLocation || "");
  const [cost, setCost] = useState(r.cost ? String(r.cost) : "");
  const [link, setLink] = useState(r.link || "");
  const [attachment, setAttachment] = useState(r.attachment || null);
  const fileInputRef = useRef(null);
  const curr = trip.currency || "CHF";

  const valid = name.trim() && pickupDate && dropoffDate && dropoffDate >= pickupDate;

  async function handleAttachFile(file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setAttachment({ name: file.name, src: dataUrl });
  }

  function handleSubmit() {
    if (!valid) return;
    const payload = {
      name: name.trim(), vehicleType, pickupDate, pickupTime, pickupLocation: pickupLocation.trim(),
      dropoffDate, dropoffTime, dropoffLocation: dropoffLocation.trim(), cost: cost ? Number(cost) : 0,
      link: link.trim(), attachment
    };
    if (isEditing) onUpdate(payload);
    else onAdd(payload);
  }

  return (
    <ModalShell onClose={onClose} title={isEditing ? "Modifica noleggio" : "Aggiungi noleggio"}>
      <label className="tp-label">Mezzo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {Object.entries(RENTAL_VEHICLE_TYPES).map(([key, label]) => (
          <button key={key} className="tp-btn" onClick={() => setVehicleType(key)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: vehicleType === key ? "1.5px solid #4A2E8C" : "1px solid #E3E1D8", background: vehicleType === key ? "#EFEAF7" : "#fff", color: "#4A2E8C", fontSize: 12.5 }}>
            {label}
          </button>
        ))}
      </div>

      <label className="tp-label">Nome / agenzia</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Auto a noleggio Hertz" autoFocus />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data ritiro</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Ora ritiro</label>
          <input className="tp-input" type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
        </div>
      </div>
      <label className="tp-label">Luogo ritiro</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="es. Palermo" />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Data consegna</label>
          <input className="tp-input" type="date" min={trip.startDate} max={trip.endDate} value={dropoffDate} onChange={(e) => setDropoffDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="tp-label">Ora consegna</label>
          <input className="tp-input" type="time" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} />
        </div>
      </div>
      <label className="tp-label">Luogo consegna</label>
      <input className="tp-input" style={{ marginBottom: 14 }} value={dropoffLocation} onChange={(e) => setDropoffLocation(e.target.value)} placeholder="es. Trapani" />

      <label className="tp-label">Costo totale ({curr})</label>
      <input className="tp-input" style={{ marginBottom: 14 }} type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opzionale" />

      <label className="tp-label">Link prenotazione</label>
      <input className="tp-input" style={{ marginBottom: 14 }} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />

      <label className="tp-label">Allega contratto/documento</label>
      {attachment ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <a href={attachment.src} download={attachment.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#4A2E8C", textDecoration: "none", background: "#EFEAF7", padding: "6px 10px", borderRadius: 999, flex: 1, minWidth: 0 }}>
            <FileText size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
          </a>
          <button className="tp-btn" onClick={() => setAttachment(null)} style={{ background: "transparent", color: "#B4B2A9", padding: 4 }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button className="tp-btn" onClick={() => fileInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5F5E5A", background: "transparent", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "9px 12px", marginBottom: 18 }}>
          <Paperclip size={13} /> Carica PDF o immagine
        </button>
      )}
      <input ref={fileInputRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { handleAttachFile(e.target.files[0]); e.target.value = ""; }} />

      <button
        className="tp-btn"
        disabled={!valid}
        onClick={handleSubmit}
        style={{ width: "100%", background: valid ? "#4A2E8C" : "#E3E1D8", color: valid ? "#fff" : "#B4B2A9", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}
      >
        {isEditing ? "Salva modifiche" : "Aggiungi noleggio"}
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
  const [restaurantLink, setRestaurantLink] = useState(e.restaurantLink || "");

  // campi tour
  const [duration, setDuration] = useState(e.duration || "");
  const [meetingPoint, setMeetingPoint] = useState(e.meetingPoint || "");
  const [guided, setGuided] = useState(e.guided || "");
  const [tourStops, setTourStops] = useState(e.tourStops && e.tourStops.length ? e.tourStops : []);
  const [endTime, setEndTime] = useState(e.endTime || "");

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
      guests: guests ? Number(guests) : 0, cuisine: cuisine.trim(), restaurantLink: restaurantLink.trim(),
      duration: duration.trim(), meetingPoint: meetingPoint.trim(), guided,
      endTime: type === "tour" ? endTime : "",
      tourStops: tourStops.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), location: s.location.trim() })),
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
          <label className="tp-label">{type === "flight" ? "Orario partenza" : type === "hotel" ? "Check-in" : type === "tour" ? "Ora inizio" : "Orario"}</label>
          <input className="tp-input" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} />
        </div>
        {type === "tour" ? (
          <div style={{ flex: 1 }}>
            <label className="tp-label">Ora fine</label>
            <input className="tp-input" type="time" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} />
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <label className="tp-label">Costo ({curr})</label>
            <input className="tp-input" type="number" min="0" step="0.01" value={cost} onChange={(ev) => setCost(ev.target.value)} placeholder="opzionale" />
          </div>
        )}
      </div>

      {type === "tour" && (
        <div style={{ marginBottom: 14 }}>
          <label className="tp-label">Costo ({curr})</label>
          <input className="tp-input" type="number" min="0" step="0.01" value={cost} onChange={(ev) => setCost(ev.target.value)} placeholder="opzionale" />
        </div>
      )}

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
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Numero persone</label>
              <input className="tp-input" type="number" min="1" value={guests} onChange={(ev) => setGuests(ev.target.value)} placeholder="opzionale" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tp-label">Tipo di cucina</label>
              <input className="tp-input" value={cuisine} onChange={(ev) => setCuisine(ev.target.value)} placeholder="es. siciliana" />
            </div>
          </div>
          <label className="tp-label">Link (TripAdvisor, TheFork, prenotazione…)</label>
          <input className="tp-input" style={{ marginBottom: 14 }} type="url" value={restaurantLink} onChange={(ev) => setRestaurantLink(ev.target.value)} placeholder="https://..." />
        </>
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

          <label className="tp-label">Posti visitati</label>
          <p style={{ fontSize: 11, color: "#888780", margin: "-3px 0 8px" }}>Aggiungili per vederli sulla mappa del giorno in sequenza</p>
          {tourStops.map((stop, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                className="tp-input"
                style={{ flex: 2 }}
                value={stop.name}
                onChange={(ev) => setTourStops(tourStops.map((s, i) => i === idx ? { ...s, name: ev.target.value } : s))}
                placeholder={`Posto ${idx + 1} (es. Cattedrale)`}
              />
              <input
                className="tp-input"
                style={{ flex: 2 }}
                value={stop.location}
                onChange={(ev) => setTourStops(tourStops.map((s, i) => i === idx ? { ...s, location: ev.target.value } : s))}
                placeholder="Indirizzo (per mappa)"
              />
              <button className="tp-btn" onClick={() => setTourStops(tourStops.filter((_, i) => i !== idx))} style={{ background: "transparent", color: "#B4B2A9", padding: "0 6px", flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            className="tp-btn"
            onClick={() => setTourStops([...tourStops, { name: "", location: "" }])}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#888780", border: "1px dashed #D3D1C7", borderRadius: 8, padding: "7px 12px", fontSize: 12, marginBottom: 14 }}
          >
            <Plus size={12} /> Aggiungi posto
          </button>
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
