/**
 * ==============================================================================
 * YARDBIRD'S GAMES - CARTRIDGE: THE REVEAL (revealLogic.js)
 * ==============================================================================
 * Role: Handles the visual pattern-recognition game using the 12-Second Grid.
 * Architecture: Local JSON Database + Wikipedia Action API for keyless images.
 * * PHASES:
 * 1. Manifest & Config   (Setup screen data & System Stubs)
 * 2. Local State         (Cartridge variables & Dynamic CSS)
 * 3. Core Game Loop      (Start, Round Management, End)
 * 4. Data & Network      (JSON loading, Wikipedia fetching)
 * 5. Mechanics & UI      (12s Grid Timer, Score Evaluation)
 * 6. Stats & Sharing     (Locker Room UI, Persistence)
 * ==============================================================================
 */

import { db } from './firebase.js';
import { state, sfxTick, sfxCheer, sfxBuzzer, colors } from './state.js';

// ==========================================
// PHASE 1: MANIFEST & SYSTEM STUBS
// ==========================================

export const manifest = {
    id: "the_reveal",
    title: "THE REVEAL",
    subtitle: "Visual Pattern Recognition",
    hasDaily: false,
    rulesHTML: `
        <h2>How to Play</h2>
        <div style="text-align:left; color:var(--dark-text); line-height:1.7; font-size:0.95rem;">
            <p>An image will appear completely hidden behind a 12-block grid.</p>
            <p><strong>Every second, one block vanishes.</strong> You have exactly 12 seconds to figure it out.</p>
            <p>Tap the correct answer as fast as you can. <strong style="color:var(--primary);">The fewer blocks revealed, the more points you lock in.</strong></p>
            <p>🔥 Get 3 correct in a row for a +50 Streak Bonus!</p>
        </div>
        <button class="btn btn-main" onclick="hideModal('rules-modal')" style="margin-top:15px; width:100%;">Let's Go!</button>
    `,
    modes: [
        { id: "media", title: "🎬 Media", desc: "Movie posters and iconic album covers." },
        { id: "megastars", title: "🌟 Megastars", desc: "Actors, athletes, and pop culture icons." },
        { id: "masterpieces", title: "🎨 Masterpieces", desc: "Famous art and historical photography." }
    ],
    levels: [
        { id: "standard", title: "🟢 The Grid", desc: "12 seconds. One block vanishes every second." }
    ]
};

// System Contract Stubs (Required by app.js to prevent crashes)
export function handleStop() { return; }
export function forceLifeline() { return; }
export function startDailyChallenge() { alert("Daily mode coming soon!"); }


// ==========================================
// PHASE 2: LOCAL STATE & CSS INJECTION
// ==========================================

const revealState = {
    localDB: null,
    queue: [],             // Shuffled deck of prompts to guarantee NO repeats
    currentData: null,     // The active { imageKeyword, answer, wrong } object
    maxTime: 12.0,         // Locked to 12 seconds
    blocksRemaining: [],   // Tracks which grid blocks haven't vanished yet
    currentScorePotential: 0
};

// Hardware-accelerated CSS for the Grid Mechanic
const style = document.createElement('style');
style.innerHTML = `
    .reveal-image-container {
        width: 100%;
        max-width: 350px;
        height: 350px;
        margin: 0 auto 20px auto;
        border-radius: 12px;
        position: relative;
        background: #121212;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        overflow: hidden;
    }
    .reveal-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .grid-overlay {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(4, 1fr);
        gap: 2px; /* Slight gap makes it look like physical tiles */
    }
    .grid-block {
        background: #121212; /* Deep matte black */
        transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .grid-block.hidden {
        opacity: 0;
        transform: scale(0.8); /* Slight shrink effect as it vanishes */
    }
`;
document.head.appendChild(style);


// ==========================================
// PHASE 3: CORE GAME LOOP
// ==========================================

export async function startGame() {
    // 1. Clean Global State
    state.curIdx = 0;
    state.numPlayers = 1; 
    state.maxRounds = state.gameState.rounds;
    state.rawScores = [0];
    state.streaks = [0];
    
    // 2. Generate 2X Bonus Rounds (1 in every 5 rounds)
    state.doubleRounds = [];
    for (let i = 0; i < state.maxRounds; i += 5) {
        let min = i === 0 ? 1 : i; 
        let max = Math.min(i + 4, state.maxRounds - 1);
        if (min <= max) state.doubleRounds.push(Math.floor(Math.random() * (max - min + 1)) + min);
    }

    // 3. Prep UI
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('play-screen').classList.remove('hidden');
    document.querySelectorAll('.header-btn').forEach(btn => btn.classList.add('hidden'));
    document.getElementById('guess-fields').classList.add('hidden');
    document.getElementById('btn-container').classList.add('hidden');
    document.getElementById('visualizer').classList.add('hidden');
    document.getElementById('reveal-art').style.display = 'none';
    
    document.getElementById('feedback').innerHTML = `<div style="color:var(--primary); font-size:1.5rem; margin-top:40px;">Initializing Grid Engine...</div>`;

    // 4. Load Database and Build Queue
    await loadLocalDatabase();
    const modeData = revealState.localDB[state.gameState.mode];
    if (!modeData || modeData.length === 0) {
        alert("Fatal Error: No data found for this mode.");
        location.reload(); return;
    }
    
    // Shuffle the deck so we can pop safely without repeats
    revealState.queue = [...modeData].sort(() => 0.5 - Math.random());

    nextRound();
}

async function nextRound() {
    if (state.curIdx >= state.maxRounds) { endGameSequence(); return; }
    state.isProcessing = false;

    // 1. Pop from queue (Ensures absolutely NO repeating clues)
    revealState.currentData = revealState.queue.pop();
    if (!revealState.currentData) {
        console.warn("Out of database prompts! Ending game early.");
        endGameSequence(); return;
    }

    // 2. Fetch & Preload Image
    document.getElementById('feedback').innerHTML = `<div style="color:var(--text-muted); font-size:1.2rem; margin-top:40px; animation: pulse 1.5s infinite;">Searching Wikipedia...</div>`;
    const imageUrl = await fetchWikipediaImage(revealState.currentData.imageKeyword);
    
    if (!imageUrl) {
        console.error("Wikipedia returned no image. Skipping round.");
        return nextRound();
    }
    
    document.getElementById('feedback').innerHTML = `<div style="color:var(--text-muted); font-size:1.2rem; margin-top:40px; animation: pulse 1.5s infinite;">Downloading high-res payload...</div>`;
    await preloadImage(imageUrl);

    // 3. Build Gameplay UI
    renderGameplayUI(imageUrl);
    startGridTimer();
}

// ==========================================
// PHASE 4: DATA & NETWORK
// ==========================================

async function loadLocalDatabase() {
    try {
        const response = await fetch('./db_reveal.json');
        revealState.localDB = await response.json();
    } catch (err) {
        console.error("Failed to load db_reveal.json:", err);
    }
}

async function fetchWikipediaImage(pageTitle) {
    const title = encodeURIComponent(pageTitle);
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=600&origin=*`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pages[pageId].thumbnail && pages[pageId].thumbnail.source) return pages[pageId].thumbnail.source;
        return null;
    } catch (err) {
        return null;
    }
}

function preloadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve; // Resolve even on error to prevent infinite hang
        img.src = url;
    });
}

// ==========================================
// PHASE 5: MECHANICS & UI
// ==========================================

function renderGameplayUI(imageUrl) {
    const isDouble = state.doubleRounds.includes(state.curIdx);
    
    // Player Tag & Double Points Indicator
    const tag = document.getElementById('active-player');
    tag.innerText = `ROUND ${state.curIdx + 1}/${state.maxRounds}${isDouble ? ' — ⭐ 2X BONUS' : ''}`;
    tag.style.color = isDouble ? '#f39c12' : 'var(--primary)';
    tag.style.borderColor = isDouble ? '#f39c12' : 'var(--primary)';

    // Update Top Scoreboard
    document.getElementById('score-board').innerHTML = `
        <div class="score-pill" style="border-color:${colors[0]};">
            <div class="p-name" style="color:${colors[0]}">SCORE</div>
            <div class="p-pts" style="color:var(--dark-text)">${state.rawScores[0]}</div>
            <div class="p-streak" style="color:${colors[0]}; opacity:${state.streaks[0] > 0 ? 1 : 0}">🔥 ${state.streaks[0]}</div>
        </div>`;

    // Shuffle multiple choice
    let options = [{ str: revealState.currentData.answer, isCorrect: true }];
    revealState.currentData.wrong.forEach(w => options.push({ str: w, isCorrect: false }));
    options = options.sort(() => 0.5 - Math.random());

    // Inject Image and 12-Block Grid Overlay
    let gridHTML = Array.from({length: 12}).map((_, i) => `<div class="grid-block" id="block-${i}"></div>`).join('');
    
    document.getElementById('feedback').innerHTML = `
        <div class="reveal-image-container">
            <img id="reveal-active-image" class="reveal-image" src="${imageUrl}">
            <div class="grid-overlay">
                ${gridHTML}
            </div>
        </div>
    `;

    const mcContainer = document.getElementById('mc-fields');
    mcContainer.innerHTML = '';
    mcContainer.classList.remove('hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'mc-btn';
        btn.innerText = opt.str;
        // The evaluateGuess hook takes the truth value AND the physical button clicked
        btn.onclick = (e) => window.evaluateGuess(opt.isCorrect, e.target);
        mcContainer.appendChild(btn);
    });
}

function startGridTimer() {
    state.timeLeft = revealState.maxTime; // 12.0
    
    // Create an array of 0-11 and shuffle it so blocks vanish randomly
    revealState.blocksRemaining = [0,1,2,3,4,5,6,7,8,9,10,11].sort(() => 0.5 - Math.random());
    let lastSecond = 12;
    
    // Platform standard timer bar
    const timerElement = document.getElementById('timer');
    timerElement.innerHTML = `<div class="timer-bar-container"><div id="timer-bar-fill" class="timer-bar-fill"></div></div>`;
    const timerFill = document.getElementById('timer-bar-fill');

    state.timerId = setInterval(() => {
        state.timeLeft -= 0.1;
        if (state.timeLeft < 0) state.timeLeft = 0;

        // Smooth UI Bar Update
        if (timerFill) {
            timerFill.style.width = `${(state.timeLeft / revealState.maxTime) * 100}%`;
            if (state.timeLeft <= 3) timerFill.style.backgroundColor = 'var(--fail)';
        }

        // Score Potential scales evenly from 1000 down to 0
        revealState.currentScorePotential = Math.floor((state.timeLeft / revealState.maxTime) * 1000);

        // GRID REVEAL LOGIC: Pop one block every time a full second drops
        const currentSecond = Math.ceil(state.timeLeft); 
        if (currentSecond < lastSecond && revealState.blocksRemaining.length > 0) {
            lastSecond = currentSecond;
            const blockId = revealState.blocksRemaining.pop();
            const blockEl = document.getElementById(`block-${blockId}`);
            if (blockEl) blockEl.classList.add('hidden');
        }

        // Sound effect on last 3 seconds
        if (Math.abs(state.timeLeft - Math.round(state.timeLeft)) < 0.05 && state.timeLeft <= 3 && state.timeLeft > 0) {
            sfxTick.play().catch(()=>{});
        }

        // Timeout (Loss)
        if (state.timeLeft <= 0) {
            clearInterval(state.timerId);
            window.evaluateGuess(false, null);
        }
    }, 100); 
}

export function evaluateGuess(isCorrect, clickedBtn = null) {
    if (state.isProcessing) return;
    state.isProcessing = true;
    clearInterval(state.timerId);

    // Disable buttons
    document.querySelectorAll('.mc-btn').forEach(b => b.disabled = true);
    if (clickedBtn && !isCorrect) clickedBtn.classList.add('wrong');
    
    // Instantly remove all remaining blocks to reveal the image
    document.querySelectorAll('.grid-block').forEach(b => b.classList.add('hidden'));

    // Highlight the correct answer to train the user
    document.querySelectorAll('#mc-fields .mc-btn').forEach(btn => {
        if (btn.innerText === revealState.currentData.answer) btn.classList.add('correct');
    });

    let roundPts = 0;

    if (isCorrect) {
        state.streaks[0]++;
        const isDouble = state.doubleRounds.includes(state.curIdx);
        const streakBonus = (state.streaks[0] > 0 && state.streaks[0] % 3 === 0);
        
        roundPts = revealState.currentScorePotential;
        if (streakBonus) roundPts += 50;
        if (isDouble) roundPts *= 2;

        state.rawScores[0] += roundPts;
        sfxCheer.currentTime = 0; sfxCheer.play().catch(() => {});

        const streakMsg = streakBonus ? `<div style="color:var(--p3); font-size:0.9rem; margin-top:4px; font-weight:bold;">🔥 ${state.streaks[0]} streak! +50 bonus</div>` : '';
        const doubleMsg = isDouble ? `<div style="color:#f39c12; font-size:0.9rem; font-weight:bold; margin-top:4px;">⭐ 2X BONUS ROUND!</div>` : '';

        document.getElementById('feedback').insertAdjacentHTML('afterend', `
            <div id="reveal-eval-msg" style="margin-bottom: 20px;">
                <div style="color:var(--success); font-size:1.5rem; font-weight:bold;">✅ CORRECT! +${roundPts}</div>
                ${streakMsg}${doubleMsg}
            </div>
        `);
    } else {
        state.streaks[0] = 0;
        sfxBuzzer.currentTime = 0; sfxBuzzer.play().catch(() => {});

        document.getElementById('feedback').insertAdjacentHTML('afterend', `
            <div id="reveal-eval-msg" style="margin-bottom: 20px;">
                <div style="color:var(--fail); font-size:1.5rem; font-weight:bold;">❌ INCORRECT</div>
            </div>
        `);
    }

    // Update Top Scoreboard instantly
    document.getElementById('score-board').innerHTML = `
        <div class="score-pill" style="border-color:${colors[0]}">
            <div class="p-name">SCORE</div>
            <div class="p-pts" style="color:var(--dark-text);">${state.rawScores[0]}</div>
            <div class="p-streak" style="color:${colors[0]}; opacity:${state.streaks[0] > 0 ? 1 : 0}">🔥 ${state.streaks[0]}</div>
        </div>`;

    state.curIdx++;
    
    // Clean up injected message and move to next round
    setTimeout(() => {
        const msg = document.getElementById('reveal-eval-msg');
        if(msg) msg.remove();
        nextRound();
    }, 3000);
}


// ==========================================
// PHASE 6: STATS & SHARING
// ==========================================

function endGameSequence() {
    document.getElementById('play-screen').classList.add('hidden');
    document.getElementById('final-screen').classList.remove('hidden');
    document.getElementById('final-subtitle').innerText = "Speed & Accuracy Evaluation";
    
    // The Reveal doesn't use the playlist export box, so we hide it
    const playlistBox = document.querySelector('.playlist-box');
    if (playlistBox) playlistBox.style.display = 'none';

    const maxScore = state.rawScores[0] || 0;
    
    // Persist Stats
    state.userStats.the_reveal = state.userStats.the_reveal || { gamesPlayed: 0, highScore: 0 };
    if (maxScore > state.userStats.the_reveal.highScore) {
        state.userStats.the_reveal.highScore = maxScore;
    }
    state.userStats.the_reveal.gamesPlayed++;
    state.userStats.platformGamesPlayed++;
    localStorage.setItem('yardbirdPlatformStats', JSON.stringify(state.userStats));

    // Fix: Proper Solo End Card Injection!
    const hypeText = maxScore > (state.maxRounds * 600) ? "Eagle Eye! 🦅" : (maxScore > (state.maxRounds * 300) ? "Solid Vision! 👁️" : "Needs Glasses! 👓");
    
    document.getElementById('winner-text').innerHTML = `
        <div style="background: linear-gradient(135deg, var(--primary), var(--secondary)); padding:50px 20px; border-radius:24px; color:white;
             box-shadow:0 12px 24px rgba(0,0,0,0.15); margin:30px 0; text-align:center;">
            <div style="font-size:1.1rem; font-weight:600; text-transform:uppercase; letter-spacing:2px; opacity:0.9; margin-bottom:10px;">
                Final Score </div>
            <div style="font-size:5.5rem; font-weight:900; line-height:1; font-family:'Courier New',monospace; text-shadow:2px 4px 10px rgba(0,0,0,0.2);">
                ${maxScore}
            </div>
            <div style="font-size:1.2rem; font-weight:600; margin-top:15px; opacity:0.9;">${hypeText}</div>
        </div>
    `;
    document.getElementById('winner-text').style.color = '';
    document.getElementById('final-grid').innerHTML = '';
}

export function renderStatsUI(revealStats, container) {
    // Fix: Completely overwrites the modal content so it doesn't look like Song Trivia
    container.innerHTML = `
        <h2 style="color:var(--primary); margin-top:0; text-align:center; border-bottom:2px solid var(--border-light); padding-bottom:15px;">The Reveal Locker</h2>
        <div class="stat-grid">
            <div class="stat-box">
                <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Games Played</div>
                <div class="stat-val">${revealStats.gamesPlayed || 0}</div>
            </div>
            <div class="stat-box">
                <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">High Score</div>
                <div class="stat-val" style="color:var(--p1)">${revealStats.highScore || 0}</div>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px;">
            <button class="btn btn-main" onclick="hideModal('stats-modal')" style="flex:1; margin-right:10px;">Close</button>
            <button class="btn btn-reset" onclick="if(window.activeCartridge) { window.activeCartridge.resetStats(); hideModal('stats-modal'); }" style="margin-top:0; padding:16px;">Reset</button>
        </div>
    `;
}

export function resetStats() {
    if (confirm("Reset your The Reveal stats? This cannot be undone.")) {
        state.userStats.the_reveal = { gamesPlayed: 0, highScore: 0 };
        localStorage.setItem('yardbirdPlatformStats', JSON.stringify(state.userStats));
        alert("The Reveal stats reset.");
        if (window.hideModal) window.hideModal('stats-modal');
    }
}

export function shareChallenge() {
    const score = state.rawScores[0] || 0;
    const text = `👁️ The Reveal\nI scored ${score} pts in Visual Pattern Recognition!\nThink you have better vision?`;
    const url = `${window.location.origin}${window.location.pathname}`;
    if (navigator.share) {
        navigator.share({ title: "Beat My Score!", text, url }).catch(console.error);
    } else {
        navigator.clipboard.writeText(text + "\n" + url);
        alert("Challenge link copied to clipboard!");
    }
}
