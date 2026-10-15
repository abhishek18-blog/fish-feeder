import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  // Explicitly set the database URL for the Asia region
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Initialize Firebase App safely
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Realtime Database
const database = getDatabase(app);

// Initialize Cloud Firestore
const firestore = getFirestore(app);

// ---------------------------------------------------------------------------
// Safe Firebase Authentication Service (SDK + Firebase REST + RTDB fallback)
// Avoids top-level getAuth() call that triggers "[runtime not ready]:
// Component auth has not been registered yet" in React Native 0.86 / Expo 57.
// Automatically persists auth session permanently across app restarts.
// ---------------------------------------------------------------------------

import { saveStoredUser, getStoredUser, clearStoredUser } from "../utils/authStorage";

let currentUser = null;
let isRestoringAuth = false;
let hasCheckedStorage = false;
const authListeners = new Set();

function notifyAuthListeners(user) {
  currentUser = user;
  if (user) {
    saveStoredUser(user).catch(() => {});
  } else {
    clearStoredUser().catch(() => {});
  }
  authListeners.forEach((cb) => {
    try {
      cb(user);
    } catch (e) {
      // ignore listener errors
    }
  });
}

function emailToKey(email) {
  return email.trim().toLowerCase().replace(/[.#$[\]/]/g, "_");
}

function simpleHash(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Subscribe to authentication state changes (just like onAuthStateChanged)
 * Checks persistent storage so signed-in users never have to log in again.
 */
export function subscribeAuth(callback) {
  authListeners.add(callback);

  if (hasCheckedStorage) {
    setTimeout(() => callback(currentUser), 0);
  } else if (!isRestoringAuth) {
    isRestoringAuth = true;
    getStoredUser()
      .then((stored) => {
        isRestoringAuth = false;
        hasCheckedStorage = true;
        if (stored && (stored.uid || stored.email)) {
          currentUser = stored;
        }
        notifyAuthListeners(currentUser);
      })
      .catch(() => {
        isRestoringAuth = false;
        hasCheckedStorage = true;
        notifyAuthListeners(null);
      });
  }

  return () => authListeners.delete(callback);
}

/**
 * Create a new account using Firebase Auth REST API + Firebase Realtime Database
 */
export async function registerWithFirebase(name, email, password) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  const apiKey = firebaseConfig.apiKey;

  // 1. Try official Firebase Identity Toolkit REST API (Firebase Authentication)
  if (apiKey) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            returnSecureToken: true,
          }),
        }
      );
      const data = await res.json();

      if (res.ok && data.localId) {
        // Update displayName in Firebase Auth
        try {
          await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                idToken: data.idToken,
                displayName: cleanName,
                returnSecureToken: false,
              }),
            }
          );
        } catch (e) {
          // ignore profile update error
        }

        const userObj = {
          uid: data.localId,
          email: cleanEmail,
          displayName: cleanName,
        };

        // Also store user profile in Firebase Realtime Database
        try {
          await set(ref(database, `feeder/users/${emailToKey(cleanEmail)}`), {
            uid: userObj.uid,
            email: cleanEmail,
            displayName: cleanName,
            passwordHash: simpleHash(password),
            createdAt: Date.now(),
          });
        } catch (e) {
          // non-blocking
        }

        notifyAuthListeners(userObj);
        return userObj;
      }

      // If Firebase Auth explicitly says EMAIL_EXISTS, surface it
      const fbErr = data?.error?.message || "";
      if (fbErr.includes("EMAIL_EXISTS")) {
        const err = new Error("That email is already registered. Try logging in.");
        err.code = "auth/email-already-in-use";
        throw err;
      }
      if (fbErr.includes("INVALID_EMAIL")) {
        const err = new Error("Please enter a valid email address.");
        err.code = "auth/invalid-email";
        throw err;
      }
      if (fbErr.includes("WEAK_PASSWORD")) {
        const err = new Error("Password must be at least 6 characters.");
        err.code = "auth/weak-password";
        throw err;
      }
      // If CONFIGURATION_NOT_FOUND or OPERATION_NOT_ALLOWED (Email/Password provider not toggled in Console),
      // seamlessly fall through to Firebase Realtime Database account creation below!
    } catch (err) {
      if (err.code && err.code.startsWith("auth/")) throw err;
    }
  }

  // 2. Fallback: Firebase Realtime Database account registration (/feeder/users)
  const userKey = emailToKey(cleanEmail);
  const userRef = ref(database, `feeder/users/${userKey}`);
  const snap = await get(userRef);

  if (snap.exists()) {
    const err = new Error("That email is already registered. Try logging in.");
    err.code = "auth/email-already-in-use";
    throw err;
  }

  const uid = `user_${Date.now()}`;
  const userRecord = {
    uid,
    email: cleanEmail,
    displayName: cleanName,
    passwordHash: simpleHash(password),
    createdAt: Date.now(),
  };

  await set(userRef, userRecord);

  const userObj = {
    uid,
    email: cleanEmail,
    displayName: cleanName,
  };
  notifyAuthListeners(userObj);
  return userObj;
}

/**
 * Sign in an existing user using Firebase Auth REST API + Firebase Realtime Database
 */
export async function loginWithFirebase(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  const apiKey = firebaseConfig.apiKey;

  // 1. Try official Firebase Identity Toolkit REST API (Firebase Authentication)
  if (apiKey) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            returnSecureToken: true,
          }),
        }
      );
      const data = await res.json();

      if (res.ok && data.localId) {
        let displayName = data.displayName || cleanEmail.split("@")[0];
        // Check if we also have displayName in RTDB
        try {
          const snap = await get(ref(database, `feeder/users/${emailToKey(cleanEmail)}`));
          if (snap.exists() && snap.val()?.displayName) {
            displayName = snap.val().displayName;
          }
        } catch (e) {}

        const userObj = {
          uid: data.localId,
          email: cleanEmail,
          displayName,
        };
        notifyAuthListeners(userObj);
        return userObj;
      }

      const fbErr = data?.error?.message || "";
      if (
        fbErr.includes("INVALID_LOGIN_CREDENTIALS") ||
        fbErr.includes("INVALID_PASSWORD") ||
        fbErr.includes("EMAIL_NOT_FOUND")
      ) {
        const err = new Error("Incorrect email or password. Please try again.");
        err.code = "auth/invalid-credential";
        throw err;
      }
      if (fbErr.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
        const err = new Error("Too many attempts. Please wait a moment and try again.");
        err.code = "auth/too-many-requests";
        throw err;
      }
    } catch (err) {
      if (err.code && err.code.startsWith("auth/")) throw err;
    }
  }

  // 2. Fallback: Verify against Firebase Realtime Database (/feeder/users)
  const userKey = emailToKey(cleanEmail);
  const snap = await get(ref(database, `feeder/users/${userKey}`));

  if (!snap.exists()) {
    const err = new Error("No account found with this email. Please create an account first.");
    err.code = "auth/user-not-found";
    throw err;
  }

  const record = snap.val();
  if (record.passwordHash !== simpleHash(password)) {
    const err = new Error("Incorrect email or password. Please try again.");
    err.code = "auth/wrong-password";
    throw err;
  }

  const userObj = {
    uid: record.uid || userKey,
    email: record.email || cleanEmail,
    displayName: record.displayName || cleanEmail.split("@")[0],
  };
  notifyAuthListeners(userObj);
  return userObj;
}

/**
 * Sign out current user
 */
export async function signOutFromFirebase() {
  notifyAuthListeners(null);
}

export const db = database;
export { database, firestore, app };
export default app;
