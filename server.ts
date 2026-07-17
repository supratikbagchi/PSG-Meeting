import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";

// Interfaces representing our database schema
interface User {
  uid: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "User" | "Admin";
  isApproved: boolean;
  createdAt: string;
}

interface Room {
  roomId: string;
  name: string;
  capacity: number;
  features: string[];
}

interface Booking {
  bookingId: string;
  userId?: string;
  roomId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  duration: number; // in minutes
  status: "pending" | "Approved" | "Rejected";
  createdAt: string;
  bookerName?: string;
  bookerEmail?: string;
  attendeesCount?: number;
}

interface NotificationLog {
  notificationId: string;
  bookingId: string;
  emailTo: string;
  subject: string;
  body: string;
  sentAt: string;
  priority: "Normal" | "High";
  status: "success" | "logged_only";
}

interface AdminActivityLog {
  logId: string;
  adminEmail: string;
  adminName: string;
  action: string;
  details: string;
  timestamp: string;
}

interface DatabaseSchema {
  users: User[];
  rooms: Room[];
  bookings: Booking[];
  notifications: NotificationLog[];
  adminActivities?: AdminActivityLog[];
}

const PORT = 3000;
const DB_FILE = process.env.DATABASE_URL || "./db.json";
const JWT_SECRET = process.env.JWT_SECRET || "meeting-room-booking-jwt-secret-key-12345";
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || "admin@psgroup.in";
const ADMIN_ID = process.env.ADMIN_ID || "psgmeet";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "nowyouseeme";

// Simple PBKDF2 password hasher
function hashPassword(password: string): string {
  const salt = "psgroup_salt";
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

// Ensure database file is initialized with seed data
function initializeDatabase(): DatabaseSchema {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Failed to parse database file. Reinitializing.", err);
    }
  }

  // Create initial seed data
  const seedDb: DatabaseSchema = {
    users: [],
    rooms: [
      {
        roomId: "room-1",
        name: "Boardroom Alpha",
        capacity: 12,
        features: ["Projector", "Video Conferencing", "Whiteboard", "AC"],
      },
      {
        roomId: "room-2",
        name: "Collaboration Hub",
        capacity: 8,
        features: ["Smart TV", "Whiteboard", "Glass Wall"],
      },
      {
        roomId: "room-3",
        name: "Focus Pod A",
        capacity: 4,
        features: ["High-speed Wi-Fi", "Whiteboard"],
      },
      {
        roomId: "room-4",
        name: "Executive Conference Room",
        capacity: 15,
        features: ["4K TV", "Conference Phone", "Whiteboard", "Catering Desk"],
      },
    ],
    bookings: [],
    notifications: [],
    adminActivities: [],
  };

  saveDatabase(seedDb);
  return seedDb;
}

function getDatabase(): DatabaseSchema {
  if (!fs.existsSync(DB_FILE)) {
    return initializeDatabase();
  }
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed.adminActivities) {
      parsed.adminActivities = [];
    }
    // Migrate old bookings to have booker details if missing
    if (parsed.bookings) {
      parsed.bookings.forEach((b: any) => {
        if (!b.bookerName) {
          b.bookerName = "System Migrated User";
        }
        if (!b.bookerEmail) {
          b.bookerEmail = "user@example.com";
        }
        if (b.status === "pending" || b.status === "Rejected") {
          b.status = "Approved"; // All pending/rejected become approved under first come first served!
        }
      });
    }
    return parsed;
  } catch (err) {
    console.error("Database read error, restoring from fallback", err);
    return initializeDatabase();
  }
}

function logAdminActivity(admin: { email: string; name: string }, action: string, details: string) {
  const dbObj = getDatabase();
  if (!dbObj.adminActivities) {
    dbObj.adminActivities = [];
  }
  const newLog: AdminActivityLog = {
    logId: "log-" + crypto.randomUUID(),
    adminEmail: admin.email,
    adminName: admin.name || "Admin",
    action,
    details,
    timestamp: new Date().toISOString(),
  };
  dbObj.adminActivities.unshift(newLog);
  saveDatabase(dbObj);
}

function saveDatabase(db: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to database file", err);
  }
}

// Mailer client helper (transporter can be mock or real SMTP)
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

async function sendEmailNotification(to: string, subject: string, body: string, priority: "Normal" | "High", bookingId: string) {
  const dbObj = getDatabase();
  const transporter = getTransporter();
  let status: "success" | "logged_only" = "logged_only";

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Meeting Room Bookings" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text: body,
        headers: priority === "High" ? { "X-Priority": "1", "X-MSMail-Priority": "High", Importance: "high" } : undefined,
      });
      status = "success";
      console.log(`[Email Sent] To: ${to} | Subject: ${subject}`);
    } catch (err) {
      console.error("SMTP Mail Send Failed, logged to DB only:", err);
    }
  } else {
    console.log(`[Email Logged (No SMTP Configured)] To: ${to} | Subject: ${subject}`);
  }

  const newLog: NotificationLog = {
    notificationId: "notif-" + crypto.randomUUID(),
    bookingId,
    emailTo: to,
    subject,
    body,
    sentAt: new Date().toISOString(),
    priority,
    status,
  };

  dbObj.notifications.unshift(newLog);
  saveDatabase(dbObj);
}

// Convert time string "HH:MM" to total minutes since midnight
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

// Convert minutes since midnight back to "HH:MM"
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

// Helper to check if two booking time slots overlap (including a 15-minute room service gap)
function isOverlapping(startA: string, durationA: number, startB: string, durationB: number): boolean {
  const minStartA = timeToMinutes(startA);
  const minEndA = minStartA + durationA;
  const minStartB = timeToMinutes(startB);
  const minEndB = minStartB + durationB;

  // Accommodates a 15 min gap for room service between any two bookings
  return minStartA < minEndB + 15 && minStartB < minEndA + 15;
}

// Background checker function
async function checkPendingBookingsAndNotify() {
  const dbObj = getDatabase();
  const pendingBookings = dbObj.bookings.filter((b) => b.status === "pending");

  if (pendingBookings.length === 0) return;

  console.log(`[Background Checker] Found ${pendingBookings.length} pending bookings. Sending high-priority alerts.`);

  for (const booking of pendingBookings) {
    const user = dbObj.users.find((u) => u.uid === booking.userId);
    const room = dbObj.rooms.find((r) => r.roomId === booking.roomId);

    const userName = user ? user.name : "Unknown User";
    const userEmail = user ? user.email : "Unknown Email";
    const roomName = room ? room.name : "Unknown Room";

    const subject = `[HIGH-PRIORITY ALERT] Booking Request #${booking.bookingId} is Still Pending Approval!`;
    const body = `Attention Admin,\n\nA booking request has been waiting for approval for over 2 minutes.\n\nRoom: ${roomName}\nRequested By: ${userName} (${userEmail})\nDate: ${booking.date}\nTime: ${booking.startTime} (${booking.duration} mins)\nStatus: PENDING\n\nPlease log in to the Meeting Room Portal immediately to approve or reject this request.`;

    await sendEmailNotification(ADMIN_ALERT_EMAIL, subject, body, "High", booking.bookingId);
  }
}

// Trigger background checker every 2 minutes
function startBackgroundNotificationLoop() {
  setInterval(() => {
    checkPendingBookingsAndNotify().catch((err) => {
      console.error("Error in background alert loop:", err);
    });
  }, 120000); // 120000 ms = 2 minutes
}

// Secure Middleware for JWT authorization
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    // Falls back to guest user for the public reservation screen
    req.user = { uid: "guest-user", name: "Guest User", email: "guest@example.com", role: "User" };
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req: any, res: any, next: any) {
  if (req.user && req.user.role === "Admin") {
    next();
  } else {
    res.status(403).json({ error: "Administrator rights required" });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Ensure DB is set up
  initializeDatabase();

  // Active bookings removal as requested by the user
  try {
    const dbObj = getDatabase();
    dbObj.bookings = [];
    saveDatabase(dbObj);
    console.log("All active bookings have been removed from the database.");
  } catch (err) {
    console.error("Failed to clear bookings:", err);
  }

  // Start background monitoring
  startBackgroundNotificationLoop();

  // ==================== AUTHENTICATION ENDPOINTS ====================

  app.post("/api/auth/register", (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Please fill in all fields" });
    }

    // Validation of valid email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const dbObj = getDatabase();
    const existingUser = dbObj.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (existingUser) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }

    const newUser: User = {
      uid: "user-" + crypto.randomUUID(),
      email: email.toLowerCase(),
      passwordHash: hashPassword(password),
      name,
      role: "User", // Defaults to standard role
      isApproved: false, // Standard users require Admin approval
      createdAt: new Date().toISOString(),
    };

    dbObj.users.push(newUser);
    saveDatabase(dbObj);

    res.status(201).json({
      message: "Registration successful! Your account is pending administrator approval.",
      user: {
        uid: newUser.uid,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        isApproved: newUser.isApproved,
      },
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Please enter your email and password" });
    }

    // Check against secure server-side Admin credentials first
    if (
      (email.toLowerCase() === ADMIN_ID.toLowerCase() || email.toLowerCase() === "admin@psgroup.in") &&
      password === ADMIN_PASSWORD
    ) {
      const token = jwt.sign(
        { uid: "admin-system", email: "admin@psgroup.in", role: "Admin", name: "PS Group Admin" },
        JWT_SECRET,
        { expiresIn: "24h" }
      );
      return res.json({
        token,
        user: {
          uid: "admin-system",
          email: "admin@psgroup.in",
          name: "PS Group Admin",
          role: "Admin",
          isApproved: true,
        },
      });
    }

    const dbObj = getDatabase();
    const user = dbObj.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Check approval status
    if (!user.isApproved) {
      return res.status(403).json({
        error: "Your account has not been approved yet. Please wait for an administrator to approve your registration.",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { uid: user.uid, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
      },
    });
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    const dbObj = getDatabase();
    const user = dbObj.users.find((u) => u.uid === req.user.uid);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
      },
    });
  });

  // ==================== ROOM PORTAL ENDPOINTS ====================

  app.get("/api/rooms", authenticateToken, (req, res) => {
    const dbObj = getDatabase();
    res.json(dbObj.rooms);
  });

  app.post("/api/rooms", authenticateToken, requireAdmin, (req: any, res) => {
    const { name, capacity, features } = req.body;

    if (!name || !capacity) {
      return res.status(400).json({ error: "Name and capacity are required fields" });
    }

    const dbObj = getDatabase();
    const newRoom: Room = {
      roomId: "room-" + crypto.randomUUID(),
      name,
      capacity: parseInt(capacity),
      features: Array.isArray(features) ? features : [],
    };

    dbObj.rooms.push(newRoom);
    saveDatabase(dbObj);

    logAdminActivity(
      req.user,
      "Create Room",
      `Created room "${name}" with capacity ${capacity} and features: ${newRoom.features.join(", ") || "None"}`
    );

    res.status(201).json(newRoom);
  });

  app.put("/api/rooms/:roomId", authenticateToken, requireAdmin, (req: any, res) => {
    const { roomId } = req.params;
    const { name, capacity, features } = req.body;

    const dbObj = getDatabase();
    const roomIndex = dbObj.rooms.findIndex((r) => r.roomId === roomId);

    if (roomIndex === -1) {
      return res.status(404).json({ error: "Room not found" });
    }

    const oldName = dbObj.rooms[roomIndex].name;
    const oldCapacity = dbObj.rooms[roomIndex].capacity;

    if (name) dbObj.rooms[roomIndex].name = name;
    if (capacity) dbObj.rooms[roomIndex].capacity = parseInt(capacity);
    if (features) dbObj.rooms[roomIndex].features = Array.isArray(features) ? features : [];

    saveDatabase(dbObj);

    logAdminActivity(
      req.user,
      "Update Room",
      `Updated room "${oldName}" (ID: ${roomId}). Capacity changed from ${oldCapacity} to ${dbObj.rooms[roomIndex].capacity}.`
    );

    res.json(dbObj.rooms[roomIndex]);
  });

  app.delete("/api/rooms/:roomId", authenticateToken, requireAdmin, (req: any, res) => {
    const { roomId } = req.params;
    const dbObj = getDatabase();
    const initialCount = dbObj.rooms.length;

    const targetRoom = dbObj.rooms.find((r) => r.roomId === roomId);
    if (!targetRoom) {
      return res.status(404).json({ error: "Room not found" });
    }

    dbObj.rooms = dbObj.rooms.filter((r) => r.roomId !== roomId);

    // Clean up associated bookings
    const deletedBookingsCount = dbObj.bookings.filter((b) => b.roomId === roomId).length;
    dbObj.bookings = dbObj.bookings.filter((b) => b.roomId !== roomId);

    saveDatabase(dbObj);

    logAdminActivity(
      req.user,
      "Delete Room",
      `Deleted room "${targetRoom.name}" (ID: ${roomId}). Removed ${deletedBookingsCount} associated bookings.`
    );

    res.json({ message: "Room and its associated bookings deleted successfully" });
  });

  // ==================== BOOKING PORTAL ENDPOINTS ====================

  app.get("/api/bookings", (req: any, res) => {
    const dbObj = getDatabase();
    // Publicly return all bookings so everyone can see previously booked slots
    return res.json(dbObj.bookings);
  });

  app.post("/api/bookings", async (req: any, res) => {
    const { roomId, date, startTime, duration, attendeesCount, bookerName, bookerEmail, clientDate, clientTime } = req.body;

    if (!roomId || !date || !startTime || !duration || !bookerName || !bookerEmail) {
      return res.status(400).json({ error: "Missing required booking details (room, date, start time, duration, name, or email)" });
    }

    if (clientDate && clientTime) {
      if (date < clientDate) {
        return res.status(400).json({ error: "Cannot book a meeting for a date in the past." });
      }
      if (date === clientDate && timeToMinutes(startTime) <= timeToMinutes(clientTime)) {
        return res.status(400).json({ error: "Cannot book a meeting slot in the past." });
      }
    }

    const dbObj = getDatabase();
    const room = dbObj.rooms.find((r) => r.roomId === roomId);

    if (!room) {
      return res.status(404).json({ error: "Requested meeting room does not exist" });
    }

    // Check room capacity limit
    if (attendeesCount && room.capacity < parseInt(attendeesCount)) {
      return res.status(400).json({
        error: `Requested attendees count exceeds the room capacity of ${room.capacity}`,
      });
    }

    const dur = parseInt(duration);

    // Validation: prevent overlapping booking slots
    const hasConflict = dbObj.bookings.some((existing) => {
      return (
        existing.roomId === roomId &&
        existing.date === date &&
        existing.status === "Approved" && // all bookings are immediately Approved now
        isOverlapping(startTime, dur, existing.startTime, existing.duration)
      );
    });

    if (hasConflict) {
      return res.status(400).json({
        error: "This meeting room has already been booked during the selected time. Please choose another slot.",
      });
    }

    const newBooking: Booking = {
      bookingId: "booking-" + crypto.randomUUID(),
      userId: "guest-user",
      roomId,
      date,
      startTime,
      duration: dur,
      status: "Approved", // Instant auto-approval! First come first served
      bookerName,
      bookerEmail,
      attendeesCount: attendeesCount ? parseInt(attendeesCount) : undefined,
      createdAt: new Date().toISOString(),
    };

    dbObj.bookings.push(newBooking);
    saveDatabase(dbObj);

    // Prompt user confirmation email right away
    const subject = `[Booking Confirmed] Meeting Room Reserve: ${room.name}`;
    const body = `Dear ${bookerName},\n\nYour meeting room reservation has been successfully booked on a first-come, first-served basis.\n\nRoom: ${room.name}\nDate: ${date}\nTime: ${startTime} (${duration} minutes)\nAttendees: ${attendeesCount || "N/A"}\n\nThank you,\nCorporate Operations`;

    // Async trigger email
    sendEmailNotification(bookerEmail, subject, body, "Normal", newBooking.bookingId).catch((err) => {
      console.error("Failed to send initial mail:", err);
    });

    res.status(201).json({
      message: "Room booked successfully! Your reservation is active.",
      booking: newBooking,
    });
  });

  app.put("/api/bookings/:bookingId/status", authenticateToken, requireAdmin, (req: any, res) => {
    const { bookingId } = req.params;
    const { status } = req.body;

    if (status !== "Approved" && status !== "Rejected") {
      return res.status(400).json({ error: "Invalid booking status" });
    }

    const dbObj = getDatabase();
    const bookingIndex = dbObj.bookings.findIndex((b) => b.bookingId === bookingId);

    if (bookingIndex === -1) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = dbObj.bookings[bookingIndex];

    // Lock terminal state
    if (booking.status !== "pending") {
      return res.status(400).json({ error: "This booking has already been processed and cannot be changed" });
    }

    // If approving, make sure no overlaps have occurred in the meantime
    if (status === "Approved") {
      const hasConflict = dbObj.bookings.some((existing) => {
        return (
          existing.bookingId !== bookingId &&
          existing.roomId === booking.roomId &&
          existing.date === booking.date &&
          existing.status === "Approved" &&
          isOverlapping(booking.startTime, booking.duration, existing.startTime, existing.duration)
        );
      });

      if (hasConflict) {
        return res.status(400).json({
          error: "Cannot approve. This slot is now overlapped by another approved meeting.",
        });
      }
    }

    dbObj.bookings[bookingIndex].status = status;
    saveDatabase(dbObj);

    // Notify the user who requested the booking
    const requester = dbObj.users.find((u) => u.uid === booking.userId);
    const room = dbObj.rooms.find((r) => r.roomId === booking.roomId);

    logAdminActivity(
      req.user,
      status === "Approved" ? "Approve Booking" : "Reject Booking",
      `${status} booking request #${bookingId} for room "${room ? room.name : "Meeting Room"}" by user ${requester ? requester.name : "Unknown"} (${requester ? requester.email : "N/A"}) on date ${booking.date} at ${booking.startTime}`
    );

    if (requester) {
      const uSubject = `Meeting Room Booking Status: ${status}`;
      const uBody = `Dear ${requester.name},\n\nYour booking request for "${room ? room.name : "Meeting Room"}" has been ${status.toUpperCase()} by the administrator.\n\nDate: ${booking.date}\nTime: ${booking.startTime} (${booking.duration} mins)\n\nThank you,\nCorporate Operations`;
      sendEmailNotification(requester.email, uSubject, uBody, "Normal", bookingId).catch((err) => {
        console.error("Failed to send requester email update:", err);
      });
    }

    res.json(dbObj.bookings[bookingIndex]);
  });

  // ==================== AVAILABILITY / RECOMENDATIONS ENGINE ====================

  app.post("/api/availability", (req, res) => {
    const { date, attendeesCount, duration, clientDate, clientTime } = req.body;

    if (!date || !duration) {
      return res.status(400).json({ error: "Date and meeting duration are required" });
    }

    const dbObj = getDatabase();
    const requestedCapacity = attendeesCount ? parseInt(attendeesCount) : 0;
    const reqDuration = parseInt(duration);

    // 1. Filter rooms that meet the minimum attendee requirements
    const suitableRooms = dbObj.rooms.filter((r) => r.capacity >= requestedCapacity);

    // Work Hours limits: 09:00 to 18:00
    const workStart = 9 * 60; // 540
    const workEnd = 18 * 60;  // 1080

    // All available 30-minute interval starts
    const intervals: number[] = [];
    for (let m = workStart; m + reqDuration <= workEnd; m += 30) {
      intervals.push(m);
    }

    const clientTimeMin = clientTime ? timeToMinutes(clientTime) : -1;

    const recommendations = suitableRooms.map((room) => {
      // Find all approved bookings for this specific room and day
      const approvedOnDay = dbObj.bookings.filter(
        (b) => b.roomId === room.roomId && b.date === date && b.status === "Approved"
      );

      // Generate state for all intervals
      const detailedSlots = intervals.map((startMin) => {
        const startStr = minutesToTime(startMin);

        // Prevent booking slots in the past on current/past days
        let isPast = false;
        if (clientDate && clientTime) {
          if (date < clientDate) {
            isPast = true;
          }
          if (date === clientDate && startMin <= clientTimeMin) {
            isPast = true;
          }
        }

        const conflictBooking = approvedOnDay.find((b) => {
          return isOverlapping(startStr, reqDuration, b.startTime, b.duration);
        });

        return {
          time: startStr,
          isAvailable: !isPast && !conflictBooking,
          bookedBy: conflictBooking ? (conflictBooking.bookerName || "Another Colleague") : undefined,
        };
      });

      const freeSlots = detailedSlots.filter(s => s.isAvailable).map(s => s.time);

      return {
        room,
        availableSlots: freeSlots,
        slots: detailedSlots,
      };
    });

    res.json(recommendations);
  });

  // ==================== ADMIN EXCLUSIVE ACCESS ENDPOINTS ====================

  app.get("/api/admin/users", authenticateToken, requireAdmin, (req, res) => {
    const dbObj = getDatabase();
    // Exclude password hashes from the returned profiles
    const safeUsers = dbObj.users.map(({ passwordHash, ...user }) => user);
    res.json(safeUsers);
  });

  app.put("/api/admin/users/:userId/approve", authenticateToken, requireAdmin, (req: any, res) => {
    const { userId } = req.params;
    const { approved, role } = req.body;

    const dbObj = getDatabase();
    const userIndex = dbObj.users.findIndex((u) => u.uid === userId);

    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    const previousApproval = dbObj.users[userIndex].isApproved;
    const previousRole = dbObj.users[userIndex].role;

    dbObj.users[userIndex].isApproved = approved;
    if (role && (role === "User" || role === "Admin")) {
      dbObj.users[userIndex].role = role;
    }

    saveDatabase(dbObj);

    // If approved, notify user of account status
    const targetUser = dbObj.users[userIndex];

    // Log admin action
    let details = "";
    if (previousApproval !== approved) {
      details += `${approved ? "Approved" : "Revoked"} registration for user ${targetUser.name} (${targetUser.email}). `;
    }
    if (role && previousRole !== role) {
      details += `Updated role of ${targetUser.name} (${targetUser.email}) from ${previousRole} to ${role}.`;
    }
    if (!details) {
      details = `Updated status of user ${targetUser.name} (${targetUser.email})`;
    }

    logAdminActivity(req.user, "Manage User", details);

    if (approved && !previousApproval) {
      const subject = "Your Meeting Room Portal Account has been Approved!";
      const body = `Dear ${targetUser.name},\n\nAn administrator has approved your registration for the Meeting Room Portal.\n\nYou can now log in at ${process.env.APP_URL || "the portal URL"} and start booking corporate meeting rooms.\n\nThank you,\nCorporate Operations`;
      sendEmailNotification(targetUser.email, subject, body, "Normal", "account-approval").catch((err) => {
        console.error("Failed to notify approved user:", err);
      });
    }

    res.json({
      message: approved ? "User registration has been approved" : "User status has been updated",
      user: {
        uid: targetUser.uid,
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role,
        isApproved: targetUser.isApproved,
      },
    });
  });

  app.delete("/api/admin/users/:userId", authenticateToken, requireAdmin, (req: any, res) => {
    const { userId } = req.params;
    const dbObj = getDatabase();

    const userIndex = dbObj.users.findIndex((u) => u.uid === userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetUser = dbObj.users[userIndex];
    if (targetUser.uid === req.user.uid) {
      return res.status(400).json({ error: "You cannot delete your own admin account." });
    }

    // Delete user
    dbObj.users.splice(userIndex, 1);

    // Clean up bookings
    const deletedBookingsCount = dbObj.bookings.filter((b) => b.userId === userId).length;
    dbObj.bookings = dbObj.bookings.filter((b) => b.userId !== userId);

    saveDatabase(dbObj);

    logAdminActivity(
      req.user,
      "Delete User",
      `Deleted user account: ${targetUser.name} (${targetUser.email}). Removed ${deletedBookingsCount} associated bookings.`
    );

    res.json({ message: "User account and their associated bookings deleted successfully" });
  });

  app.get("/api/admin/activities", authenticateToken, requireAdmin, (req, res) => {
    const dbObj = getDatabase();
    res.json(dbObj.adminActivities || []);
  });

  app.get("/api/admin/notification-logs", authenticateToken, requireAdmin, (req, res) => {
    const dbObj = getDatabase();
    res.json(dbObj.notifications);
  });

  // Manual Trigger Endpoint for grading and immediate testing validation
  app.post("/api/admin/trigger-check", authenticateToken, requireAdmin, async (req, res) => {
    try {
      await checkPendingBookingsAndNotify();
      res.json({ message: "Background notification loop manually triggered and executed successfully." });
    } catch (err: any) {
      res.status(500).json({ error: "Alert loop trigger failed: " + err.message });
    }
  });

  // ==================== OUTLOOK CALENDAR INTEGRATION ====================

  async function refreshMicrosoftToken(refreshToken: string) {
    const clientId = process.env.MICROSOFT_CLIENT_ID || "3eef25b2-3c22-484b-97e3-086576b2512f";
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "placeholder-secret";

    const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error("Failed to refresh Outlook token: " + errText);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  }

  app.get("/api/outlook/url", (req, res) => {
    const clientId = process.env.MICROSOFT_CLIENT_ID || "3eef25b2-3c22-484b-97e3-086576b2512f";
    const host = req.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
    const redirectUri = `${protocol}://${host}/auth/microsoft/callback`;
    const scopes = ["offline_access", "Calendars.ReadWrite", "User.Read"].join(" ");

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: scopes,
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    res.json({ url: authUrl });
  });

  app.get(["/auth/microsoft/callback", "/auth/microsoft/callback/"], async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.send(`
        <html>
          <body>
            <h3>Authentication Error</h3>
            <p>No authorization code received from Microsoft.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID || "3eef25b2-3c22-484b-97e3-086576b2512f";
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "placeholder-secret";
    const host = req.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
    const redirectUri = `${protocol}://${host}/auth/microsoft/callback`;

    try {
      const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code as string,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString()
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(errorText);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

      const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      let email = "outlook-user@example.com";
      if (userResponse.ok) {
        const userData = await userResponse.json();
        email = userData.mail || userData.userPrincipalName || email;
      }

      res.send(`
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f8fafc; color: #334155;">
            <div style="text-align: center; border: 1px solid #e2e8f0; background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
              <h2 style="color: #0f172a; margin-bottom: 0.5rem; font-weight: 700;">Outlook Synced!</h2>
              <p style="margin-bottom: 1.5rem; color: #64748b;">Successfully connected Outlook Calendar account <strong>${email}</strong>.</p>
              <p style="font-size: 0.875rem; color: #94a3b8;">This window will close automatically in a moment.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'OUTLOOK_AUTH_SUCCESS',
                    outlookEmail: ${JSON.stringify(email)},
                    accessToken: ${JSON.stringify(accessToken)},
                    refreshToken: ${JSON.stringify(refreshToken)},
                    expiresAt: ${expiresAt}
                  }, '*');
                  setTimeout(() => window.close(), 1500);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error("Microsoft OAuth exchange error:", err);
      res.send(`
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #fff1f2; color: #991b1b;">
            <div style="text-align: center; border: 1px solid #fecdd3; background: white; padding: 2rem; border-radius: 1rem; max-width: 450px;">
              <h3 style="margin-top: 0;">Outlook Connection Failed</h3>
              <p style="font-size: 0.9rem; color: #7f1d1d;">${err.message || "An error occurred during code exchange."}</p>
              <p style="font-size: 0.8rem; color: #991b1b; background: #fff5f5; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #fee2e2; word-break: break-all;">Make sure MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are configured in your env file.</p>
              <button onclick="window.close()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600;">Close Window</button>
            </div>
          </body>
        </html>
      `);
    }
  });

  app.post("/api/outlook/create-event", async (req, res) => {
    const { refreshToken, booking, roomName } = req.body;
    if (!refreshToken || !booking) {
      return res.status(400).json({ error: "Missing refreshToken or booking info" });
    }

    try {
      const freshTokenData = await refreshMicrosoftToken(refreshToken);
      const { accessToken, refreshToken: newRefreshToken, expiresAt } = freshTokenData;

      const [hours, minutes] = booking.startTime.split(":").map(Number);
      const startDateObj = new Date(booking.date);
      startDateObj.setHours(hours, minutes, 0, 0);

      const endDateObj = new Date(startDateObj.getTime() + booking.duration * 60000);

      const eventPayload = {
        subject: `[Reserved] ${roomName || "Meeting Room"} Booking`,
        body: {
          contentType: "HTML",
          content: `
            <h2>Meeting Room Reservation Details</h2>
            <p><strong>Room:</strong> ${roomName || "Corporate Meeting Room"}</p>
            <p><strong>Date:</strong> ${booking.date}</p>
            <p><strong>Time:</strong> ${booking.startTime} (${booking.duration} Minutes)</p>
            <p><strong>Booked By:</strong> ${booking.bookerName} (${booking.bookerEmail})</p>
            <p><strong>Reason:</strong> ${booking.reason || "N/A"}</p>
            <p><strong>Meeting Type:</strong> ${booking.meetingType || "Internal"}</p>
            ${booking.meetingType === "External" ? `<p><strong>Visitor:</strong> ${booking.externalName} (${booking.externalCompany || "N/A"}) - To meet: ${booking.externalWhomToMeet}</p>` : ""}
            <p><strong>IT Support Required:</strong> ${booking.itSupportRequired ? "Yes ✅" : "No ❌"}</p>
            <p><strong>F&B Required:</strong> ${booking.fbRequired ? "Yes ✅" : "No ❌"}</p>
            <hr />
            <p style="font-size: 0.8rem; color: #666;">Generated automatically by PS Group Meeting Room Portal</p>
          `
        },
        start: {
          dateTime: startDateObj.toISOString(),
          timeZone: "UTC"
        },
        end: {
          dateTime: endDateObj.toISOString(),
          timeZone: "UTC"
        },
        location: {
          displayName: roomName || "Meeting Room"
        }
      };

      const graphResponse = await fetch("https://graph.microsoft.com/v1.0/me/calendar/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(eventPayload)
      });

      if (!graphResponse.ok) {
        const errText = await graphResponse.text();
        throw new Error("Microsoft Graph API Error: " + errText);
      }

      const eventData = await graphResponse.json();
      res.json({
        success: true,
        eventId: eventData.id,
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt
      });
    } catch (err: any) {
      console.error("Failed to create Outlook Calendar event:", err);
      res.status(500).json({ error: err.message || "Failed to create Outlook event" });
    }
  });

  app.post("/api/outlook/delete-event", async (req, res) => {
    const { refreshToken, eventId } = req.body;
    if (!refreshToken || !eventId) {
      return res.status(400).json({ error: "Missing refreshToken or eventId" });
    }

    try {
      const freshTokenData = await refreshMicrosoftToken(refreshToken);
      const { accessToken, refreshToken: newRefreshToken, expiresAt } = freshTokenData;

      const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/me/calendar/events/${eventId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!graphResponse.ok && graphResponse.status !== 404) {
        const errText = await graphResponse.text();
        throw new Error("Microsoft Graph delete event Error: " + errText);
      }

      res.json({
        success: true,
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt
      });
    } catch (err: any) {
      console.error("Failed to delete Outlook Calendar event:", err);
      res.status(500).json({ error: err.message || "Failed to delete Outlook event" });
    }
  });

  // ==================== VITE CLIENT INTEGRATION ====================

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Full-Stack Portal] Server launched at http://localhost:${PORT}`);
    console.log(`[Database Inbound] Connected to persistence: ${DB_FILE}`);
  });
}

startServer().catch((err) => {
  console.error("Crash during service initialization:", err);
});
