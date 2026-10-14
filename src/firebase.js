/* ------------------------------------------------------------------
   firebase.js — Firestore backend for Feasible

   Each device signs in anonymously and gets its own Firebase user ID.
   All of that user's data lives in a single document:  users/{uid}

   Setup (five minutes):
   1. console.firebase.google.com  ->  Add project
   2. Build > Authentication > Get started > Sign-in method
        -> enable "Anonymous"
        -> also enable "Email/Password" (needed by the Login screen)
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
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  linkWithCredential, EmailAuthProvider, sendPasswordResetEmail, signOut,
} from "firebase/auth";
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

let app, auth, db, anonPromise;

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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("auth timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/* Resolves to the current user's id, signing in anonymously if nobody is
   signed in. It reads the live auth user on every call, so it follows
   sign-in and sign-out. A failed attempt is never cached, so the next
   save simply tries again. */
async function getUid() {
  init();
  await withTimeout(auth.authStateReady(), 12000);
  if (auth.currentUser) return auth.currentUser.uid;
  if (!anonPromise) {
    anonPromise = signInAnonymously(auth).finally(() => { anonPromise = null; });
  }
  const cred = await withTimeout(anonPromise, 12000);
  return cred.user.uid;
}

/* ---------------------------- accounts ----------------------------
   The app works without an account (anonymous user per device). These
   let someone attach an email + password so their plan follows them to
   another device.
   Email/Password must be switched on in the Firebase console:
   Build > Authentication > Sign-in method > Email/Password.            */

const publicUser = (u) =>
  u ? { uid: u.uid, email: u.email ?? null, isAnonymous: u.isAnonymous } : null;

/* Who is signed in right now, once the stored session has been restored:
   { uid, email, isAnonymous } or null. Used at launch to decide whether to
   show the login screen. */
export async function currentAccount() {
  init();
  await withTimeout(auth.authStateReady(), 12000);
  return publicUser(auth.currentUser);
}

/* cb gets { uid, email, isAnonymous } or null. Returns an unsubscribe fn. */
export function watchAccount(cb) {
  init();
  return onAuthStateChanged(auth, (u) => cb(publicUser(u)));
}

export async function signInWithEmail(email, password) {
  init();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return publicUser(cred.user);
}

/* From an anonymous session the email is *linked* to the same user, so the
   plan already saved under that user id carries over untouched. */
export async function registerWithEmail(email, password) {
  init();
  try { await getUid(); } catch (e) { /* offline: fall through */ }
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    const cred = await linkWithCredential(current, EmailAuthProvider.credential(email, password));
    return publicUser(cred.user);
  }
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return publicUser(cred.user);
}

export async function sendReset(email) {
  init();
  await sendPasswordResetEmail(auth, email);
}

export async function signOutAccount() {
  init();
  await signOut(auth);
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
