/**
 * ==============================================================================
 * YARDBIRD'S GAMES - THE NETWORK BRIDGE (firebase.js)
 * ==============================================================================
 * Role: Initializes the Firebase Realtime Database connection.
 * Responsibilities:
 * 1. Store the public Firebase configuration keys.
 * 2. Initialize the Firebase app instance.
 * 3. Export the `db` reference so `multiplayer.js` and Cartridges can sync state.
 * * * Developer Note: It is inherently safe for these config keys to be visible in 
 * frontend client code. Firebase relies on Realtime Database Security Rules 
 * (configured in the Firebase Console) to protect the data, not key secrecy. 
 * Ensure your rules restrict writes to the `rooms/` node appropriately.
 * ==============================================================================
 */

// ==========================================
// PHASE 1: FIREBASE CONFIGURATION
// ==========================================
// These keys connect the static frontend to the Yardbird Firebase project.
const firebaseConfig = {
    apiKey: "AIzaSyAK-y072g7RmxEXt438H6Votoci6T4S9uQ",
    authDomain: "yardbird-song-trivia.firebaseapp.com",
    projectId: "yardbird-song-trivia",
    storageBucket: "yardbird-song-trivia.firebasestorage.app",
    messagingSenderId: "707080141874",
    appId: "1:707080141874:web:7a48da42643bc46f69d02b",
    databaseURL: "https://yardbird-song-trivia-default-rtdb.firebaseio.com" 
};


// ==========================================
// PHASE 2: INITIALIZATION & EXPORT
// ==========================================
// System Note: This initialization relies on the Firebase SDK scripts being 
// loaded sequentially via CDN in `index.html`. If the global `firebase` object 
// is ever undefined, check the <script> tags in the document head.

firebase.initializeApp(firebaseConfig);

// Export the Realtime Database instance.
// This `db` object is imported by `multiplayer.js` to create/join lobbies,
// and by Cartridges (like Consensus or Fast Math) to broadcast round data to phones.
export const db = firebase.database();
