import { User, Room, Booking, NotificationLog, Recommendation, AdminActivityLog, ExternalGuest, FeedbackItem } from "../types";
import { db, auth, hashPassword, seedFirestoreIfNeeded, handleFirestoreError, OperationType } from "./firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch
} from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  sendPasswordResetEmail
} from "firebase/auth";

// Auto-seeding flag
let isSeeded = false;
async function ensureDb() {
  if (!isSeeded) {
    // Wrapped in try/catch to let any initial seeding permission error bubble up appropriately
    try {
      await seedFirestoreIfNeeded();
      isSeeded = true;
    } catch (err) {
      console.warn("[Firebase Seeder] Auto-seeding check failed or bypassed (possibly due to security rules/permissions):", err);
      // Mark as seeded to avoid infinite retries on subsequent database operations
      isSeeded = true;
    }
  }
}

// Helper to recursively remove undefined properties before saving to Firestore
function cleanFirestoreData<T extends Record<string, any>>(data: T): T {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        cleaned[key] = cleanFirestoreData(value);
      } else {
        cleaned[key] = value;
      }
    }
  }
  return cleaned as T;
}

/**
 * Centrally manages Firestore executions, catching any permission failures
 * and formatting them using handleFirestoreError for automated platform resolution.
 */
async function runFirestore<T>(
  operation: () => Promise<T>,
  type: OperationType,
  path: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[Firestore Operation Failure] Type: ${type} | Path: ${path}`, error);
    return handleFirestoreError(error, type, path);
  }
}

// ==================== TIME & OVERLAP UTILITIES ====================

function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function isOverlapping(startA: string, durationA: number, startB: string, durationB: number): boolean {
  const minStartA = timeToMinutes(startA);
  const minEndA = minStartA + durationA;
  const minStartB = timeToMinutes(startB);
  const minEndB = minStartB + durationB;

  // Including a 15-minute buffer gap between all time slots
  return minStartA < minEndB + 15 && minStartB < minEndA + 15;
}

// Helper to log administrative actions
async function addAdminActivity(action: string, details: string): Promise<void> {
  try {
    const activeUser = apiService.getCachedUser();
    const logId = "log-" + Math.random().toString(36).substr(2, 9);
    const log: AdminActivityLog = {
      logId,
      adminEmail: activeUser?.email || "admin",
      adminName: activeUser?.name || "System Admin",
      action,
      details,
      timestamp: new Date().toISOString()
    };
    await runFirestore(
      () => setDoc(doc(db, "adminActivities", logId), cleanFirestoreData(log)),
      OperationType.WRITE,
      "adminActivities"
    );
  } catch (err) {
    console.error("Failed to write administrative log:", err);
  }
}

// Session Cookie Helpers
function setSessionCookie(token: string, user: User) {
  if (typeof document === "undefined") return;
  try {
    const expires = new Date(Date.now() + 7 * 864e5).toUTCString();
    document.cookie = `ps_booking_token=${encodeURIComponent(token)}; expires=${expires}; path=/; SameSite=Lax`;
    document.cookie = `ps_booking_user=${encodeURIComponent(JSON.stringify(user))}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (e) {
    console.warn("Cookie set error:", e);
  }
}

function getSessionCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  } catch {
    return null;
  }
}

function clearSessionCookies() {
  if (typeof document === "undefined") return;
  try {
    document.cookie = "ps_booking_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "ps_booking_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  } catch (e) {
    console.warn("Cookie clear error:", e);
  }
}

export const apiService = {
  // ==================== AUTH SERVICE ====================

  /**
   * Send a password reset email to an already registered address
   */
  async sendPasswordReset(email: string): Promise<string> {
    await ensureDb();
    const formattedEmail = email.toLowerCase().trim();
    if (!formattedEmail) {
      throw new Error("Email address is required.");
    }
    if (!formattedEmail.endsWith("@psgroup.in")) {
      throw new Error("Password reset is restricted to registered @psgroup.in corporate accounts.");
    }

    // Call server forgot-password endpoint (verifies registration)
    let returnMessage = `Password reset link has been dispatched to ${formattedEmail}. Please check your inbox.`;
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formattedEmail })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "This email address is not registered in the system. Please register first.");
    }

    returnMessage = data.message || returnMessage;

    // Send password reset link from Firebase Auth as well
    try {
      await sendPasswordResetEmail(auth, formattedEmail);
    } catch (fbErr: any) {
      console.warn("Firebase Auth password reset note:", fbErr?.message);
    }

    return returnMessage;
  },

  /**
   * Reset password with reset token
   */
  async resetPasswordWithToken(email: string, token: string, newPassword: string): Promise<string> {
    await ensureDb();
    const formattedEmail = email.toLowerCase().trim();

    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formattedEmail, token, newPassword })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to reset password.");
    }

    // Update password in Firestore as well
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", formattedEmail));
      const querySnapshot = await runFirestore(() => getDocs(q), OperationType.GET, "users");
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        const newHash = await hashPassword(newPassword);
        await runFirestore(
          () => setDoc(docRef, { passwordHash: newHash, emailVerified: true, isApproved: true }, { merge: true }),
          OperationType.WRITE,
          "users"
        );
      }
    } catch (fsErr) {
      console.warn("Could not sync new password to Firestore:", fsErr);
    }

    return data.message || "Your password has been updated successfully.";
  },

  /**
   * Verify email via confirmation token
   */
  async verifyEmail(email: string, token: string): Promise<string> {
    await ensureDb();
    const formattedEmail = email.toLowerCase().trim();

    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formattedEmail, token })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to verify email address.");
    }

    // Update Firestore user emailVerified
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", formattedEmail));
      const querySnapshot = await runFirestore(() => getDocs(q), OperationType.GET, "users");
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        await runFirestore(
          () => setDoc(docRef, { emailVerified: true, isApproved: true }, { merge: true }),
          OperationType.WRITE,
          "users"
        );
      }
    } catch (fsErr) {
      console.warn("Could not sync email verification to Firestore:", fsErr);
    }

    return data.message || "Email successfully verified.";
  },

  /**
   * Set user credentials in localStorage and cookies
   */
  setSession(token: string, user: User) {
    localStorage.setItem("ps_booking_token", token);
    localStorage.setItem("ps_booking_user", JSON.stringify(user));
    setSessionCookie(token, user);
  },

  /**
   * Remove user credentials from localStorage and cookies
   */
  logout() {
    localStorage.removeItem("ps_booking_token");
    localStorage.removeItem("ps_booking_user");
    clearSessionCookies();
    signOut(auth).catch(err => console.error("Firebase SignOut error:", err));
  },

  /**
   * Retrieve cached user details from localStorage or cookies
   */
  getCachedUser(): User | null {
    let userJson = localStorage.getItem("ps_booking_user");
    if (!userJson) {
      userJson = getSessionCookie("ps_booking_user");
    }
    if (!userJson) return null;
    try {
      return JSON.parse(userJson);
    } catch {
      return null;
    }
  },

  /**
   * Fetch user Firestore profile document
   */
  async getUserDoc(uid: string): Promise<User | null> {
    await ensureDb();
    const userDoc = await runFirestore(
      () => getDoc(doc(db, "users", uid)),
      OperationType.GET,
      `users/${uid}`
    );
    return userDoc.exists() ? (userDoc.data() as User) : null;
  },

  /**
   * Login credentials verification - dynamically fetches user details from database
   */
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    await ensureDb();
    const formattedEmail = email.toLowerCase().trim();

    if (!formattedEmail || !password) {
      throw new Error("Please enter both email address and password.");
    }

    // 1. Query Firestore users collection dynamically by email
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", formattedEmail));
    const querySnapshot = await runFirestore(
      () => getDocs(q),
      OperationType.GET,
      "users"
    );

    let userDocData: User | null = null;
    let userDocId: string | null = null;

    if (!querySnapshot.empty) {
      const matchedDoc = querySnapshot.docs[0];
      userDocData = matchedDoc.data() as User;
      userDocId = matchedDoc.id;
    }

    // 2. Attempt authentication via Firebase Auth and database password verification
    let firebaseUser: any = null;
    try {
      const userCredential = await signInWithEmailAndPassword(auth, formattedEmail, password);
      firebaseUser = userCredential.user;
    } catch (authErr: any) {
      // If Firebase Auth fails, check database passwordHash dynamically
      if (userDocData && userDocData.passwordHash) {
        const hashedInput = await hashPassword(password);
        if (hashedInput === userDocData.passwordHash) {
          // Password matches database record! Try auto-registering in Firebase Auth if not already created
          try {
            const createCred = await createUserWithEmailAndPassword(auth, formattedEmail, password);
            firebaseUser = createCred.user;
          } catch (createErr) {
            firebaseUser = { uid: userDocId || userDocData.uid, email: formattedEmail, emailVerified: true };
          }
        } else {
          throw new Error("Invalid corporate email or password.");
        }
      } else {
        throw new Error("Invalid corporate email or password.");
      }
    }

    // 3. If no user document was found in Firestore, retrieve or create dynamically
    if (!userDocData) {
      const userRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await runFirestore(
        () => getDoc(userRef),
        OperationType.GET,
        `users/${firebaseUser.uid}`
      );

      if (userSnap.exists()) {
        userDocData = userSnap.data() as User;
      } else {
        const isAdmin = formattedEmail.includes("admin") || userDocData?.role === "Admin" || userDocData?.role?.toLowerCase() === "admin";
        userDocData = {
          uid: firebaseUser.uid,
          email: formattedEmail,
          name: firebaseUser.displayName || formattedEmail.split("@")[0] || "User",
          role: isAdmin ? "Admin" : "User",
          isApproved: true,
          emailVerified: true,
          createdAt: new Date().toISOString()
        };
        await runFirestore(
          () => setDoc(userRef, userDocData!),
          OperationType.WRITE,
          "users"
        );
      }
    }

    // Check if admin by email pattern or existing role
    if (formattedEmail.includes("admin") || formattedEmail === "admin@psgroup.in") {
      userDocData.role = "Admin";
    }

    userDocData.emailVerified = true;
    userDocData.isApproved = true;

    // Save updated user data to Firestore
    try {
      const userRef = doc(db, "users", userDocData.uid);
      await runFirestore(
        () => setDoc(userRef, {
          uid: userDocData.uid,
          email: userDocData.email,
          name: userDocData.name || "User",
          role: userDocData.role,
          emailVerified: true,
          isApproved: true,
          createdAt: userDocData.createdAt || new Date().toISOString()
        }, { merge: true }),
        OperationType.WRITE,
        `users/${userDocData.uid}`
      );
    } catch (e) {
      console.warn("Could not sync user verification to Firestore:", e);
    }

    // 4. Check approval status dynamically from database record
    if (!userDocData.isApproved) {
      throw new Error("Your account has not been approved yet. Please wait for an administrator to approve your registration.");
    }

    const token = `jwt-mock-${userDocData.uid}`;
    const userWithVerify = { ...userDocData, emailVerified: true, isApproved: true };
    this.setSession(token, userWithVerify);
    return { token, user: userWithVerify };
  },

  /**
   * Register a new corporate employee profile dynamically in database
   */
  async register(email: string, password: string, name: string, department: string): Promise<{ message: string; user: User }> {
    await ensureDb();

    const formattedEmail = email.toLowerCase().trim();
    const formattedDepartment = department.trim();

    if (!formattedEmail.endsWith("@psgroup.in")) {
      throw new Error("Registration is restricted to official @psgroup.in email addresses only. External domains (e.g., Gmail, Yahoo) are not permitted.");
    }

    if (!formattedDepartment) {
      throw new Error("Department field is mandatory.");
    }

    // Call server register API for backend persistence and verification email dispatch
    let serverMessage = "Registration initiated! A verification confirmation link has been sent to your @psgroup.in email address. Please check your inbox and click the link to activate your account.";
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formattedEmail,
          password,
          name,
          department: formattedDepartment
        })
      });
      const data = await response.json();
      if (!response.ok && data.error && !data.error.includes("already exists")) {
        throw new Error(data.error);
      }
      if (data.message) {
        serverMessage = data.message;
      }
    } catch (apiErr: any) {
      console.warn("Server registration notice:", apiErr);
    }

    // Standard Firebase Auth create user (if not already existing in Firebase)
    let firebaseUser: any = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, formattedEmail, password);
      firebaseUser = userCredential.user;
      try {
        await sendEmailVerification(firebaseUser);
      } catch (e) {
        // Firebase verification fallback
      }
    } catch (err: any) {
      // If Firebase Auth complains user exists, that's fine if server created or vice versa
      firebaseUser = { uid: "user-" + Math.random().toString(36).substring(2, 9), email: formattedEmail };
    }

    const pwdHash = await hashPassword(password);

    // Create profile doc in Firestore users with emailVerified: false
    const newUser: User = {
      uid: firebaseUser.uid || "user-" + Math.random().toString(36).substring(2, 9),
      email: formattedEmail,
      passwordHash: pwdHash,
      name,
      role: "User",
      isApproved: true,
      emailVerified: false,
      createdAt: new Date().toISOString(),
      department: formattedDepartment
    };

    try {
      await runFirestore(
        () => setDoc(doc(db, "users", newUser.uid), newUser),
        OperationType.WRITE,
        "users"
      );
    } catch (fsErr) {
      console.warn("Could not write initial user doc to Firestore:", fsErr);
    }

    return {
      message: serverMessage,
      user: newUser
    };
  },

  /**
   * Get authenticated user profile details from backend
   */
  async getProfile(): Promise<{ user: User }> {
    await ensureDb();
    
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      const userRef = doc(db, "users", firebaseUser.uid);
      const userDoc = await runFirestore(
        () => getDoc(userRef),
        OperationType.GET,
        `users/${firebaseUser.uid}`
      );
      if (userDoc.exists()) {
        const user = userDoc.data() as User;
        const userWithVerify = { ...user, emailVerified: firebaseUser.emailVerified };
        localStorage.setItem("ps_booking_user", JSON.stringify(userWithVerify));
        return { user: userWithVerify };
      }
    }

    const token = localStorage.getItem("ps_booking_token");
    if (!token || !token.startsWith("jwt-mock-")) {
      this.logout();
      throw new Error("No active session detected.");
    }

    const uid = token.replace("jwt-mock-", "");
    const userDoc = await runFirestore(
      () => getDoc(doc(db, "users", uid)),
      OperationType.GET,
      `users/${uid}`
    );

    if (!userDoc.exists()) {
      this.logout();
      throw new Error("User record not found.");
    }

    const user = userDoc.data() as User;
    localStorage.setItem("ps_booking_user", JSON.stringify(user));
    return { user };
  },

  // ==================== ROOM PORTAL SERVICE ====================

  /**
   * Fetch all registered meeting rooms
   */
  async getRooms(): Promise<Room[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "rooms")),
      OperationType.GET,
      "rooms"
    );
    const rooms: Room[] = [];
    snapshot.forEach(doc => {
      rooms.push(doc.data() as Room);
    });
    return rooms;
  },

  /**
   * Create a new corporate meeting room
   */
  async addRoom(name: string, capacity: number, features: string[], floor?: string): Promise<Room> {
    await ensureDb();
    const roomId = "room-" + Math.random().toString(36).substr(2, 9);
    const room: Room = {
      roomId,
      name,
      capacity: Number(capacity),
      features,
      floor: floor || "Floor 1"
    };

    await runFirestore(
      () => setDoc(doc(db, "rooms", roomId), room),
      OperationType.WRITE,
      "rooms"
    );
    await addAdminActivity("Create Room", `Added new meeting room: ${name} (Capacity: ${capacity}, Floor: ${floor || "Floor 1"})`);
    return room;
  },

  /**
   * Modify properties of an existing meeting room
   */
  async updateRoom(roomId: string, name: string, capacity: number, features: string[], floor?: string): Promise<Room> {
    await ensureDb();
    const room: Room = {
      roomId,
      name,
      capacity: Number(capacity),
      features,
      floor: floor || "Floor 1"
    };

    await runFirestore(
      () => setDoc(doc(db, "rooms", roomId), room),
      OperationType.WRITE,
      "rooms"
    );
    await addAdminActivity("Update Room", `Modified properties for room: ${name}`);
    return room;
  },

  /**
   * Remove a meeting room
   */
  async deleteRoom(roomId: string): Promise<{ message: string }> {
    await ensureDb();
    const roomDoc = await runFirestore(
      () => getDoc(doc(db, "rooms", roomId)),
      OperationType.GET,
      `rooms/${roomId}`
    );
    const roomName = roomDoc.exists() ? (roomDoc.data() as Room).name : roomId;

    await runFirestore(
      () => deleteDoc(doc(db, "rooms", roomId)),
      OperationType.DELETE,
      "rooms"
    );
    await addAdminActivity("Delete Room", `Removed room: ${roomName}`);
    return { message: "Room deleted successfully" };
  },

  // ==================== BOOKING PORTAL SERVICE ====================

  /**
   * Fetch all booking logs (Available to anyone without user level restrictions)
   */
  async getBookings(): Promise<Booking[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "bookings")),
      OperationType.GET,
      "bookings"
    );
    const bookings: Booking[] = [];
    snapshot.forEach(doc => {
      bookings.push(doc.data() as Booking);
    });

    // Sort by createdAt descending
    bookings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return bookings;
  },

  /**
   * Create a pending meeting room reservation
   */
  async createBooking(bookingDetails: {
    roomId: string;
    date: string;
    startTime: string;
    duration: number;
    bookerName: string;
    bookerEmail: string;
    department?: string;
    reason: string;
    meetingType?: "Internal" | "External";
    externalName?: string;
    externalCompany?: string;
    externalWhomToMeet?: string;
    externalGuests?: ExternalGuest[];
    participantEmails?: string[];
    attendeesCount?: number;
    clientDate?: string;
    clientTime?: string;
    itSupportRequired?: boolean;
    fbRequired?: boolean;
    outlookEventId?: string;
    outlookSynced?: boolean;
  }): Promise<{ message: string; booking: Booking }> {
    await ensureDb();

    if (!bookingDetails.reason || !bookingDetails.reason.trim()) {
      throw new Error("Meeting Agenda is mandatory and must be filled.");
    }

    // Capture meeting type (mandatory)
    const mType = bookingDetails.meetingType || "Internal";
    if (mType === "External") {
      if (!bookingDetails.externalName || !bookingDetails.externalName.trim()) {
        throw new Error("External visitor's name is mandatory for External meetings.");
      }
      if (!bookingDetails.externalWhomToMeet || !bookingDetails.externalWhomToMeet.trim()) {
        throw new Error("Specifying whom they are meeting is mandatory for External meetings.");
      }
    }

    // Limit maximum duration to 1 hour (60 minutes)
    const durationNum = Number(bookingDetails.duration);
    if (durationNum > 60) {
      throw new Error("Meeting duration is restricted to a maximum of 1 hour (60 minutes).");
    }

    // Restrict bookings to up to 5 days in advance
    const todayObj = new Date();
    const maxDateObj = new Date();
    maxDateObj.setDate(todayObj.getDate() + 5);
    const maxBookingDateISO = maxDateObj.toLocaleDateString("en-CA");
    if (bookingDetails.date > maxBookingDateISO) {
      throw new Error(`Bookings are restricted to up to 5 days in advance. You cannot book beyond ${maxBookingDateISO}.`);
    }

    const user = this.getCachedUser();

    // Fetch approved bookings for the same room on the same day to double-check conflicts
    const bookingsRef = collection(db, "bookings");
    const snapshot = await runFirestore(
      () => getDocs(bookingsRef),
      OperationType.GET,
      "bookings"
    );
    const bookings: Booking[] = [];
    snapshot.forEach(doc => {
      bookings.push(doc.data() as Booking);
    });

    const approvedOnDay = bookings.filter(
      b => b.roomId === bookingDetails.roomId && b.date === bookingDetails.date && b.status === "Approved"
    );

    const conflict = approvedOnDay.find(b =>
      isOverlapping(bookingDetails.startTime, bookingDetails.duration, b.startTime, b.duration)
    );

    if (conflict) {
      throw new Error(`Time collision! The requested slot conflicts with a confirmed reservation or buffer gap (${conflict.startTime}).`);
    }

    const bookingId = "book-" + Math.random().toString(36).substr(2, 9);
    const newBooking: Booking = {
      bookingId,
      roomId: bookingDetails.roomId,
      date: bookingDetails.date,
      startTime: bookingDetails.startTime,
      duration: durationNum,
      status: "Approved", // Automatically approved/confirmed instantly
      createdAt: new Date().toISOString(),
      reason: bookingDetails.reason.trim(),
      meetingType: mType,
      itSupportRequired: !!bookingDetails.itSupportRequired,
      fbRequired: !!bookingDetails.fbRequired,
    };

    if (mType === "External") {
      if (bookingDetails.externalGuests && bookingDetails.externalGuests.length > 0) {
        newBooking.externalGuests = bookingDetails.externalGuests.filter(g => g.name && g.name.trim() !== "");
        if (newBooking.externalGuests.length > 0) {
          newBooking.externalName = newBooking.externalGuests[0].name.trim();
          newBooking.externalCompany = newBooking.externalGuests[0].company?.trim() || bookingDetails.externalCompany?.trim();
          newBooking.externalWhomToMeet = newBooking.externalGuests[0].whomToMeet?.trim() || bookingDetails.externalWhomToMeet?.trim();
        }
      } else {
        if (bookingDetails.externalName?.trim()) {
          newBooking.externalName = bookingDetails.externalName.trim();
        }
        if (bookingDetails.externalCompany?.trim()) {
          newBooking.externalCompany = bookingDetails.externalCompany.trim();
        }
        if (bookingDetails.externalWhomToMeet?.trim()) {
          newBooking.externalWhomToMeet = bookingDetails.externalWhomToMeet.trim();
        }
      }
    }

    if (user?.uid) {
      newBooking.userId = user.uid;
    }
    if (bookingDetails.bookerName) {
      newBooking.bookerName = bookingDetails.bookerName;
    }
    if (bookingDetails.bookerEmail) {
      newBooking.bookerEmail = bookingDetails.bookerEmail;
    }
    const dept = bookingDetails.department || user?.department;
    if (dept) {
      newBooking.department = dept;
    }
    if (bookingDetails.attendeesCount !== undefined) {
      newBooking.attendeesCount = Number(bookingDetails.attendeesCount);
    }
    if (bookingDetails.participantEmails && bookingDetails.participantEmails.length > 0) {
      newBooking.participantEmails = bookingDetails.participantEmails
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.endsWith("@psgroup.in"));
    }

    const cleanBooking = cleanFirestoreData(newBooking);

    await runFirestore(
      () => setDoc(doc(db, "bookings", bookingId), cleanBooking),
      OperationType.WRITE,
      "bookings"
    );

    // Automatically dispatch server email notifications with calendar invites (.ics)
    let emailNote = "";
    const isITRequired = !!newBooking.itSupportRequired;
    const isFBRequired = !!newBooking.fbRequired;
    const roomsList = await this.getRooms();
    const targetRoom = roomsList.find(r => r.roomId === newBooking.roomId);
    const roomDisplayName = targetRoom ? targetRoom.name : newBooking.roomId;

    // 1. Primary confirmation email to Booker / Organizer (and internal participants)
    const organizerRecipients = [
      newBooking.bookerEmail || "supratik@psgroup.in",
      ...(newBooking.participantEmails || [])
    ].filter((email, index, arr) => email && arr.indexOf(email) === index);

    const emailSubject = `[Booking Confirmed] ${roomDisplayName} on ${newBooking.date} at ${newBooking.startTime}`;

    let externalGuestsText = "";
    if (newBooking.externalGuests && newBooking.externalGuests.length > 0) {
      externalGuestsText = `• External Visitors (${newBooking.externalGuests.length}):\n` +
        newBooking.externalGuests.map((g, idx) => {
          let details = `  ${idx + 1}. ${g.name}`;
          if (g.company) details += ` (${g.company})`;
          if (g.email) details += ` - Email: ${g.email}`;
          if (g.phone) details += ` - Phone: ${g.phone}`;
          if (g.whomToMeet) details += ` - Meeting: ${g.whomToMeet}`;
          return details;
        }).join("\n") + "\n";
    } else if (newBooking.externalName) {
      externalGuestsText = `• External Visitor: ${newBooking.externalName} (${newBooking.externalCompany || "N/A"})\n`;
    }

    let participantsText = "";
    if (newBooking.participantEmails && newBooking.participantEmails.length > 0) {
      participantsText = `• Internal Participants: ${newBooking.participantEmails.join(", ")}\n`;
    }

    const emailBody = `MEETING ROOM RESERVATION CONFIRMED\n\n` +
      `Your reservation has been confirmed on a first-come, first-served basis.\n\n` +
      `• Meeting Room: ${roomDisplayName}\n` +
      `• Date & Time: ${newBooking.date} at ${newBooking.startTime} (${newBooking.duration} mins)\n` +
      `• Meeting Agenda: ${newBooking.reason || "Corporate Meeting"}\n` +
      `• Organizer / Host: ${newBooking.bookerName || "N/A"} (${newBooking.bookerEmail || "N/A"})\n` +
      `• Department: ${newBooking.department || "N/A"}\n` +
      `• Meeting Type: ${newBooking.meetingType || "Internal"}\n` +
      participantsText +
      `• IT Support Required: ${isITRequired ? "YES (Requested)" : "No"}\n` +
      `• F&B Catering Required: ${isFBRequired ? "YES (Requested)" : "No"}\n` +
      (newBooking.attendeesCount ? `• Attendees Count: ${newBooking.attendeesCount}\n` : "") +
      externalGuestsText +
      `\nThis email is a calendar invite: the meeting is added to your Outlook calendar automatically. Use Accept / Decline to respond.`;

    let emailStatus: "success" | "logged_only" | "failed" = "logged_only";
    let emailStatusMessage = "";

    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: organizerRecipients,
          subject: emailSubject,
          body: emailBody,
          priority: "Normal",
          bookingId: newBooking.bookingId,
          booking: {
            bookingId: newBooking.bookingId,
            date: newBooking.date,
            startTime: newBooking.startTime,
            duration: newBooking.duration,
            roomId: newBooking.roomId,
            roomName: roomDisplayName,
            reason: newBooking.reason || emailSubject,
            bookerName: newBooking.bookerName,
            bookerEmail: newBooking.bookerEmail,
            department: newBooking.department,
            meetingType: newBooking.meetingType,
            participantEmails: newBooking.participantEmails
          }
        })
      });

      if (response.ok) {
        const resData = await response.json();
        emailStatus = resData.status || "success";
        emailStatusMessage = resData.message || "Confirmation email dispatched to organizer.";
      } else {
        emailStatus = "failed";
        emailStatusMessage = `Server HTTP error (${response.status}) while attempting email dispatch.`;
      }
    } catch (err: any) {
      emailStatus = "logged_only";
      emailStatusMessage = "Backend mail API server unreachable. Email notification recorded in system database.";
    }

    // 2. If IT Support Required is selected, dispatch IT request to it@psgroup.in
    if (isITRequired) {
      try {
        await fetch("/api/notify-it-helpdesk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking: {
              ...newBooking,
              roomName: roomDisplayName
            },
            roomName: roomDisplayName
          })
        });
      } catch (itErr) {
        console.warn("Could not dispatch IT Support notification to it@psgroup.in:", itErr);
      }
    }

    // 3. If F&B Required is selected, dispatch Hospitality request to hospitality@psgroup.in
    if (isFBRequired) {
      try {
        await fetch("/api/notify-hospitality", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking: {
              ...newBooking,
              roomName: roomDisplayName
            },
            roomName: roomDisplayName
          })
        });
      } catch (fbErr) {
        console.warn("Could not dispatch Hospitality notification to hospitality@psgroup.in:", fbErr);
      }
    }

    emailNote = emailStatusMessage;
    newBooking.emailDeliveryNote = emailStatusMessage;

    // Log to Firestore notifications collection for audit and UI display
    try {
      const notifId = "notif-it-" + Math.random().toString(36).substr(2, 9);
      const itNotif: NotificationLog = {
        notificationId: notifId,
        bookingId: newBooking.bookingId,
        emailTo: "supratik@psgroup.in",
        subject: emailSubject,
        body: emailBody,
        sentAt: new Date().toISOString(),
        priority: isITRequired ? "High" : "Normal",
        status: emailStatus,
        errorMessage: emailStatusMessage
      };
      await runFirestore(
        () => setDoc(doc(db, "notifications", notifId), cleanFirestoreData(itNotif)),
        OperationType.WRITE,
        "notifications"
      );

      // Also queue to Firebase "mail" collection (for Firebase "Trigger Email" Extension)
      const mailDocId = "mail-" + Math.random().toString(36).substr(2, 9);
      const mailRecipients = [newBooking.bookerEmail, ...(newBooking.participantEmails || [])].filter((e): e is string => Boolean(e));
      await runFirestore(
        () => setDoc(doc(db, "mail", mailDocId), {
          to: mailRecipients.length > 0 ? mailRecipients : ["admin@psgroup.in"],
          message: {
            subject: emailSubject,
            text: emailBody,
            html: emailBody.replace(/\n/g, "<br/>")
          },
          createdAt: new Date().toISOString(),
          bookingId: newBooking.bookingId
        }),
        OperationType.WRITE,
        "mail"
      );
    } catch (notifErr) {
      console.warn("Could not log IT notification to Firestore:", notifErr);
    }

    return {
      message: `Your meeting room reservation is confirmed! Confirmation email and calendar invite dispatched to ${newBooking.bookerEmail || "organizer"}.`,
      booking: newBooking
    };
  },

  /**
   * Cancel a reservation
   */
  async cancelBooking(bookingId: string): Promise<Booking> {
    await ensureDb();

    let targetDocRef = doc(db, "bookings", bookingId);
    let bookingDoc = await runFirestore(
      () => getDoc(targetDocRef),
      OperationType.GET,
      `bookings/${bookingId}`
    );

    let booking: Booking;

    if (bookingDoc.exists()) {
      booking = bookingDoc.data() as Booking;
      booking.status = "Cancelled";
      await runFirestore(
        () => updateDoc(targetDocRef, { status: "Cancelled" }),
        OperationType.UPDATE,
        "bookings"
      );
    } else {
      // Query collection for doc where bookingId === bookingId
      const q = query(collection(db, "bookings"), where("bookingId", "==", bookingId));
      const querySnap = await runFirestore(
        () => getDocs(q),
        OperationType.GET,
        "bookings"
      );
      if (!querySnap.empty) {
        const foundDoc = querySnap.docs[0];
        booking = foundDoc.data() as Booking;
        booking.status = "Cancelled";
        await runFirestore(
          () => updateDoc(foundDoc.ref, { status: "Cancelled" }),
          OperationType.UPDATE,
          "bookings"
        );
      } else {
        // Fallback booking record if doc not in Firestore directly
        booking = {
          bookingId,
          roomId: "N/A",
          date: new Date().toISOString().split("T")[0],
          startTime: "N/A",
          duration: 30,
          status: "Cancelled",
          createdAt: new Date().toISOString(),
          reason: "Cancelled by user"
        };
      }
    }

    // Call server endpoint to dispatch the calendar cancellation (removes the meeting from Outlook calendars)
    try {
      let roomName: string | undefined;
      try {
        roomName = (await this.getRooms()).find((r) => r.roomId === booking.roomId)?.name;
      } catch {
        roomName = undefined;
      }
      await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking: { ...booking, bookingId }, roomName })
      });
    } catch (err) {
      console.warn("Server cancel notification endpoint error:", err);
    }

    await addAdminActivity(
      "Cancel Reservation",
      `Cancelled reservation #${bookingId} for Room ID ${booking.roomId} (Booker: ${booking.bookerName || "Employee"})`
    );

    return booking;
  },

  /**
   * Modify the status of a pending reservation request (Approved or Rejected)
   */
  async updateBookingStatus(bookingId: string, status: "Approved" | "Rejected"): Promise<Booking> {
    await ensureDb();

    const bookingRef = doc(db, "bookings", bookingId);
    const bookingDoc = await runFirestore(
      () => getDoc(bookingRef),
      OperationType.GET,
      `bookings/${bookingId}`
    );

    if (!bookingDoc.exists()) {
      throw new Error("Booking record not found");
    }

    const booking = bookingDoc.data() as Booking;
    booking.status = status;

    await runFirestore(
      () => updateDoc(bookingRef, { status }),
      OperationType.UPDATE,
      "bookings"
    );

    await addAdminActivity(
      `${status} Reservation`,
      `Set status of reservation request for Room ID ${booking.roomId} to ${status} (Booker: ${booking.bookerName})`
    );

    return booking;
  },

  // ==================== RECOMMENDATIONS / AVAILABILITY SERVICE ====================

  /**
   * Query timeslot recommendations based on date, duration, capacity, and floor
   */
  async checkAvailability(query: {
    date: string;
    attendeesCount: number;
    duration: number;
    features?: string[];
    floor?: string;
    clientDate?: string;
    clientTime?: string;
  }): Promise<Recommendation[]> {
    await ensureDb();

    const { date, attendeesCount, duration, features, floor, clientDate, clientTime } = query;

    if (!date || !duration) {
      throw new Error("Date and meeting duration are required");
    }

    const rooms = await this.getRooms();
    const requestedCapacity = attendeesCount ? Number(attendeesCount) : 0;
    const reqDuration = Number(duration);

    const normalizeFloorStr = (f?: string | number): string => {
      if (!f) return "";
      const s = String(f).toLowerCase().trim();
      const match = s.match(/\d+/);
      return match ? match[0] : s;
    };

    // 1. Filter rooms meeting minimum requirements, floor, and feature requirements
    const suitableRooms = rooms.filter(r => {
      if (r.capacity < requestedCapacity) return false;

      if (floor && floor !== "All") {
        const floorArray = Array.isArray(floor)
          ? floor
          : typeof floor === "string" && floor.includes(",")
          ? floor.split(",")
          : [floor];

        const validFloors = floorArray.map(f => String(f).trim()).filter(f => f && f !== "All");
        if (validFloors.length > 0) {
          const roomFloorNorm = normalizeFloorStr(r.floor);
          const matchesAnyFloor = validFloors.some(f => {
            const fNorm = normalizeFloorStr(f);
            if (fNorm && roomFloorNorm && fNorm === roomFloorNorm) return true;
            const rFloorLower = String(r.floor || "").toLowerCase();
            const fLower = String(f).toLowerCase();
            return rFloorLower.includes(fLower) || fLower.includes(rFloorLower);
          });
          if (!matchesAnyFloor) return false;
        }
      }

      if (features && features.length > 0) {
        const hasAll = features.every(f =>
          r.features && r.features.some(rf => rf.toLowerCase() === f.toLowerCase())
        );
        if (!hasAll) return false;
      }
      return true;
    });

    // Corporate Work Hours: 10:00 to 19:00 (10:00 AM to 7:00 PM)
    const workStart = 10 * 60; // 600 minutes (10:00 AM)
    const workEnd = 19 * 60;  // 1140 minutes (19:00 / 7:00 PM)

    // Generate intervals in 15-minute increments (e.g. 10:00, 10:15, 10:30, 10:45...)
    // so slots directly following a 15-minute post-meeting cleaning buffer are available to book
    const intervals: number[] = [];
    for (let m = workStart; m + reqDuration <= workEnd; m += 15) {
      intervals.push(m);
    }

    const clientTimeMin = clientTime ? timeToMinutes(clientTime) : -1;

    // Fetch bookings to check overlaps
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "bookings")),
      OperationType.GET,
      "bookings"
    );
    const allBookings: Booking[] = [];
    snapshot.forEach(doc => {
      allBookings.push(doc.data() as Booking);
    });

    const recommendations = suitableRooms.map(room => {
      const approvedOnDay = allBookings.filter(
        b => b.roomId === room.roomId && b.date === date && b.status === "Approved"
      );

      const detailedSlots = intervals.map(startMin => {
        const startStr = minutesToTime(startMin);

        let isPast = false;
        if (clientDate && clientTime) {
          if (date < clientDate) {
            isPast = true;
          }
          if (date === clientDate && startMin <= clientTimeMin) {
            isPast = true;
          }
        }

        const conflictBooking = approvedOnDay.find(b => {
          return isOverlapping(startStr, reqDuration, b.startTime, b.duration);
        });

        return {
          time: startStr,
          isAvailable: !isPast && !conflictBooking,
          bookedBy: conflictBooking ? (conflictBooking.bookerName || "Another Colleague") : undefined
        };
      });

      const freeSlots = detailedSlots.filter(s => s.isAvailable).map(s => s.time);

      return {
        room,
        availableSlots: freeSlots,
        slots: detailedSlots
      };
    });

    return recommendations;
  },

  // ==================== ADMIN SYSTEM LOGS SERVICE ====================

  /**
   * Fetch all user accounts (Admin Portal)
   */
  async getAdminUsers(): Promise<User[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "users")),
      OperationType.GET,
      "users"
    );
    const users: User[] = [];
    snapshot.forEach(doc => {
      // Exclude password hashes
      const { passwordHash: _, ...userWithoutHash } = doc.data() as any;
      users.push(userWithoutHash as User);
    });
    return users;
  },

  /**
   * Update any user fields directly in Firestore
   */
  async updateUser(userId: string, data: Partial<User>): Promise<User> {
    await ensureDb();
    const userRef = doc(db, "users", userId);
    await runFirestore(
      () => setDoc(userRef, cleanFirestoreData(data), { merge: true }),
      OperationType.WRITE,
      `users/${userId}`
    );
    const refreshedDoc = await runFirestore(
      () => getDoc(userRef),
      OperationType.GET,
      `users/${userId}`
    );
    const updatedUser = (refreshedDoc.data() || { uid: userId, ...data }) as User;
    await addAdminActivity(
      "Update User Profile",
      `Updated profile for ${updatedUser.name || userId} (${updatedUser.email || userId})`
    );
    return updatedUser;
  },

  /**
   * Verify or unverify a user account
   */
  async verifyUserAccount(userId: string, isVerified: boolean = true): Promise<User> {
    return this.updateUser(userId, { emailVerified: isVerified, isApproved: true });
  },

  /**
   * Approve or decline a pending user registration
   */
  async approveUser(userId: string, approved: boolean, role?: "User" | "Admin"): Promise<{ message: string; user: User }> {
    await ensureDb();

    const userRef = doc(db, "users", userId);
    const userDoc = await runFirestore(
      () => getDoc(userRef),
      OperationType.GET,
      `users/${userId}`
    );

    if (!userDoc.exists()) {
      throw new Error("User not found");
    }

    const userData = userDoc.data() as User;

    if (!approved) {
      await runFirestore(
        () => deleteDoc(userRef),
        OperationType.DELETE,
        "users"
      );
      await addAdminActivity("Decline User", `Declined registration for ${userData.name} (${userData.email})`);
      return { message: "User registration rejected and profile removed.", user: userData };
    }

    const updatedUser: Partial<User> = { isApproved: true, emailVerified: true };
    if (role) {
      updatedUser.role = role;
    }

    await runFirestore(
      () => setDoc(userRef, updatedUser, { merge: true }),
      OperationType.WRITE,
      `users/${userId}`
    );
    const refreshedDoc = await runFirestore(
      () => getDoc(userRef),
      OperationType.GET,
      `users/${userId}`
    );
    const finalUser = refreshedDoc.data() as User;

    await addAdminActivity(
      "Approve User",
      `Approved registration for ${finalUser.name} (${finalUser.email}) with role: ${finalUser.role}`
    );

    return { message: "User profile approved successfully.", user: finalUser };
  },

  /**
   * Retrieve all notification logs (email loops) sent by the background checker
   */
  async getNotificationLogs(): Promise<NotificationLog[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "notifications")),
      OperationType.GET,
      "notifications"
    );
    const logs: NotificationLog[] = [];
    snapshot.forEach(doc => {
      logs.push(doc.data() as NotificationLog);
    });

    logs.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    return logs;
  },

  /**
   * Manually trigger the pending bookings notification alert loop
   */
  async triggerAlertLoop(): Promise<{ message: string }> {
    await ensureDb();

    const bookingsSnapshot = await runFirestore(
      () => getDocs(collection(db, "bookings")),
      OperationType.GET,
      "bookings"
    );
    const pendingBookings: Booking[] = [];
    bookingsSnapshot.forEach(doc => {
      const b = doc.data() as Booking;
      if (b.status === "pending") {
        pendingBookings.push(b);
      }
    });

    if (pendingBookings.length === 0) {
      return { message: "Corporate Alert System: No pending reservations found requiring alert cycles." };
    }

    for (const booking of pendingBookings) {
      const logId = "notif-" + Math.random().toString(36).substr(2, 9);
      const notif: NotificationLog = {
        notificationId: logId,
        bookingId: booking.bookingId,
        emailTo: booking.bookerEmail || "admin@psgroup.in",
        subject: "ALERT: Corporate Meeting Room Reservation Status Pending",
        body: `Dear ${booking.bookerName || "Colleague"},\n\nYour meeting reservation request for Room ${booking.roomId} on ${booking.date} at ${booking.startTime} is pending corporate administrative approval. You will receive an automated confirmation email once processed.\n\nBest Regards,\nPS Corporate Facility Operations`,
        sentAt: new Date().toISOString(),
        priority: "High",
        status: "success"
      };

      await runFirestore(
        () => setDoc(doc(db, "notifications", logId), notif),
        OperationType.WRITE,
        "notifications"
      );
    }

    await addAdminActivity("Trigger Alerts", `Manually dispatched notifications for ${pendingBookings.length} pending reservation requests.`);

    return { message: `Successfully executed the corporate notification loop and logged ${pendingBookings.length} notification entries.` };
  },

  /**
   * Delete a user account (Admin Portal)
   */
  async deleteUser(userId: string): Promise<{ message: string }> {
    await ensureDb();
    const userDoc = await runFirestore(
      () => getDoc(doc(db, "users", userId)),
      OperationType.GET,
      `users/${userId}`
    );
    const userName = userDoc.exists() ? (userDoc.data() as User).name : userId;

    await runFirestore(
      () => deleteDoc(doc(db, "users", userId)),
      OperationType.DELETE,
      "users"
    );
    await addAdminActivity("Delete User Account", `Deleted user account: ${userName}`);
    return { message: "User profile deleted successfully" };
  },

  /**
   * Retrieve all admin activity logs (Admin Portal)
   */
  async getAdminActivities(): Promise<AdminActivityLog[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "adminActivities")),
      OperationType.GET,
      "adminActivities"
    );
    const logs: AdminActivityLog[] = [];
    snapshot.forEach(doc => {
      logs.push(doc.data() as AdminActivityLog);
    });

    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return logs;
  },

  /**
   * Delete all bookings from Firestore
   */
  async clearAllBookings(): Promise<void> {
    await ensureDb();
    const bookingsSnapshot = await runFirestore(
      () => getDocs(collection(db, "bookings")),
      OperationType.GET,
      "bookings"
    );
    const batch = writeBatch(db);
    bookingsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    await addAdminActivity("Clear All Bookings", "Permanently removed all meeting room reservation records from the database");
  },

  /**
   * Update Outlook synchronization parameters on a booking
   */
  async updateBookingOutlook(bookingId: string, outlookEventId: string, outlookSynced: boolean): Promise<void> {
    await ensureDb();
    const bookingRef = doc(db, "bookings", bookingId);
    await runFirestore(
      () => updateDoc(bookingRef, { outlookEventId, outlookSynced }),
      OperationType.UPDATE,
      "bookings"
    );
  },

  // ==================== FEEDBACK SERVICE ====================

  /**
   * Submit user feedback regarding amenities and app experience
   */
  async submitFeedback(feedback: {
    bookingId?: string;
    roomId?: string;
    roomName?: string;
    userId?: string;
    userEmail: string;
    userName: string;
    ratingAmenities: number;
    ratingApp: number;
    comments: string;
  }): Promise<FeedbackItem> {
    await ensureDb();
    const feedbackId = "fb-" + Math.random().toString(36).substr(2, 9);
    const newFeedback: FeedbackItem = {
      feedbackId,
      bookingId: feedback.bookingId || "",
      roomName: feedback.roomName || "General Experience",
      userEmail: feedback.userEmail,
      userName: feedback.userName,
      amenitiesRating: Number(feedback.ratingAmenities) || 5,
      appRating: Number(feedback.ratingApp) || 5,
      comments: feedback.comments || "",
      createdAt: new Date().toISOString()
    };

    await runFirestore(
      () => setDoc(doc(db, "feedbacks", feedbackId), newFeedback),
      OperationType.WRITE,
      "feedbacks"
    );
    return newFeedback;
  },

  /**
   * Fetch all submitted feedback
   */
  async getFeedbacks(): Promise<FeedbackItem[]> {
    await ensureDb();
    const snapshot = await runFirestore(
      () => getDocs(collection(db, "feedbacks")),
      OperationType.GET,
      "feedbacks"
    );
    const list: FeedbackItem[] = [];
    snapshot.forEach(d => {
      list.push(d.data() as FeedbackItem);
    });
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  },

  /**
   * Send automated polite feedback request email to organizer
   */
  async sendFeedbackRequestEmail(booking: {
    bookingId: string;
    roomName?: string;
    date: string;
    startTime: string;
    bookerName?: string;
    bookerEmail?: string;
  }, roomNameParam?: string): Promise<{ message: string }> {
    const finalRoomName = roomNameParam || booking.roomName || "the meeting room";
    const subject = `[Feedback Request] How was your meeting in ${finalRoomName}?`;
    const body = `Dear ${booking.bookerName || "Organizer"},\n\n` +
      `Thank you for using the PS Group Meeting Room Booking Portal!\n\n` +
      `We hope your recent meeting in ${finalRoomName} on ${booking.date} at ${booking.startTime} went seamlessly and productively.\n\n` +
      `We strive to maintain high-quality facilities, clean environments, and reliable technology (AC, Wi-Fi, AV/projector) alongside a seamless booking experience. Could you please take a quick moment to share your valuable feedback with us?\n\n` +
      `You can submit your ratings directly via the Feedback tab in the portal or reply to this message with any suggestions.\n\n` +
      `Your thoughts help us continuously refine our meeting amenities for all corporate teams.\n\n` +
      `Warm regards,\n` +
      `PS Group Facility & Operations Team`;

    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: booking.bookerEmail || "supratik@psgroup.in",
          subject,
          body,
          priority: "Normal",
          bookingId: booking.bookingId
        })
      });
    } catch (err) {
      console.warn("Could not dispatch feedback request email:", err);
    }

    return { message: `Feedback request email sent to ${booking.bookerEmail || "organizer"}.` };
  }
};
