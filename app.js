// app.js
import { state } from './state.js';
import { showModal, hideModal, setMode, setSub, setPill, setLevel, renderPlaylist, renderSubPills, setupDailyButton, buildSetupScreen, updatePlatformUI } from './ui.js';
import { handleHostSetup, handleJoinScreen, createRoom, joinRoom, startMultiplayerGame, cancelLobby, cancelActiveGame, submitClientTextGuess, requestClientLifeline } from './multiplayer.js';

import * as SongTrivia from './gameLogic.js';
import * as FastMath from './mathLogic.js';

let activeCartridge = SongTrivia; 

window.showModal = showModal; window.hideModal = hideModal;
window.setMode = setMode; window.setSub = setSub; window.setPill = setPill; window.setLevel = setLevel;
window.renderPlaylist = renderPlaylist;
window.handleHostSetup = handleHostSetup; window.handleJoinScreen = handleJoinScreen;
window.createRoom = createRoom; window.joinRoom = joinRoom;
window.startMultiplayerGame = startMultiplayerGame; window.cancelLobby = cancelLobby;
window.cancelActiveGame = cancelActiveGame; window.submitClientTextGuess = submitClientTextGuess;
window.requestClientLifeline = requestClientLifeline;

// 🕹️ NEW: THE UNIVERSAL CARTRIDGE LOADER
window.loadCartridge = (gameId) => {
    activeCartridge = gameId === 'fast_math' ? FastMath : SongTrivia;
    state.activeCartridgeId = gameId;
    
    // Update the UI dynamically
    document.getElementById('main-title').innerText = activeCartridge.manifest.title;
    updatePlatformUI(gameId); // Changes Rules and Stats modals!
};

window.selectGame = (gameId) => {
    window.loadCartridge(gameId); // Plug it in!
    
    buildSetupScreen(activeCartridge.manifest);
    if (gameId === 'song_trivia') renderSubPills();

    document.getElementById('main-menu-screen').classList.add('hidden');
    document.getElementById('setup-screen').classList.remove('hidden');
};

// Route universal buttons to the active cartridge
window.startDailyChallenge = () => activeCartridge.startDailyChallenge();
window.startGame = () => activeCartridge.startGame();
window.handleStop = () => activeCartridge.handleStop();
window.forceLifeline = () => activeCartridge.forceLifeline();
window.evaluateGuess = (isCorrect) => activeCartridge.evaluateGuess(isCorrect);
window.resetStats = () => activeCartridge.resetStats();
window.shareChallenge = () => activeCartridge.shareChallenge();
window.evaluateMultiplayerRound = (players) => activeCartridge.evaluateMultiplayerRound(players);

window.onload = () => {
    // Set Main Menu defaults
    document.getElementById('main-title').innerText = "YARDBIRD'S GAMES";
    updatePlatformUI('main_menu'); 
    
    setupDailyButton();

    const urlParams = new URLSearchParams(window.location.search);
    const autoRoom = urlParams.get('room');
    if (autoRoom) {
        document.getElementById('main-menu-screen').classList.add('hidden'); 
        handleJoinScreen(); 
        document.getElementById('join-code').value = autoRoom; 
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => document.getElementById('join-name').focus(), 100);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const triggerSubmit = (e) => { if (e.key === 'Enter') document.getElementById('submit-btn').click(); };
    if(document.getElementById('guess-artist')) document.getElementById('guess-artist').addEventListener('keypress', triggerSubmit);
    if(document.getElementById('guess-song')) document.getElementById('guess-song').addEventListener('keypress', triggerSubmit);
    if(document.getElementById('guess-movie')) document.getElementById('guess-movie').addEventListener('keypress', triggerSubmit);
});
