import type { Firestore, Query } from "firebase-admin/firestore";

// Minimal document-store abstraction so route logic can run against Firestore in production
// and an in-memory store in tests. Paths are Firestore-style: "orgs/{orgId}/rooms/{roomId}".

export type Where = [field: string, op: "==" | "array-contains", value: unknown];

export interface Store {
  get<T = any>(path: string): Promise<T | null>;
  set(path: string, data: Record<string, any>, opts?: { merge?: boolean }): Promise<void>;
  /** Creates the document; throws if it already exists. */
  create(path: string, data: Record<string, any>): Promise<void>;
  delete(path: string): Promise<void>;
  list<T = any>(collectionPath: string, where?: Where[]): Promise<T[]>;
  /** Deletes every document in a collection (not recursive). */
  deleteCollection(collectionPath: string): Promise<number>;
}

export class AlreadyExistsError extends Error {}

/** Removes undefined values (Firestore rejects them). */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as any;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as any)) if (v !== undefined) out[k] = clean(v);
    return out as T;
  }
  return value;
}

// ---------------- Firestore (firebase-admin) ----------------

export function createFirestoreStore(db: Firestore): Store {
  return {
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? (snap.data() as any) : null;
    },
    async set(path, data, opts) {
      await db.doc(path).set(clean(data), { merge: !!opts?.merge });
    },
    async create(path, data) {
      try {
        await db.doc(path).create(clean(data));
      } catch (e: any) {
        // gRPC ALREADY_EXISTS = 6
        if (e?.code === 6 || /already exists/i.test(String(e?.message))) throw new AlreadyExistsError(path);
        throw e;
      }
    },
    async delete(path) {
      await db.doc(path).delete();
    },
    async list(collectionPath, where = []) {
      let q: Query = db.collection(collectionPath);
      for (const [f, op, v] of where) q = q.where(f, op, v);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as any);
    },
    async deleteCollection(collectionPath) {
      const snap = await db.collection(collectionPath).get();
      let n = 0;
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
        n += Math.min(400, snap.docs.length - i);
      }
      return n;
    },
  };
}

// ---------------- In-memory (tests / local) ----------------

export function createMemoryStore(): Store & { dump(): Record<string, any> } {
  const docs = new Map<string, any>();
  const copy = (v: any) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
  const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
  return {
    async get(path) {
      return docs.has(path) ? copy(docs.get(path)) : null;
    },
    async set(path, data, opts) {
      const prev = opts?.merge && docs.has(path) ? docs.get(path) : {};
      docs.set(path, copy({ ...prev, ...clean(data) }));
    },
    async create(path, data) {
      if (docs.has(path)) throw new AlreadyExistsError(path);
      docs.set(path, copy(clean(data)));
    },
    async delete(path) {
      docs.delete(path);
    },
    async list(collectionPath, where = []) {
      const out: any[] = [];
      for (const [p, v] of docs) {
        if (parentOf(p) !== collectionPath) continue;
        const ok = where.every(([f, op, val]) =>
          op === "array-contains" ? Array.isArray(v?.[f]) && v[f].includes(val) : v?.[f] === val);
        if (ok) out.push(copy(v));
      }
      return out;
    },
    async deleteCollection(collectionPath) {
      let n = 0;
      for (const p of [...docs.keys()]) if (parentOf(p) === collectionPath) { docs.delete(p); n++; }
      return n;
    },
    dump() {
      return Object.fromEntries(docs);
    },
  };
}
