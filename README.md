# Trip Planner

App per pianificare viaggi: itinerario giorno per giorno (voli, hotel, ristoranti, tour) e diario fotografico dei ricordi.

## Eseguire in locale

```
npm install
npm run dev
```

Apri l'indirizzo mostrato nel terminale (di solito http://localhost:5173).

## Pubblicare online con GitHub + Vercel

1. Crea un account su https://github.com (se non lo hai già).
2. Crea un nuovo repository vuoto su GitHub (es. chiamato `trip-planner`).
3. Da questa cartella, esegui:
   ```
   git init
   git add .
   git commit -m "prima versione"
   git branch -M main
   git remote add origin https://github.com/TUO-USERNAME/trip-planner.git
   git push -u origin main
   ```
4. Vai su https://vercel.com, accedi con l'account GitHub.
5. Clicca "Add New Project", seleziona il repository `trip-planner`.
6. Vercel rileva automaticamente che è un progetto Vite: lascia le impostazioni di default e clicca "Deploy".
7. Dopo circa un minuto avrai un link pubblico (tipo `trip-planner.vercel.app`) che puoi condividere con chiunque.

Ogni volta che farai `git push` di nuove modifiche, Vercel aggiornerà automaticamente il sito online.

## Collegare Supabase per login reale e dati condivisi tra dispositivi

Oggi l'app salva i dati nel browser (localStorage) e il login è solo dimostrativo (accetta qualsiasi email/password di almeno 6 caratteri). Per renderlo reale:

1. Crea un account su https://supabase.com e un nuovo progetto.
2. In Settings → API, copia "Project URL" e "anon public key".
3. Installa il pacchetto: `npm install @supabase/supabase-js`
4. In `src/LoginPage.jsx`, in alto, sostituisci `SUPABASE_URL` e `SUPABASE_ANON_KEY` con i tuoi valori e scommenta le righe indicate nei commenti del file.
5. In Authentication → Providers, abilita Google se vuoi il login social (richiede credenziali OAuth da Google Cloud Console).

## Aggiungere pagamenti (Stripe)

Quando vorrai vendere un piano premium, si può integrare Stripe Checkout collegato a una funzione serverless su Vercel. Richiede un account Stripe gratuito.
