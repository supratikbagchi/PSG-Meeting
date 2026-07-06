import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  writeBatch
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  // Try to retrieve cached user session to provide rich context to the diagnostic tool
  let cachedUser: any = null;
  try {
    const userJson = localStorage.getItem("ps_booking_user");
    if (userJson) {
      cachedUser = JSON.parse(userJson);
    }
  } catch {}

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: cachedUser?.uid || null,
      email: cachedUser?.email || null,
      emailVerified: cachedUser ? true : null,
      isAnonymous: false,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };

  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * PBKDF2 password hasher matching Node's pbkdf2Sync exactly.
 * Uses Web Crypto API (supported by all modern browsers).
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const salt = encoder.encode("psgroup_salt");
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 1000,
      hash: "SHA-512"
    },
    passwordKey,
    512 // 64 bytes * 8 bits
  );

  const hashArray = Array.from(new Uint8Array(derivedBits));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Automatically seeds Firestore if it's empty, ensuring the portal is fully operational immediately.
 */
export async function seedFirestoreIfNeeded(): Promise<void> {
  try {
    const roomsRef = collection(db, "rooms");
    const snapshot = await getDocs(roomsRef);
    if (!snapshot.empty) {
      // Already seeded
      return;
    }

    console.log("[Firebase Seeder] Seeding database with initial corporate rooms and admin credentials...");
    const batch = writeBatch(db);

    // Initial Rooms
    const initialRooms = [
      {
        roomId: "room-1",
        name: "Boardroom Alpha",
        capacity: 12,
        features: ["Projector", "Video Conferencing", "Whiteboard", "AC"]
      },
      {
        roomId: "room-2",
        name: "Collaboration Hub",
        capacity: 8,
        features: ["Smart TV", "Whiteboard", "Glass Wall"]
      },
      {
        roomId: "room-3",
        name: "Focus Pod A",
        capacity: 4,
        features: ["High-speed Wi-Fi", "Whiteboard"]
      },
      {
        roomId: "room-4",
        name: "Executive Conference Room",
        capacity: 15,
        features: ["4K TV", "Conference Phone", "Whiteboard", "Catering Desk"]
      }
    ];

    for (const room of initialRooms) {
      const roomDoc = doc(db, "rooms", room.roomId);
      batch.set(roomDoc, room);
    }

    // Initial Users
    const initialUsers = [
      {
        uid: "admin-1",
        email: "admin@psgroup.in",
        passwordHash: "99efc65a4cd680d9d546711aa388dcf0df952ae7ce80c5d6b50cbb8eeaa241dab4a9b8504b2aea75b4380758a2eb21aef54f3dfb64f2d3d56b78c4ca96f9d67d", // hash of 'nowyouseeme'
        name: "PS Group Admin",
        role: "Admin",
        isApproved: true,
        createdAt: "2026-07-05T10:02:28.336Z"
      },
      {
        uid: "user-1",
        email: "user@psgroup.in",
        passwordHash: "de8ca3f2141c30c3739b512c96ca9abef1238a495019d812121ee4963bf2faa05c3357a28278b6db5d9ddc08fbaf85f7a503cd58f8b385d4bb2ce39db1030ddd", // hash of 'nowyouseeme'
        name: "Supratik Bagchi",
        role: "User",
        isApproved: true,
        createdAt: "2026-07-05T10:02:28.336Z"
      },
      {
        uid: "user-pending",
        email: "pending@psgroup.in",
        passwordHash: "de8ca3f2141c30c3739b512c96ca9abef1238a495019d812121ee4963bf2faa05c3357a28278b6db5d9ddc08fbaf85f7a503cd58f8b385d4bb2ce39db1030ddd", // hash of 'nowyouseeme'
        name: "John Doe",
        role: "User",
        isApproved: false,
        createdAt: "2026-07-05T10:02:28.337Z"
      }
    ];

    for (const user of initialUsers) {
      const userDoc = doc(db, "users", user.uid);
      batch.set(userDoc, user);
    }

    await batch.commit();
    console.log("[Firebase Seeder] Seeding completed successfully!");
  } catch (error) {
    console.error("[Firebase Seeder] Error seeding database, forwarding to platform handler:", error);
    handleFirestoreError(error, OperationType.WRITE, "rooms");
  }
}
