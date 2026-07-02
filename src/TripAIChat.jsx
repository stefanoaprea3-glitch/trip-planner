import React, { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Loader } from "lucide-react";

function buildTripContext(trip) {
  if (!trip) return "Nessun viaggio selezionato.";
  let ctx = `VIAGGIO: ${trip.name}\n`;
  ctx += `DATE: ${trip.startDate} → ${trip.endDate}\n`;
  ctx += `VALUTA: ${trip.currency || "EUR"}\n`;
  if (trip.participants?.length) {
    ctx += `PARTECIPANTI:\n`;
    trip.participants.forEach((p) => {
      const name = typeof p === "string" ? p : p.name;
      const doc = typeof p === "object" && p.document ? ` | Documento allegato: ${p.document.name}` : "";
      ctx += `- ${name}${doc}\n`;
    });
  }
  if (trip.outboundTransport?.title) {
    ctx += `\nANDATA: ${trip.outboundTransport.title}`;
    if (trip.outboundTransport.time) ctx += ` alle ${trip.outboundTransport.time}`;
    if (trip.outboundTransport.flightNumber) ctx += ` (${trip.outboundTransport.flightNumber})`;
    ctx += "\n";
  }
  if (trip.returnTransport?.title) {
    ctx += `RITORNO: ${trip.returnTransport.title}`;
    if (trip.returnTransport.time) ctx += ` alle ${trip.returnTransport.time}`;
    if (trip.returnTransport.flightNumber) ctx += ` (${trip.returnTransport.flightNumber})`;
    ctx += "\n";
  }
  if (trip.legs?.length) {
    ctx += `\nTAPPE:\n`;
    trip.legs.forEach((leg) => {
      ctx += `- ${leg.name} (${leg.startDate} → ${leg.endDate})`;
      if (leg.accommodationName) ctx += ` | Alloggio: ${leg.accommodationName}`;
      if (leg.accommodationAddress) ctx += ` | Indirizzo: ${leg.accommodationAddress}`;
      if (leg.accommodationCost) ctx += ` | Costo: ${leg.accommodationCost} ${trip.currency || "EUR"}`;
      ctx += "\n";
    });
  }
  if (trip.rentals?.length) {
    ctx += `\nNOLEGGI:\n`;
    const vehicleLabels = { auto: "Auto", scooter: "Scooter/Moto", bici: "Bici", altro: "Scooter/Moto" };
    trip.rentals.forEach((r) => {
      const vehicleLabel = vehicleLabels[r.vehicleType] || "Veicolo";
      ctx += `- ${r.name} (${vehicleLabel}): ritiro ${r.pickupDate}${r.pickupTime ? " " + r.pickupTime : ""}${r.pickupLocation ? " a " + r.pickupLocation : ""}`;
      ctx += `, consegna ${r.dropoffDate}${r.dropoffTime ? " " + r.dropoffTime : ""}${r.dropoffLocation ? " a " + r.dropoffLocation : ""}`;
      if (r.cost) ctx += ` | Costo: ${r.cost} ${trip.currency || "EUR"}`;
      ctx += "\n";
    });
  }
  if (trip.days?.length) {
    ctx += `\nITINERARIO:\n`;
    trip.days.forEach((day, idx) => {
      if (!day.items?.length && !day.quickExpenses?.length) return;
      ctx += `\nGiorno ${idx + 1} (${day.date}):\n`;
      day.items?.forEach((item) => {
        ctx += `  - [${item.type}] ${item.title}`;
        if (item.time && item.time !== "--:--") ctx += ` alle ${item.time}`;
        if (item.endTime) ctx += ` fino alle ${item.endTime}`;
        if (item.location) ctx += ` | Luogo: ${item.location}`;
        if (item.cost) ctx += ` | Costo: ${item.cost} ${trip.currency || "EUR"}`;
        if (item.flightNumber) ctx += ` | Volo: ${item.flightNumber}`;
        if (item.departureAirport && item.arrivalAirport) ctx += ` | ${item.departureAirport} → ${item.arrivalAirport}`;
        if (item.guests) ctx += ` | ${item.guests} persone`;
        ctx += "\n";
      });
      day.quickExpenses?.forEach((qe) => {
        ctx += `  - [spesa] ${qe.label}: ${qe.amount} ${trip.currency || "EUR"}\n`;
      });
    });
  }
  const total = (trip.days || []).reduce((s, d) =>
    s + (d.items || []).reduce((ss, i) => ss + (Number(i.cost) || 0), 0)
      + (d.quickExpenses || []).reduce((ss, e) => ss + (Number(e.amount) || 0), 0), 0)
    + (trip.legs || []).reduce((s, l) => s + (Number(l.accommodationCost) || 0), 0)
    + (trip.rentals || []).reduce((s, r) => s + (Number(r.cost) || 0), 0)
    + (Number(trip.outboundTransport?.cost) || 0)
    + (Number(trip.returnTransport?.cost) || 0);
  ctx += `\nSPESA TOTALE: ${total} ${trip.currency || "EUR"}\n`;
  if (trip.budget) ctx += `BUDGET: ${trip.budget} ${trip.currency || "EUR"}\n`;
  return ctx;
}

export default function TripAIChat({ trip, onClose, apiKey }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Ciao! Sono il tuo assistente per **${trip?.name || "il viaggio"}**. Chiedimi qualsiasi cosa sull'itinerario!` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const tripContext = buildTripContext(trip);
      const systemPrompt = `Sei un assistente di viaggio personale. Rispondi in italiano, in modo conciso. Usa i dati del viaggio forniti per rispondere con precisione.\n\nDATI DEL VIAGGIO:\n${tripContext}`;
      // Costruiamo la cronologia escludendo il messaggio iniziale dell'assistente
      const apiMessages = newMessages
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: apiMessages
        })
      });
      const data = await response.json();
      const reply = data.content?.[0]?.text || "Non ho trovato una risposta. Riprova.";
      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: "assistant", content: "Errore di connessione. Riprova tra un momento." }]);
    } finally {
      setLoading(false);
    }
  }

  function renderMessage(content) {
    return content.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
    );
  }

  const QUICK = ["Quando è il check-in?", "Qual è la spesa totale?", "Quando finisce il noleggio?", "Cosa facciamo domani?"];

  // Raccoglie tutti i documenti allegati (partecipanti + prenotazioni alloggi + noleggi)
  const allDocs = [];
  (trip?.participants || []).forEach((p) => {
    if (typeof p === "object" && p.document) {
      allDocs.push({ label: `📄 ${typeof p.name === "string" ? p.name : p} — Documento`, src: p.document.src, name: p.document.name });
    }
  });
  (trip?.legs || []).forEach((leg) => {
    if (leg.accommodationAttachment) {
      allDocs.push({ label: `🏨 ${leg.name} — Prenotazione`, src: leg.accommodationAttachment.src, name: leg.accommodationAttachment.name });
    }
  });
  (trip?.rentals || []).forEach((r) => {
    if (r.attachment) {
      allDocs.push({ label: `🚗 ${r.name} — Contratto`, src: r.attachment.src, name: r.attachment.name });
    }
  });
  if (trip?.outboundTransport?.attachment) {
    allDocs.push({ label: `✈️ Andata — Prenotazione`, src: trip.outboundTransport.attachment.src, name: trip.outboundTransport.attachment.name });
  }
  if (trip?.returnTransport?.attachment) {
    allDocs.push({ label: `✈️ Ritorno — Prenotazione`, src: trip.returnTransport.attachment.src, name: trip.returnTransport.attachment.name });
  }

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, width: 360, maxHeight: "70vh", background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", zIndex: 1000, fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "linear-gradient(135deg, #D85A30, #993C1D)", color: "#fff" }}>
        <Sparkles size={18} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Assistente AI</p>
          <p style={{ margin: 0, fontSize: 11, opacity: 0.8 }}>{trip?.name}</p>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", padding: 4 }}><X size={18} /></button>
      </div>

      {allDocs.length > 0 && (
        <div style={{ padding: "8px 12px", background: "#FBFAF6", borderBottom: "1px solid #F0EEE6", display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "#888780", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>Documenti allegati</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {allDocs.map((doc, idx) => (
              <a key={idx} href={doc.src} download={doc.name}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0C447C", textDecoration: "none", background: "#E6F1FB", padding: "4px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
                {doc.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "85%", padding: "9px 12px", borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: msg.role === "user" ? "#D85A30" : "#F5F4F0", color: msg.role === "user" ? "#fff" : "#2C2C2A", fontSize: 13, lineHeight: 1.5 }}>
              {renderMessage(msg.content)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#F5F4F0", borderRadius: "12px 12px 12px 2px", padding: "10px 14px", display: "flex", alignItems: "center", gap: 6, color: "#888780", fontSize: 13 }}>
              <Loader size={13} style={{ animation: "spin 1s linear infinite" }} /> Sto pensando…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && (
        <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {QUICK.map((q) => (
            <button key={q} onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0); }}
              style={{ fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid #E3E1D8", background: "#FBFAF6", color: "#5F5E5A", cursor: "pointer", fontFamily: "inherit" }}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "10px 12px", borderTop: "1px solid #F0EEE6", display: "flex", gap: 8 }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Chiedi qualcosa sul viaggio…"
          style={{ flex: 1, border: "1px solid #E3E1D8", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#FBFAF6" }} />
        <button onClick={sendMessage} disabled={!input.trim() || loading}
          style={{ background: input.trim() && !loading ? "#D85A30" : "#E3E1D8", color: input.trim() && !loading ? "#fff" : "#B4B2A9", border: "none", borderRadius: 8, padding: "0 12px", cursor: input.trim() && !loading ? "pointer" : "not-allowed", display: "flex", alignItems: "center" }}>
          <Send size={15} />
        </button>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
