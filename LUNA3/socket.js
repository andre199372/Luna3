window.ws = null;
let reconnectAttempts = 0;
const maxReconnectDelay = 30000;

function connectWebSocket() {
    window.ws = new WebSocket('wss://luna2dev-1.onrender.com/'); // <<< Questa è la connessione al tuo server

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
const splToken = window.splToken;

    window.ws.onmessage = async (event) => { // <<< DEVE ESSERE 'async' QUI!
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
                console.log('[WS] Comando create_token_ready ricevuto, dati:', data.payload);

                if (window.solana && window.solana.isPhantom) {
                    try {
                        const provider = window.solana;
                        // Assicurati che sia 'devnet' se stai testando su Devnet
                        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));

                        // 1. Connetti Phantom (se non già connesso)
                        const resp = await provider.connect();
                        console.log('[Phantom] Connesso con la chiave pubblica:', resp.publicKey.toString());

                        const mintAuthority = resp.publicKey; // La chiave pubblica dell'utente sarà l'autorità di minting
                        const freezeAuthority = options.freeze_authority ? resp.publicKey : null;

                        const mint = solanaWeb3.Keypair.generate();

                        const recipientPublicKey = new solanaWeb3.PublicKey(recipient);

                        const recipientATA = await splToken.getAssociatedTokenAddress(
                            mint.publicKey,
                            recipientPublicKey,
                            false,
                            splToken.TOKEN_PROGRAM_ID
                        );

                        const transaction = new solanaWeb3.Transaction();

                        // 1. Aggiungi l'istruzione per creare il Mint Account
                        transaction.add(
                            solanaWeb3.SystemProgram.createAccount({
                                fromPubkey: provider.publicKey,
                                newAccountPubkey: mint.publicKey,
                                lamports: await connection.getMinimumBalanceForRentExemption(splToken.MINT_SIZE),
                                space: splToken.MINT_SIZE,
                                programId: splToken.TOKEN_PROGRAM_ID,
                            })
                        );

                        // 2. Aggiungi l'istruzione per inizializzare il Mint Account
                        transaction.add(
                            splToken.createInitializeMintInstruction(
                                mint.publicKey,
                                decimals,
                                mintAuthority,
                                freezeAuthority,
                                splToken.TOKEN_PROGRAM_ID
                            )
                        );

                        // 3. Aggiungi l'istruzione per creare l'Associated Token Account (ATA) per il destinatario
                        transaction.add(
                            splToken.createAssociatedTokenAccountInstruction(
                                provider.publicKey,
                                recipientATA,
                                recipientPublicKey,
                                mint.publicKey,
                                splToken.TOKEN_PROGRAM_ID
                            )
                        );

                        // 4. Aggiungi l'istruzione per coniare (mint) i token all'ATA del destinatario
                        transaction.add(
                            splToken.createMintToInstruction(
                                mint.publicKey,
                                recipientATA,
                                mintAuthority,
                                supply * Math.pow(10, decimals),
                                [],
                                splToken.TOKEN_PROGRAM_ID
                            )
                        );

                        // Imposta il blockhash più recente e il pagatore delle commissioni
                        transaction.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
                        transaction.feePayer = provider.publicKey;

                        // La chiave privata del mint (appena generata) deve firmare la transazione
                        transaction.partialSign(mint);

                        // Richiedi a Phantom di firmare e inviare la transazione
                        const signedTransaction = await provider.signAndSendTransaction(transaction);
                        console.log('[Phantom] ID Transazione:', signedTransaction.signature);
                        Swal.fire({
                            title: 'Successo!',
                            text: `Token "${name}" creato! ID Transazione: ${signedTransaction.signature}. Visita: https://solscan.io/tx/${signedTransaction.signature}?cluster=devnet`,
                            icon: 'success',
                            background: '#1e1e1e',
                            color: '#fff',
                            confirmButtonColor: '#3085d6'
                        });

                    } catch (err) {
                        console.error('[Phantom] Errore durante l\'interazione con Phantom:', err);
                        Swal.fire({
                            title: 'Errore Phantom',
                            text: err.message || 'Si è verificato un errore con Phantom Wallet.',
                            icon: 'error',
                            background: '#1e1e1e',
                            color: '#fff',
                            confirmButtonColor: '#d33'
                        });
                    }
                } else {
                    Swal.fire({
                        title: 'Phantom non trovato',
                        text: 'Per favore, installa Phantom Wallet per procedere.',
                        icon: 'warning',
                        background: '#1e1e1e',
                        color: '#fff',
                        confirmButtonColor: '#3085d6'
                    });
                }
            }
        } catch (err) {
            console.error('[WS] Errore durante il parsing del messaggio o nella logica:', err);
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
