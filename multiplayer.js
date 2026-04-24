/**
 * ==============================================================================
 * YARDBIRD'S GAMES - THE MULTIPLAYER ENGINE (multiplayer.js)
 * ==============================================================================
 * Role: Manages Realtime Database syncing between the Host (TV) and Clients (Phones).
 * Responsibilities:
 * 1. Create and manage Lobbies (Room Codes).
 * 2. Handle Client connections and set up real-time `.on()` listeners.
 * 3. Route specific UI updates to the Phone based on what the Host broadcasts.
 * 4. Pass Client guesses securely back up to the Host.
 * ==============================================================================
 */

import { db } from './firebase.js';
import { state, colors } from './state.js';
import { hideModal } from './ui.js';

// ==========================================
// PHASE 1: HOST LOBBY MANAGEMENT (TV / DESKTOP)
// ==========================================

export function handleHostSetup() {
    if (!state.activeCartridgeId) {
        alert("Please select a Game Cartridge from the Main Menu first!");
        hideModal('multiplayer-modal');
        return;
    }
    
    // UI Transitions for the Host screen
    hideModal('multiplayer-modal');
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('start-btn-top').innerText = "🚀 CREATE MULTIPLAYER ROOM";
    document.getElementById('start-btn-top').onclick = createRoom;
    
    // Hide single-player specific UI elements
    const dailyContainer = document.getElementById('daily-btn-top').parentElement;
    if (dailyContainer) dailyContainer.classList.add('hidden');
    const separator = document.querySelector('#setup-screen .separator-line');
    if (separator) separator.classList.add('hidden'); 
    
    document.getElementById('menu-btn').classList.add('hidden');
    document.getElementById('stats-btn').classList.add('hidden');
    const backBtn = document.getElementById('back-to-main-btn');
    if (backBtn) backBtn.innerText = "CANCEL MULTIPLAYER";
    
    // Set Global State Context
    state.isMultiplayer = true;
    state.isHost = true;
}

function generateRoomCode() {
    // Excluded confusing characters like 1, I, 0, O
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

export async function createRoom() {
    state.numPlayers = 0; 
    
    // Cartridge specific time limits
    state.timeLimit = state.gameState.level === 'hard' ? 10 : 30; 
    
    state.roundsPerPlayer = state.gameState.rounds;
    state.maxRounds = state.gameState.rounds; 
    state.roomCode = generateRoomCode();
    
    // 1. Initialize the Room in Firebase
    await db.ref(`rooms/${state.roomCode}`).set({
        state: 'lobby',
        settings: state.gameState,
        cartridgeId: state.activeCartridgeId, 
        createdAt: window.firebase.database.ServerValue.TIMESTAMP
    });

    // Clean up if the Host refreshes or closes the tab
    db.ref(`rooms/${state.roomCode}`).onDisconnect().remove();

    // 2. Build the Host Lobby UI
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('host-lobby-screen').classList.remove('hidden');
    document.getElementById('display-room-code').innerText = state.roomCode;
    
    // Generate QR Code for easy phone joining
    document.getElementById('qr-container').innerHTML = ""; 
    const joinUrl = window.location.origin + window.location.pathname + "?room=" + state.roomCode;
    new QRCode(document.getElementById("qr-container"), {
        text: joinUrl, width: 160, height: 160, colorDark : "#0a0a0c", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.M
    });

    // 3. Listen for Phones joining the room
    db.ref(`rooms/${state.roomCode}/players`).on('value', (snapshot) => {
        const players = snapshot.val();
        const listDiv = document.getElementById('lobby-player-list');
        listDiv.innerHTML = '';
        
        if (players) {
            const playerIds = Object.keys(players);
            state.numPlayers = playerIds.length;
            document.getElementById('player-count').innerText = state.numPlayers;
            
            // Allow starting if at least 1 player is in
            document.getElementById('start-multiplayer-btn').disabled = state.numPlayers === 0;

            playerIds.forEach((pid, index) => {
                const pTag = document.createElement('div');
                pTag.className = 'pill active';
                pTag.style.borderColor = colors[index % colors.length];
                pTag.innerText = players[pid].name;
                listDiv.appendChild(pTag);
            });
        } else {
            state.numPlayers = 0;
            document.getElementById('player-count').innerText = 0;
            document.getElementById('start-multiplayer-btn').disabled = true;
        }
    });
}


// ==========================================
// PHASE 2: CLIENT CONNECTION & SYNCING (PHONES)
// ==========================================

export function handleJoinScreen() {
    hideModal('multiplayer-modal');
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('join-screen').classList.remove('hidden');
    
    // Locks down the global UI so phones act purely as controllers
    document.body.classList.add('client-mode');
    state.isMultiplayer = true;
    state.isHost = false;
}

export async function joinRoom() {
    const codeInput = document.getElementById('join-code').value.toUpperCase().trim();
    const nameInput = document.getElementById('join-name').value.trim();
    const fb = document.getElementById('join-feedback');
    
    if (codeInput.length !== 4) { fb.innerText = "Please enter a 4-letter code."; return; }
    if (nameInput.length < 2) { fb.innerText = "Nickname must be at least 2 characters."; return; }

    fb.innerText = "Connecting...";
    
    // 1. Validate the Room
    const roomSnap = await db.ref(`rooms/${codeInput}`).once('value');
    if (!roomSnap.exists()) { fb.innerText = "Room not found. Check the code!"; return; }
    if (roomSnap.val().state !== 'lobby') { fb.innerText = "Game is already in progress!"; return; }

    // 2. Inherit the Host's Cartridge and Settings
    const roomData = roomSnap.val();
    const cartId = roomData.cartridgeId;
    if (cartId && window.loadCartridge) window.loadCartridge(cartId);
    
    state.gameState = roomData.settings || state.gameState;

    // Cartridge specific logic for local timers
    if (cartId === 'fast_math') {
        state.timeLimit = state.gameState.level === 'easy' ? 20 : (state.gameState.level === 'medium' ? 15 : 8);
    } else if (cartId === 'consensus') {
        state.timeLimit = state.gameState.level === 'easy' ? 30 : 15;
    } else {
        state.timeLimit = state.gameState.level === 'hard' ? 10 : 30;
    }

    state.roomCode = codeInput;
    state.myPlayerId = "player_" + Date.now() + Math.floor(Math.random()*1000); 

    // 3. Register the Player in Firebase
    await db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}`).set({ 
        name: nameInput, score: 0, status: 'waiting' 
    });
    // Remove the player if their phone goes to sleep or disconnects
    db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}`).onDisconnect().remove();

    // 4. Transition to Waiting Screen
    document.getElementById('join-screen').classList.add('hidden');
    const waitScreen = document.createElement('div');
    waitScreen.id = 'client-wait-screen';
    waitScreen.innerHTML = `<h2 style="color:var(--brand);">You're in!</h2><p style="font-size:1.2rem;">Look at the big screen.</p>`;
    document.querySelector('.container').appendChild(waitScreen);

    // --- THE MASSIVE CLIENT LISTENER BLOCK ---
    // These listeners watch the Host's state and update the phone's UI accordingly.

    // A. Watch Global Game State (Playing vs Finished)
    db.ref(`rooms/${state.roomCode}/state`).on('value', (snap) => {
        if (!snap.exists()) { location.reload(); } // Host ended game
        else if (snap.val() === 'playing') {
            document.getElementById('client-wait-screen').classList.add('hidden');
            document.getElementById('client-play-screen').classList.remove('hidden');
        } else if (snap.val() === 'finished') {
            document.getElementById('client-play-screen').classList.add('hidden');
            document.getElementById('client-end-screen').classList.remove('hidden');
            
            // Get personal final score
            db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}/finalScore`).on('value', scoreSnap => {
                if (scoreSnap.exists()) document.getElementById('client-final-score').innerText = scoreSnap.val();
            });
            
            // Get room leaderboard
            db.ref(`rooms/${state.roomCode}/finalLeaderboard`).once('value', lbSnap => {
                if(lbSnap.exists()) {
                    let results = lbSnap.val();
                    let html = `<div style="text-align:left; background:rgba(0,0,0,0.03); padding:15px; border-radius:12px; border:2px solid var(--border-light);">`;
                    html += `<div style="font-size:0.85rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:10px; font-weight:bold; text-align:center;">Final Standings</div>`;
                    results.forEach((p, idx) => {
                        let medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '👏'));
                        let color = idx === 0 ? 'var(--p1)' : (idx === 1 ? 'var(--p2)' : 'var(--text-muted)');
                        html += `<div style="display:flex; justify-content:space-between; padding: 10px 5px; border-bottom: 1px solid var(--border-light); font-weight: bold; color: ${color};"><span>${medal} ${p.name}</span><span style="color:var(--dark-text)">${p.score}</span></div>`;
                    });
                    html += `</div>`;
                    const lbContainer = document.getElementById('client-leaderboard-container');
                    if(lbContainer) lbContainer.innerHTML = html;
                }
            });
        }
    });

    // B. Watch for standard Multiple Choice Options (Fast Math, Song Trivia Lifeline)
    db.ref(`rooms/${state.roomCode}/currentMC`).on('value', mcSnap => {
        if(mcSnap.exists()) {
            document.getElementById('client-text-inputs').classList.add('hidden');
            renderClientMC(mcSnap.val());
        }
    });

    // C. Watch for New Round starts
    db.ref(`rooms/${state.roomCode}/currentRound`).on('value', snap => {
        if(snap.exists() && document.getElementById('client-status')) {
            document.getElementById('client-status').innerText = `ROUND ${snap.val()}`;
            
            // Reset local UI states
            document.getElementById('client-locked-screen').classList.add('hidden');
            document.getElementById('client-mc-inputs').classList.add('hidden');
            
            // Only show text inputs if the Cartridge demands it
            if (window.activeCartridge && window.activeCartridge.manifest.id === 'song_trivia') {
                document.getElementById('client-text-inputs').classList.remove('hidden');
            } else {
                document.getElementById('client-text-inputs').classList.add('hidden');
            }
            
            // Clear inputs
            if(document.getElementById('client-guess-artist')) document.getElementById('client-guess-artist').value = '';
            if(document.getElementById('client-guess-song')) document.getElementById('client-guess-song').value = '';
            if(document.getElementById('client-guess-movie')) document.getElementById('client-guess-movie').value = '';
            
            // Tell the Host we are ready to guess
            db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}`).update({ status: 'guessing', guess: null });
        }
    });

    // D. Watch the visual Timer Bar
    db.ref(`rooms/${state.roomCode}/timeLeft`).on('value', snap => {
        const timerContainer = document.getElementById('client-timer-display');
        if(snap.exists() && timerContainer) {
            const time = snap.val();
            timerContainer.dataset.time = time; 
            
            let percentage = (time / (state.timeLimit || 30)) * 100;
            let bgColor = time <= 3 ? 'var(--fail)' : 'var(--primary)';
            let fill = document.getElementById('client-timer-fill');
            
            if (!fill) {
                timerContainer.innerHTML = `<div class="timer-bar-container" style="margin: 15px 0;"><div id="client-timer-fill" class="timer-bar-fill" style="width: 100%;"></div></div>`;
                fill = document.getElementById('client-timer-fill');
            }
            if (fill) {
                fill.style.width = `${percentage}%`;
                fill.style.backgroundColor = bgColor;
            }
        }
    });

    // E. Watch for Prompts (Fast Math Target, Quote Trivia Quote)
    db.ref(`rooms/${state.roomCode}/currentPrompt`).on('value', snap => {
        let promptDiv = document.getElementById('client-prompt');
        if (snap.exists()) {
            if (!promptDiv) {
                promptDiv = document.createElement('div');
                promptDiv.id = 'client-prompt';
                const playScreen = document.getElementById('client-play-screen');
                const mcInputs = document.getElementById('client-mc-inputs');
                if (playScreen && mcInputs) playScreen.insertBefore(promptDiv, mcInputs);
            }
            promptDiv.innerHTML = `<div class="prompt-text" style="text-align:center; margin-top:15px; margin-bottom:20px;">${snap.val()}</div>`;
            promptDiv.classList.remove('hidden');
        } else if (promptDiv) {
            promptDiv.classList.add('hidden');
        }
    });
    
    // F. DYNAMIC CARTRIDGE UI DELEGATION (Crucial for Consensus)
    db.ref(`rooms/${state.roomCode}/hostState`).on('value', snap => {
        if (snap.exists() && window.activeCartridge && window.activeCartridge.renderClientUI) {
            // Hide all standard UI to allow the Cartridge to draw its own custom UI
            document.getElementById('client-text-inputs').classList.add('hidden');
            document.getElementById('client-mc-inputs').classList.add('hidden');
            document.getElementById('client-locked-screen').classList.add('hidden');
            
            window.activeCartridge.renderClientUI(snap.val());
        }
    });
}


// ==========================================
// PHASE 3: ACTIVE GAME STATE & TEARDOWN
// ==========================================

export async function startMultiplayerGame() {
    document.getElementById('host-lobby-screen').classList.add('hidden');
    
    // Tell all phones to switch to the Play Screen
    await db.ref(`rooms/${state.roomCode}`).update({ 
        state: 'playing', 
        currentRound: 1, 
        mode: state.gameState.mode,
        timeLeft: state.timeLimit 
    });
    
    await db.ref(`rooms/${state.roomCode}/hostState`).set({ phase: 'loading' });

    // Host watches all players. If everyone has 'locked' their answer, auto-advance the round.
    db.ref(`rooms/${state.roomCode}/players`).on('value', (snap) => {
        if (!state.isHost || !snap.exists() || state.isProcessing) return;
        
        const players = snap.val();
        let allLocked = true; let totalPlayers = 0;
        
        Object.keys(players).forEach(pid => {
            totalPlayers++;
            if (players[pid].status !== 'locked') allLocked = false;
        });

        if (allLocked && totalPlayers > 0) {
            window.evaluateMultiplayerRound(players); 
        }
    });

    // Boot up the active Cartridge
    window.startGame(); 
}

export async function cancelLobby() {
    if (state.roomCode) await db.ref(`rooms/${state.roomCode}`).remove();
    location.reload(); 
}

export async function cancelActiveGame() {
    if (confirm("Are you sure you want to end the game for everyone?")) {
        if (state.isMultiplayer && state.isHost && state.roomCode) await db.ref(`rooms/${state.roomCode}`).remove();
        location.reload(); 
    }
}


// ==========================================
// PHASE 4: CLIENT SUBMISSIONS (FROM PHONE TO TV)
// ==========================================

export function submitClientTextGuess() {
    const artist = document.getElementById('client-guess-artist').value.trim();
    const song = document.getElementById('client-guess-song').value.trim();
    const movie = document.getElementById('client-guess-movie').value.trim();
    
    // Append the exact time remaining to the guess for speed-based scoring
    const timerContainer = document.getElementById('client-timer-display');
    const currentTime = timerContainer ? (parseInt(timerContainer.dataset.time) || 0) : 0;
    
    db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}`).update({
        guess: { isMC: false, artist: artist, song: song, movie: movie, time: currentTime },
        status: 'locked' // Triggers the auto-advance watcher on the Host
    });
    
    document.getElementById('client-text-inputs').classList.add('hidden');
    document.getElementById('client-locked-screen').classList.remove('hidden');
}

export function requestClientLifeline() {
    // Specifically used by Song Trivia to fetch the MC options early
    db.ref(`rooms/${state.roomCode}/roundMC`).once('value', snap => {
        if (snap.exists()) {
            document.getElementById('client-text-inputs').classList.add('hidden');
            renderClientMC(snap.val());
        }
    });
}

function renderClientMC(options) {
    const mcContainer = document.getElementById('client-mc-inputs');
    mcContainer.innerHTML = '';
    mcContainer.classList.remove('hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'mc-btn'; 
        btn.innerText = opt.str;
        btn.onclick = () => submitClientMCGuess(opt.isCorrect);
        mcContainer.appendChild(btn);
    });
}

function submitClientMCGuess(isCorrect) {
    const timerContainer = document.getElementById('client-timer-display');
    const currentTime = timerContainer ? (parseInt(timerContainer.dataset.time) || 0) : 0;
    
    db.ref(`rooms/${state.roomCode}/players/${state.myPlayerId}`).update({
        guess: { isMC: true, correct: isCorrect, time: currentTime },
        status: 'locked'
    });
    
    document.getElementById('client-mc-inputs').classList.add('hidden');
    document.getElementById('client-locked-screen').classList.remove('hidden');
}


// ==========================================
// PHASE 5: ROUND MANAGEMENT BRIDGE
// ==========================================

/**
 * Called by Cartridges (e.g., mathLogic, gameLogic) at the end of a round.
 * Writes the new calculated scores back to Firebase so the Phones can see them.
 * @param {Array} results - [{id: "player_x", newScore: 100}, ...]
 */
export async function finalizeMultiplayerRound(results) {
    const updates = {};
    results.forEach(res => {
        updates[`players/${res.id}/score`] = res.newScore;
        updates[`players/${res.id}/status`] = 'waiting'; 
    });

    await db.ref(`rooms/${state.roomCode}`).update(updates);
    
    // Clear out the old UI data so phones don't hold onto stale buttons
    await db.ref(`rooms/${state.roomCode}/currentMC`).remove();
    await db.ref(`rooms/${state.roomCode}/currentPrompt`).remove();

    // Note: We DO NOT call setTimeout(nextRound) here. 
    // The individual Cartridges handle their own pacing and nextRound triggers!
}

// Bind to window for global access by the active Cartridge
window.finalizeMultiplayerRound = finalizeMultiplayerRound;
