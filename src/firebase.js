/* ------------------------------------------------------------------
   firebase.js — Firestore backend for Feasible

   Each device signs in anonymously and gets its own Firebase user ID.
   All of that user's data lives in a single document:  users/{uid}

   Setup (five minutes):
   1. console.firebase.google.com  ->  Add project
   2. Build > Authentication > Get started > Sign-in method
        -> enable "Anonymous"
   3. Build > Firestore Database > Create database
        -> Start in production mode, pick asia-south1 (Mumbai)
   4. Rules tab, paste this, Publish:

        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /users/{uid} {
              allow read, write: if request.auth != null
                                && request.auth.uid == uid;
            }
          }
        }

   5. Project settings > Your apps > Web (</>) > register
        -> copy the firebaseConfig object below
   6. npm install firebase
------------------------------------------------------------------- */

import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
  initializeFirestore, persistentLocalCache,
} from "firebase/firestore";

/* ---- PASTE YOUR CONFIG HERE ---- */
const firebaseConfig = {
  apiKey: "AIzaSyARybum3tFZ2vDWf9sOOCzDdRpsXksBE6Q",
  authDomain: "feasible-23260.firebaseapp.com",
  projectId: "feasible-23260",
  storageBucket: "feasible-23260.firebasestorage.app",
  messagingSenderId: "969615005304",
  appId: "1:969615005304:web:621795448cc726bf3c3f8d",
};

let app, auth, db, uidPromise;

function init() {
  if (app) return;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // persistentLocalCache keeps the app working with no internet and
  // syncs automatically once the connection comes back
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch (e) {
    db = getFirestore(app);
  }
}

/* Resolves to this device's user id, signing in anonymously if needed */
function getUid() {
  if (uidPromise) return uidPromise;
  init();
  uidPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("auth timeout")), 12000);
    onAuthStateChanged(auth, (user) => {
      if (user) {
        clearTimeout(timeout);
        resolve(user.uid);
      }
    });
    signInAnonymously(auth).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  return uidPromise;
}

/* Read this device's saved state, or null if there isn't one yet */
export async function cloudLoad() {
  const uid = await getUid();
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data?.state ?? null;
}

/* Write the whole state document */
export async function cloudSave(state) {
  const uid = await getUid();
  await setDoc(
    doc(db, "users", uid),
    { state, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/* Useful for the sync indicator and for the viva */
export async function cloudUser() {
  return getUid();
}
