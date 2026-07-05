/**
 * Firebase Configuration & Initialization
 * Provides the Firebase app and Firestore database instance used across modules.
 */
const firebaseConfig = {
    apiKey: "AIzaSyCe3E6azBZ2NGXTnROpt1gsUKUtKuq6L1Q",
    authDomain: "bycyclesafetymap.firebaseapp.com",
    projectId: "bycyclesafetymap",
    storageBucket: "bycyclesafetymap.firebasestorage.app",
    messagingSenderId: "500061164582",
    appId: "1:500061164582:web:bdbe1e94220c0b0a5382e7",
    measurementId: "G-YVNK7BL60W"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

console.log('🔥 Firebase initialized');
