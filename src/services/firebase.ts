// Firebase in the browser is used only for sign-in (Firebase Authentication).
// All data access goes through the server API (/api/v1), which uses the Admin SDK.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
