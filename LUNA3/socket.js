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
        } else if (data.command === 'create_token_ready') { // <<< QUESTO BLOCCO MANCAVA
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

                    const recipientATA = await solanaWebtoken.getAssociatedTokenAddress(
                        mint.publicKey,
                        recipientPublicKey,
                        false,
                        solanaWebtoken.TOKEN_PROGRAM_ID
                    );

                    const transaction = new solanaWeb3.Transaction();

                    // 1. Aggiungi l'istruzione per creare il Mint Account
                    transaction.add(
                        solanaWeb3.SystemProgram.createAccount({
                            fromPubkey: provider.publicKey,
                            newAccountPubkey: mint.publicKey,
                            lamports: await connection.getMinimumBalanceForRentExemption(solanaWebtoken.MINT_SIZE),
                            space: solanaWebtoken.MINT_SIZE,
                            programId: solanaWebtoken.TOKEN_PROGRAM_ID,
                        })
                    );

                    // 2. Aggiungi l'istruzione per inizializzare il Mint Account
                    transaction.add(
                        solanaWebtoken.createInitializeMintInstruction(
                            mint.publicKey,
                            decimals,
                            mintAuthority,
                            freezeAuthority,
                            solanaWebtoken.TOKEN_PROGRAM_ID
                        )
                    );

                    // 3. Aggiungi l'istruzione per creare l'Associated Token Account (ATA) per il destinatario
                    transaction.add(
                        solanaWebtoken.createAssociatedTokenAccountInstruction(
                            provider.publicKey,
                            recipientATA,
                            recipientPublicKey,
                            mint.publicKey,
                            solanaWebtoken.TOKEN_PROGRAM_ID
                        )
                    );

                    // 4. Aggiungi l'istruzione per coniare (mint) i token all'ATA del destinatario
                    transaction.add(
                        solanaWebtoken.createMintToInstruction(
                            mint.publicKey,
                            recipientATA,
                            mintAuthority,
                            supply * Math.pow(10, decimals),
                            [],
                            solanaWebtoken.TOKEN_PROGRAM_ID
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
