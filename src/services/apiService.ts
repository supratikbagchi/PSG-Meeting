// Browser client for the multi-tenant API (/api/v1). All data access goes through the server, which checks
// the Firebase ID token, the caller's organisation and role, and the subscription. The browser never talks
// to Firestore directly.
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase";
import type {
  AdminActivityLog, Booking, ExternalGuest, FeedbackItem, NotificationLog, Org, OrgInvite, OrgSettings,
  PlanTier, PlatformOrg, Recommendation, Room, Session, User,
} from "../types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

const API_BASE = ((import.meta as any).env?.VITE_API_URL || "").replace(/\/$/, "") + "/api/v1";

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError("Please sign in.", 401, "unauthenticated");
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status, data?.code);
  return data as T;
}

function verificationSettings() {
  return { url: `${window.location.origin}/`, handleCodeInApp: false };
}

export const apiService = {
  // ------------------------------------------------------------------ authentication (Firebase)

  async login(email: string, password: string): Promise<void> {
    const e = email.toLowerCase().trim();
    if (!e || !password) throw new Error("Please enter both email address and password.");
    await signInWithEmailAndPassword(auth, e, password);
  },

  async register(email: string, password: string, name: string): Promise<{ message: string }> {
    const e = email.toLowerCase().trim();
    const cred = await createUserWithEmailAndPassword(auth, e, password);
    if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() }).catch(() => undefined);
    await sendEmailVerification(cred.user, verificationSettings()).catch(() => undefined);
    return { message: `We've sent a verification link to ${e}. Open it, then come back and continue.` };
  },

  async resendVerification(): Promise<void> {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser, verificationSettings());
  },

  /** Reloads the Firebase user and forces a fresh ID token so the server sees the verified flag. */
  async refreshVerification(): Promise<boolean> {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
    return !!auth.currentUser.emailVerified;
  },

  async sendPasswordReset(email: string): Promise<string> {
    const e = email.toLowerCase().trim();
    if (!e) throw new Error("Please enter your email address.");
    await sendPasswordResetEmail(auth, e, verificationSettings());
    return "If an account exists for that address, a reset link is on its way.";
  },

  async logout(): Promise<void> {
    await signOut(auth).catch(() => undefined);
  },

  // ------------------------------------------------------------------ session & onboarding

  getSession: () => request<Session>("GET", "/me"),

  createOrg: (input: { name: string; yourName: string; tier: PlanTier; department?: string; timezone?: string }) =>
    request<{ org: Org; user: User }>("POST", "/orgs", input),

  joinDomainOrg: (input: { orgId: string; name: string; department?: string }) =>
    request<{ org: Org; user: User }>("POST", "/org/join", input),

  getInvite: (token: string) =>
    request<{ orgName: string; email: string; role: string; matchesYou: boolean }>("GET", `/invites/${encodeURIComponent(token)}`),

  acceptInvite: (token: string, input: { name: string; department?: string }) =>
    request<{ org: Org; user: User }>("POST", `/invites/${encodeURIComponent(token)}/accept`, input),

  // ------------------------------------------------------------------ organisation (admin)

  getOrg: () => request<Org>("GET", "/org"),

  updateOrg: (patch: Partial<Omit<Org, "settings" | "subscription">> & { settings?: Partial<OrgSettings> }) =>
    request<Org>("PATCH", "/org", patch),

  getInvites: () => request<OrgInvite[]>("GET", "/org/invites"),

  createInvite: (email: string, role: "admin" | "member") =>
    request<OrgInvite>("POST", "/org/invites", { email, role }),

  revokeInvite: (token: string) => request<{ message: string }>("DELETE", `/org/invites/${encodeURIComponent(token)}`),

  // ------------------------------------------------------------------ rooms

  getRooms: () => request<Room[]>("GET", "/rooms"),

  addRoom: (name: string, capacity: number, features: string[], floor?: string) =>
    request<Room>("POST", "/rooms", { name, capacity, features, floor }),

  updateRoom: (roomId: string, name: string, capacity: number, features: string[], floor?: string) =>
    request<Room>("PUT", `/rooms/${encodeURIComponent(roomId)}`, { name, capacity, features, floor }),

  deleteRoom: (roomId: string) => request<{ message: string }>("DELETE", `/rooms/${encodeURIComponent(roomId)}`),

  // ------------------------------------------------------------------ bookings

  getBookings: () => request<Booking[]>("GET", "/bookings"),

  createBooking: (details: {
    roomId: string;
    date: string;
    startTime: string;
    duration: number;
    department?: string;
    reason: string;
    meetingType?: "Internal" | "External";
    externalName?: string;
    externalCompany?: string;
    externalWhomToMeet?: string;
    externalGuests?: ExternalGuest[];
    participantEmails?: string[];
    attendeesCount?: number;
    itSupportRequired?: boolean;
    fbRequired?: boolean;
    [extra: string]: unknown;
  }) => {
    if (!details.reason?.trim()) throw new Error("Meeting Agenda is mandatory and must be filled.");
    return request<{ message: string; booking: Booking }>("POST", "/bookings", details);
  },

  cancelBooking: (bookingId: string) => request<Booking>("POST", `/bookings/${encodeURIComponent(bookingId)}/cancel`),

  updateBookingStatus: (bookingId: string, status: "Approved" | "Rejected") =>
    request<Booking>("PATCH", `/bookings/${encodeURIComponent(bookingId)}/status`, { status }),

  updateBookingOutlook: (bookingId: string, outlookEventId: string, outlookSynced: boolean) =>
    request<void>("PATCH", `/bookings/${encodeURIComponent(bookingId)}/outlook`, { outlookEventId, outlookSynced }),

  checkAvailability: (query: { date: string; attendeesCount: number; duration: number; features?: string[]; floor?: string }) =>
    request<Recommendation[]>("POST", "/availability", query),

  clearAllBookings: () => request<{ message: string }>("DELETE", "/bookings"),

  // ------------------------------------------------------------------ members (admin)

  getAdminUsers: () => request<User[]>("GET", "/org/members"),

  updateUser: (userId: string, data: { name?: string; department?: string; role?: "User" | "Admin"; status?: "active" | "disabled" }) =>
    request<User>("PATCH", `/org/members/${encodeURIComponent(userId)}`, data),

  async approveUser(userId: string, approved: boolean, role?: "User" | "Admin"): Promise<{ message: string; user: User }> {
    const user = await request<User>("PATCH", `/org/members/${encodeURIComponent(userId)}`, {
      status: approved ? "active" : "disabled",
      ...(role ? { role } : {}),
    });
    return { message: approved ? "Access approved." : "Access disabled.", user };
  },

  deleteUser: (userId: string) => request<{ message: string }>("DELETE", `/org/members/${encodeURIComponent(userId)}`),

  // ------------------------------------------------------------------ logs & feedback

  getNotificationLogs: () => request<NotificationLog[]>("GET", "/notifications"),

  getAdminActivities: () => request<AdminActivityLog[]>("GET", "/activity"),

  submitFeedback: (f: { bookingId?: string; roomName?: string; ratingAmenities: number; ratingApp: number; comments: string; [extra: string]: unknown }) =>
    request<FeedbackItem>("POST", "/feedback", f),

  getFeedbacks: () => request<FeedbackItem[]>("GET", "/feedback"),

  sendFeedbackRequestEmail: (booking: { bookingId: string }, _roomName?: string) =>
    request<{ message: string }>("POST", `/bookings/${encodeURIComponent(booking.bookingId)}/feedback-request`),

  // ------------------------------------------------------------------ platform (SaaS operator)

  platformListOrgs: () => request<PlatformOrg[]>("GET", "/platform/orgs"),

  platformUpdateSubscription: (orgId: string, patch: { tier?: PlanTier; status?: string; currentPeriodEnd?: string | null; trialEndsAt?: string | null }) =>
    request<{ orgId: string }>("PATCH", `/platform/orgs/${encodeURIComponent(orgId)}/subscription`, patch),

  platformMigrateLegacy: (input: {
    orgId: string; orgName: string; ownerEmail: string; emailDomains: string[]; dryRun: boolean;
    tier?: PlanTier; notifications?: Record<string, string>; departments?: string[]; trustedSeededEmails?: string[];
  }) => request<any>("POST", "/platform/migrate-legacy", input),
};
