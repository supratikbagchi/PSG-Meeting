import { User, Room, Booking, NotificationLog, Recommendation, AdminActivityLog } from "../types";
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
  where
} from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut
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

  return minStartA < minEndB && minStartB < minEndA;
}

// Helper to log administrative actions
async function addAdminActivity(action: string, details: string): Promise<void> {
  try {
    const activeUser = apiService.getCachedUser();
    const logId = "log-" + Math.random().toString(36).substr(2, 9);
    const log: AdminActivityLog = {
      logId,
      adminEmail: activeUser?.email || "admin@psgroup.in",
      adminName: activeUser?.name || "PS Group Admin",
      action,
      details,
      timestamp: new Date().toISOString()
    };
    await runFirestore(
      () => setDoc(doc(db, "adminActivities", logId), log),
      OperationType.WRITE,
      "adminActivities"
    );
  } catch (err) {
    console.error("Failed to write administrative log:", err);
  }
}

export const apiService = {
  // ==================== AUTH SERVICE ====================

  /**
   * Set user credentials in localStorage
   */
  setSession(token: string, user: User) {
    localStorage.setItem("ps_booking_token", token);
    localStorage.setItem("ps_booking_user", JSON.stringify(user));
  },

  /**
   * Remove user credentials from localStorage
   */
  logout() {
    localStorage.removeItem("ps_booking_token");
    localStorage.removeItem("ps_booking_user");
    signOut(auth).catch(err => console.error("Firebase SignOut error:", err));
  },

  /**
   * Retrieve cached user details
   */
  getCachedUser(): User | null {
    const userJson = localStorage.getItem("ps_booking_user");
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
   * Login credentials verification
   */
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    await ensureDb();
    const formattedEmail = email.toLowerCase().trim();

    // Standard Firebase Auth sign in
    let userCredential;
    try {
      userCredential = await signInWithEmailAndPassword(auth, formattedEmail, password);
    } catch (err: any) {
      // If the seeded users don't exist in Firebase Auth yet, try auto-creating them
      if (
        (formattedEmail === "admin@psgroup.in" && password === "admin123") ||
        (formattedEmail === "user@psgroup.in" && password === "user123") ||
        (formattedEmail === "pending@psgroup.in" && password === "user123")
      ) {
        try {
          userCredential = await createUserWithEmailAndPassword(auth, formattedEmail, password);
        } catch (createErr) {
          throw err;
        }
      } else {
        throw new Error(err.message || "Invalid credentials");
      }
    }

    const firebaseUser = userCredential.user;

    // Retrieve user document from Firestore users collection
    const userRef = doc(db, "users", firebaseUser.uid);
    let userSnap = await runFirestore(
      () => getDoc(userRef),
      OperationType.GET,
      `users/${firebaseUser.uid}`
    );

    let user: User;
    if (userSnap.exists()) {
      user = userSnap.data() as User;
    } else {
      // Create user doc if not present
      const isPendingEmail = formattedEmail === "pending@psgroup.in";
      user = {
        uid: firebaseUser.uid,
        email: formattedEmail,
        name: formattedEmail === "admin@psgroup.in" ? "PS Group Admin" : "Supratik Bagchi",
        role: formattedEmail === "admin@psgroup.in" ? "Admin" : "User",
        isApproved: !isPendingEmail,
        createdAt: new Date().toISOString()
      };
      await runFirestore(
        () => setDoc(userRef, user),
        OperationType.WRITE,
        "users"
      );
    }

    const token = `jwt-mock-${user.uid}`;
    const userWithVerify = { ...user, emailVerified: firebaseUser.emailVerified };
    this.setSession(token, userWithVerify);
    return { token, user: userWithVerify };
  },

  /**
   * Register a new corporate employee profile
   */
  async register(email: string, password: string, name: string): Promise<{ message: string; user: User }> {
    await ensureDb();

    const formattedEmail = email.toLowerCase().trim();

    // Domain validation
    if (!formattedEmail.endsWith("@psgroup.in")) {
      throw new Error("Registration is restricted to PS Group employees only. Email must end with '@psgroup.in'.");
    }

    // Standard Firebase Auth create user
    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, formattedEmail, password);
    } catch (err: any) {
      throw new Error(err.message || "Registration failed. Account may already exist.");
    }

    const firebaseUser = userCredential.user;

    // Trigger email verification
    try {
      await sendEmailVerification(firebaseUser);
    } catch (err: any) {
      console.error("Failed to send verification email:", err);
    }

    // Create profile doc in Firestore users
    const newUser: User = {
      uid: firebaseUser.uid,
      email: formattedEmail,
      name,
      role: "User",
      isApproved: true,
      createdAt: new Date().toISOString()
    };

    await runFirestore(
      () => setDoc(doc(db, "users", firebaseUser.uid), newUser),
      OperationType.WRITE,
      "users"
    );

    const token = `jwt-mock-${firebaseUser.uid}`;
    const userWithVerify = { ...newUser, emailVerified: false };
    this.setSession(token, userWithVerify);

    return {
      message: "Registration successful. Please check your inbox to verify your account before booking.",
      user: userWithVerify
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
  async addRoom(name: string, capacity: number, features: string[]): Promise<Room> {
    await ensureDb();
    const roomId = "room-" + Math.random().toString(36).substr(2, 9);
    const room: Room = {
      roomId,
      name,
      capacity: Number(capacity),
      features
    };

    await runFirestore(
      () => setDoc(doc(db, "rooms", roomId), room),
      OperationType.WRITE,
      "rooms"
    );
    await addAdminActivity("Create Room", `Added new meeting room: ${name} (Capacity: ${capacity})`);
    return room;
  },

  /**
   * Modify properties of an existing meeting room
   */
  async updateRoom(roomId: string, name: string, capacity: number, features: string[]): Promise<Room> {
    await ensureDb();
    const room: Room = {
      roomId,
      name,
      capacity: Number(capacity),
      features
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
   * Fetch accessible booking logs (Admins see all, Users see their own)
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

    const user = this.getCachedUser();
    if (user?.role === "Admin") {
      return bookings;
    }

    // Filter to user's bookings only
    return bookings.filter(b => b.bookerEmail === user?.email || b.userId === user?.uid);
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
    attendeesCount?: number;
    clientDate?: string;
    clientTime?: string;
  }): Promise<{ message: string; booking: Booking }> {
    await ensureDb();

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
      throw new Error(`Time collision! The requested slot conflicts with a confirmed reservation (${conflict.startTime}).`);
    }

    const bookingId = "book-" + Math.random().toString(36).substr(2, 9);
    const newBooking: Booking = {
      bookingId,
      roomId: bookingDetails.roomId,
      date: bookingDetails.date,
      startTime: bookingDetails.startTime,
      duration: Number(bookingDetails.duration),
      status: "Approved", // Automatically approved/confirmed instantly
      createdAt: new Date().toISOString(),
    };

    if (user?.uid) {
      newBooking.userId = user.uid;
    }
    if (bookingDetails.bookerName) {
      newBooking.bookerName = bookingDetails.bookerName;
    }
    if (bookingDetails.bookerEmail) {
      newBooking.bookerEmail = bookingDetails.bookerEmail;
    }
    if (bookingDetails.attendeesCount !== undefined) {
      newBooking.attendeesCount = Number(bookingDetails.attendeesCount);
    }

    await runFirestore(
      () => setDoc(doc(db, "bookings", bookingId), newBooking),
      OperationType.WRITE,
      "bookings"
    );
    return {
      message: "Your instant meeting reservation is successfully booked and confirmed!",
      booking: newBooking
    };
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
   * Query 30-minute timeslot recommendations based on date, duration, and capacity
   */
  async checkAvailability(query: {
    date: string;
    attendeesCount: number;
    duration: number;
    clientDate?: string;
    clientTime?: string;
  }): Promise<Recommendation[]> {
    await ensureDb();

    const { date, attendeesCount, duration, clientDate, clientTime } = query;

    if (!date || !duration) {
      throw new Error("Date and meeting duration are required");
    }

    const rooms = await this.getRooms();
    const requestedCapacity = attendeesCount ? Number(attendeesCount) : 0;
    const reqDuration = Number(duration);

    // 1. Filter rooms meeting minimum requirements
    const suitableRooms = rooms.filter(r => r.capacity >= requestedCapacity);

    // Corporate Work Hours: 09:00 to 18:00
    const workStart = 9 * 60; // 540 minutes
    const workEnd = 18 * 60;  // 1080 minutes

    // Generate intervals
    const intervals: number[] = [];
    for (let m = workStart; m + reqDuration <= workEnd; m += 30) {
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

    const updatedUser: Partial<User> = { isApproved: true };
    if (role) {
      updatedUser.role = role;
    }

    await runFirestore(
      () => updateDoc(userRef, updatedUser),
      OperationType.UPDATE,
      "users"
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
  }
};
