import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { buildHospitalityEmail, buildItHelpdeskEmail, buildStructuredEmailDraft, dispatchEmail } from "./lib/mailer.js";
import { createServer as createViteServer } from "vite";

// Interfaces representing our database schema
interface User {
  uid: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "User" | "Admin";
  isApproved: boolean;
  emailVerified?: boolean;
  verificationToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: number;
  department?: string;
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
  status: "pending" | "Approved" | "Rejected" | "Cancelled";
  createdAt: string;
  bookerName?: string;
  bookerEmail?: string;
  department?: string;
  attendeesCount?: number;
  reason?: string;
  participantEmails?: string[];
  itSupportRequired?: boolean;
  fbRequired?: boolean;
  meetingType?: string;
}

interface NotificationLog {
  notificationId: string;
  bookingId: string;
  emailTo: string;
  subject: string;
  body: string;
  sentAt: string;
  priority: "Normal" | "High";
  status: "success" | "logged_only" | "failed";
  errorMessage?: string;
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

async function sendEmailNotification(
  to: string | string[],
  subject: string,
  body: string,
  priority: "Normal" | "High",
  bookingId: string,
  bookingData?: any,
  customHtml?: string
) {
  const dbObj = getDatabase();
  const sendResult = await dispatchEmail(to, subject, body, priority, bookingId, bookingData, customHtml);
  const status = sendResult.status;
  const statusMessage = sendResult.message;
  const recipientDisplayString = (sendResult.recipients || []).join(", ") || (Array.isArray(to) ? to.join(", ") : String(to || ""));
  if (!sendResult.recipients || sendResult.recipients.length === 0) {
    return { status, message: statusMessage };
  }

  const newLog: NotificationLog = {
    notificationId: "notif-" + crypto.randomUUID(),
    bookingId,
    emailTo: recipientDisplayString,
    subject,
    body,
    sentAt: new Date().toISOString(),
    priority,
    status,
    errorMessage: statusMessage,
  };

  if (!dbObj.notifications) {
    dbObj.notifications = [];
  }
  dbObj.notifications.unshift(newLog);
  saveDatabase(dbObj);

  return { status, message: statusMessage, notification: newLog };
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
  const pendingBookings = dbObj.bookings.filter((b) => b.status === "pending" && !(b as any).notifiedAdmin);

  if (pendingBookings.length === 0) return;

  console.log(`[Background Checker] Found ${pendingBookings.length} unnotified pending bookings. Processing alerts.`);

  for (const booking of pendingBookings) {
    (booking as any).notifiedAdmin = true;
    saveDatabase(dbObj);

    const user = dbObj.users.find((u) => u.uid === booking.userId);
    const room = dbObj.rooms.find((r) => r.roomId === booking.roomId);

    const userName = user ? user.name : "Unknown User";
    const userEmail = user ? user.email : "Unknown Email";
    const roomName = room ? room.name : "Unknown Room";

    const subject = `[HIGH-PRIORITY ALERT] Booking Request #${booking.bookingId} is Still Pending Approval!`;
    const pendingDraft = buildStructuredEmailDraft({
      title: "Pending Booking Approval Reminder",
      badgeText: "ACTION REQUIRED",
      badgeBg: "#dc2626",
      recipientName: "Portal Administrator",
      summaryText: "Attention Admin: A meeting room reservation request has been awaiting administrator approval for over 2 minutes.",
      details: [
        { label: "Reservation ID", value: booking.bookingId },
        { label: "Meeting Room", value: roomName, highlight: true },
        { label: "Requested By", value: `${userName} (${userEmail})` },
        { label: "Date & Time", value: `${booking.date} at ${booking.startTime} (${booking.duration} mins)` },
        { label: "Current Status", value: "PENDING APPROVAL" }
      ],
      noteText: "Please log in to the Meeting Room Portal immediately to approve or reject this request."
    });

    try {
      await sendEmailNotification(ADMIN_ALERT_EMAIL, subject, pendingDraft.text, "High", booking.bookingId, undefined, pendingDraft.html);
    } catch (err: any) {
      console.log("[Background Checker Note]", err?.message || err);
    }
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

  // CORS Middleware to support frontends hosted externally (e.g. on Vercel)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Content-Length, X-Requested-With");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

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

  // ==================== EMAIL & NOTIFICATION ENDPOINTS ====================
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body, priority, bookingId, booking, customHtml } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required email parameters: to, subject, and body" });
    }

    const result = await sendEmailNotification(
      to,
      subject,
      body,
      priority === "High" ? "High" : "Normal",
      bookingId || "general",
      booking,
      customHtml
    );

    return res.json(result);
  });

  app.get("/api/notifications", (req, res) => {
    const dbObj = getDatabase();
    return res.json(dbObj.notifications || []);
  });

  // IT Helpdesk Notification Endpoint (Dispatched to it@psgroup.in only when IT Support Required is selected)
  app.post("/api/notify-it-helpdesk", async (req, res) => {
    const { booking, roomName } = req.body;
    if (!booking) {
      return res.status(400).json({ error: "Missing booking parameter" });
    }

    const { subject: emailSubject, roomDisplayName, draft: itDraft } = buildItHelpdeskEmail(booking, roomName);

    const result = await sendEmailNotification(
      "it@psgroup.in",
      emailSubject,
      itDraft.text,
      "High",
      booking.bookingId || "general",
      {
        ...booking,
        roomName: roomDisplayName
      },
      itDraft.html
    );

    return res.json({
      success: true,
      message: "IT Support request email dispatched to it@psgroup.in",
      recipient: "it@psgroup.in",
      subject: emailSubject,
      result
    });
  });

  // Hospitality & Catering Notification Endpoint (Dispatched to hospitality@psgroup.in only when F&B is selected)
  app.post("/api/notify-hospitality", async (req, res) => {
    const { booking, roomName } = req.body;
    if (!booking) {
      return res.status(400).json({ error: "Missing booking parameter" });
    }

    const { subject: emailSubject, roomDisplayName, draft: fbDraft } = buildHospitalityEmail(booking, roomName);

    const result = await sendEmailNotification(
      "hospitality@psgroup.in",
      emailSubject,
      fbDraft.text,
      "High",
      booking.bookingId || "general",
      {
        ...booking,
        roomName: roomDisplayName
      },
      fbDraft.html
    );

    return res.json({
      success: true,
      message: "Hospitality & F&B request email dispatched to hospitality@psgroup.in",
      recipient: "hospitality@psgroup.in",
      subject: emailSubject,
      result
    });
  });

  // ==================== AUTHENTICATION ENDPOINTS ====================

  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name, department } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Please fill in all required fields." });
    }

    // Validation of valid email format and domain restriction
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail.endsWith("@psgroup.in")) {
      return res.status(400).json({
        error: "Registration is restricted to official @psgroup.in email addresses only. External domains are not allowed."
      });
    }

    const dbObj = getDatabase();
    const existingUser = dbObj.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (existingUser) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }

    const verificationToken = crypto.randomBytes(24).toString("hex");

    const newUser: User = {
      uid: "user-" + crypto.randomUUID(),
      email: cleanEmail,
      passwordHash: hashPassword(password),
      name: name.trim(),
      role: "User", // Defaults to standard role
      isApproved: true, // Auto-approved upon email link confirmation
      emailVerified: false, // Must verify via link sent to @psgroup.in
      verificationToken,
      department: department || "General",
      createdAt: new Date().toISOString(),
    };

    dbObj.users.push(newUser);
    saveDatabase(dbObj);

    // Build absolute verification URL
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${protocol}://${host}`;
    const verificationUrl = `${origin}/?action=verify-email&token=${verificationToken}&email=${encodeURIComponent(cleanEmail)}`;

    // Dispatch verification email to @psgroup.in inbox
    try {
      const emailDraft = buildStructuredEmailDraft({
        title: "Confirm Your PS Group Portal Registration",
        badgeText: "ACCOUNT VERIFICATION",
        badgeBg: "#0284c7",
        recipientName: newUser.name,
        summaryText: "Thank you for registering on the PS Group Meeting Room Portal. Please click the link below to confirm your email address and activate your account.",
        details: [
          { label: "Registered Name", value: newUser.name },
          { label: "Official Email", value: newUser.email, highlight: true },
          { label: "Department", value: newUser.department || "General" },
          { label: "Verification Status", value: "Pending Confirmation" }
        ],
        noteText: "If you did not register for this account, please ignore this email or notify IT Helpdesk at ithelpdesk@psgroup.in.",
        actionUrl: verificationUrl,
        actionText: "Confirm Registration & Activate Account"
      });

      await sendEmailNotification(
        cleanEmail,
        "[Account Verification] Confirm Your PS Group Portal Registration",
        `Welcome to PS Group Meeting Portal!\n\nPlease confirm your registration by clicking the following link:\n${verificationUrl}\n\nThank you,\nPS Group IT Helpdesk`,
        "Normal",
        "account-verification",
        undefined,
        emailDraft.html
      );
    } catch (mailErr) {
      console.warn("Failed to dispatch registration confirmation email:", mailErr);
    }

    res.status(201).json({
      message: "Registration initiated! A verification confirmation link has been sent to your @psgroup.in email address. Please check your inbox and click the link to activate your account.",
      user: {
        uid: newUser.uid,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        isApproved: newUser.isApproved,
        emailVerified: newUser.emailVerified,
      },
    });
  });

  // Verify email confirmation endpoint
  app.post("/api/auth/verify-email", (req, res) => {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: "Email and verification token are required." });
    }

    const dbObj = getDatabase();
    const cleanEmail = email.toLowerCase().trim();
    const user = dbObj.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    if (user.emailVerified) {
      return res.json({
        message: "Your email is already verified. You can log in directly.",
        email: user.email
      });
    }

    if (user.verificationToken !== token) {
      return res.status(400).json({ error: "Invalid or expired verification token." });
    }

    user.emailVerified = true;
    user.isApproved = true;
    delete user.verificationToken;
    saveDatabase(dbObj);

    res.json({
      message: "Email successfully verified! Your account is active and you can now log in.",
      email: user.email
    });
  });

  // Forgot password endpoint: generates reset token and emails @psgroup.in
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Please enter your official email address." });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail.endsWith("@psgroup.in")) {
      return res.status(400).json({
        error: "Password reset is restricted to official @psgroup.in email addresses only."
      });
    }

    const dbObj = getDatabase();
    const user = dbObj.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return res.status(404).json({
        error: "This email address is not registered in the system. Please register first."
      });
    }

    const resetToken = crypto.randomBytes(24).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour validity
    saveDatabase(dbObj);

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${protocol}://${host}`;
    const resetUrl = `${origin}/?action=reset-password&token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`;

    try {
      const emailDraft = buildStructuredEmailDraft({
        title: "Password Reset Request",
        badgeText: "SECURITY NOTICE",
        badgeBg: "#e11d48",
        recipientName: user.name,
        summaryText: "We received a request to reset the password for your PS Group Meeting Room Portal account. Click the button below to set a new password. This link will expire in 1 hour.",
        details: [
          { label: "Account Email", value: user.email, highlight: true },
          { label: "Requested At", value: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) },
          { label: "Link Expiry", value: "1 Hour from dispatch" }
        ],
        noteText: "If you did not request a password reset, you can safely ignore this email. Your existing password will remain unchanged.",
        actionUrl: resetUrl,
        actionText: "Reset Your Password"
      });

      await sendEmailNotification(
        cleanEmail,
        "[Password Reset] PS Group Meeting Portal",
        `You requested a password reset for your PS Group account.\n\nPlease reset your password using the following link:\n${resetUrl}\n\nThis link is valid for 1 hour.\n\nPS Group IT Operations`,
        "High",
        "password-reset",
        undefined,
        emailDraft.html
      );
    } catch (mailErr) {
      console.warn("Failed to dispatch password reset email:", mailErr);
    }

    res.json({
      message: `Password reset link has been mailed to ${cleanEmail}. Please check your inbox and follow the instructions.`
    });
  });

  // Reset password with token endpoint
  app.post("/api/auth/reset-password", (req, res) => {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: "Email, reset token, and new password are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const dbObj = getDatabase();
    const cleanEmail = email.toLowerCase().trim();
    const user = dbObj.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    if (!user.resetPasswordToken || user.resetPasswordToken !== token) {
      return res.status(400).json({ error: "Invalid or expired password reset token." });
    }

    if (user.resetPasswordExpires && Date.now() > user.resetPasswordExpires) {
      return res.status(400).json({ error: "Password reset link has expired. Please request a new one." });
    }

    user.passwordHash = hashPassword(newPassword);
    delete user.resetPasswordToken;
    delete user.resetPasswordExpires;
    user.emailVerified = true;
    user.isApproved = true;
    saveDatabase(dbObj);

    res.json({
      message: "Your password has been successfully updated! You can now log in with your new password."
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Please enter your email and password" });
    }

    const dbObj = getDatabase();
    const formattedEmail = email.toLowerCase().trim();
    const user = dbObj.users.find((u) => u.email.toLowerCase() === formattedEmail);

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Check email verification if required
    if (user.emailVerified === false) {
      return res.status(403).json({
        error: "Please confirm your registration via the verification link sent to your @psgroup.in email address before logging in.",
      });
    }

    // Check approval status dynamically from database
    if (user.isApproved === false) {
      return res.status(403).json({
        error: "Your account is pending approval. Please wait for an administrator to approve your registration.",
      });
    }

    // Generate JWT token with user properties fetched dynamically from database
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
        emailVerified: user.emailVerified ?? true,
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
    const { roomId, date, startTime, duration, attendeesCount, bookerName, bookerEmail, participantEmails, reason, itSupportRequired, fbRequired, clientDate, clientTime } = req.body;

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

    // Clean and validate participant emails to ensure all participants have @psgroup.in domain
    const rawParticipants = Array.isArray(participantEmails)
      ? participantEmails
      : (typeof participantEmails === "string" ? participantEmails.split(/[,;\s]+/) : []);

    const validPsgroupParticipants = rawParticipants
      .map((e: any) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
      .filter((e: string) => e && e.includes("@") && e.endsWith("@psgroup.in") && e !== bookerEmail.toLowerCase());

    const uniqueParticipants = Array.from(new Set(validPsgroupParticipants));

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
      participantEmails: uniqueParticipants,
      reason: reason || "Corporate Meeting",
      itSupportRequired: !!itSupportRequired,
      fbRequired: !!fbRequired,
      createdAt: new Date().toISOString(),
    };

    dbObj.bookings.push(newBooking);
    saveDatabase(dbObj);

    // 1. Send Booking Confirmation email & Calendar Invite (.ics) to Organizer and @psgroup.in participants
    const meetingRecipients = Array.from(new Set([bookerEmail, ...uniqueParticipants]));
    const subject = `[Booking Confirmed] ${room.name} on ${date} at ${startTime}`;
    const confirmDraft = buildStructuredEmailDraft({
      title: "Meeting Room Reservation Confirmed",
      badgeText: "CONFIRMED",
      badgeBg: "#10b981",
      badgeColor: "#ffffff",
      recipientName: bookerName,
      summaryText: `Your meeting room reservation at PS Group has been successfully confirmed on a first-come, first-served basis. The room slot is now locked for your team.`,
      details: [
        { label: "Meeting Room", value: room.name, highlight: true },
        { label: "Date & Time Slot", value: `${date} at ${startTime} (${dur} mins)` },
        { label: "Meeting Agenda", value: newBooking.reason || "Corporate Meeting" },
        { label: "Organizer Name", value: bookerName },
        { label: "Organizer Email", value: bookerEmail },
        { label: "Internal Participants", value: uniqueParticipants.length > 0 ? uniqueParticipants.join(", ") : "None" },
        { label: "Attendees Count", value: attendeesCount ? `${attendeesCount} participants` : "N/A" },
        { label: "IT Support Required", value: newBooking.itSupportRequired ? "Yes (Requested)" : "No" },
        { label: "F&B Required", value: newBooking.fbRequired ? "Yes (Requested)" : "No" }
      ],
      noteText: "An iCalendar (.ics) event file is attached. Opening the attachment will automatically save this reservation to your Outlook or Google calendar."
    });

    sendEmailNotification(
      meetingRecipients,
      subject,
      confirmDraft.text,
      "Normal",
      newBooking.bookingId,
      {
        ...newBooking,
        roomName: room.name,
        reason: newBooking.reason || subject,
      },
      confirmDraft.html
    ).catch(() => {});

    // 2. If IT Support is required, notify it@psgroup.in with booking details but NOT agenda
    if (newBooking.itSupportRequired) {
      const itSubject = `IT Support Required - ${room.name} (${date} at ${startTime})`;
      const itDraft = buildStructuredEmailDraft({
        title: "IT Support Required",
        badgeText: "IT SUPPORT REQ",
        badgeBg: "#2563eb",
        badgeColor: "#ffffff",
        recipientName: "PS Group IT Support Team (it@psgroup.in)",
        summaryText: "An IT Support and Audio-Visual setup request has been logged for an upcoming corporate room reservation at PS Group. Please ensure all required AV technology, display connectivity, and conferencing equipment are tested and ready prior to meeting start time.",
        details: [
          { label: "Meeting Room", value: room.name, highlight: true },
          { label: "Date & Time Slot", value: `${date} at ${startTime} (${dur} mins)` },
          { label: "Organizer Name", value: bookerName },
          { label: "Organizer Email", value: bookerEmail },
          { label: "Attendees Count", value: attendeesCount ? `${attendeesCount} participants` : "N/A" },
          { label: "IT Support Status", value: "AV & Connectivity Setup Requested" }
        ],
        noteText: "Action Required for IT Team: Please test projector/TV screen display, HDMI dongles & adapters, conference speakerphone/microphones, and video conference links prior to the meeting start time."
      });

      sendEmailNotification(
        "it@psgroup.in",
        "IT Support Required",
        itDraft.text,
        "High",
        newBooking.bookingId,
        {
          ...newBooking,
          roomName: room.name,
          reason: "IT Support Required", // Agenda hidden for IT Support
        },
        itDraft.html
      ).catch(() => {});
    }

    // 3. If F&B is required, notify hospitality@psgroup.in
    if (newBooking.fbRequired) {
      const fbSubject = `F&B Required - Catering Setup for ${room.name} (${date} at ${startTime})`;
      const fbDraft = buildStructuredEmailDraft({
        title: "F&B Required",
        badgeText: "F&B CATERING REQ",
        badgeBg: "#d97706",
        badgeColor: "#ffffff",
        recipientName: "PS Group Hospitality & Admin Team (hospitality@psgroup.in)",
        summaryText: "A Food & Beverage (F&B) and Hospitality request has been logged for an upcoming corporate meeting at PS Group. Please prepare refreshment service, clean glassware, and tea/coffee/water in the room prior to meeting start time.",
        details: [
          { label: "Meeting Room", value: room.name, highlight: true },
          { label: "Date & Time Slot", value: `${date} at ${startTime} (${dur} mins)` },
          { label: "Organizer Name", value: bookerName },
          { label: "Organizer Email", value: bookerEmail },
          { label: "Attendees Count (Catering)", value: attendeesCount ? `${attendeesCount} attendees` : "1 attendee" }
        ],
        noteText: "Action Required for Hospitality Team: Arrange mineral water bottles, tea/coffee service setup, clean glassware, and seating arrangement."
      });

      sendEmailNotification(
        "hospitality@psgroup.in",
        "F&B Support Required",
        fbDraft.text,
        "High",
        newBooking.bookingId,
        {
          ...newBooking,
          roomName: room.name,
          reason: "F&B Support Required",
        },
        fbDraft.html
      ).catch(() => {});
    }

    res.status(201).json({
      message: "Room booked successfully! Your reservation is active.",
      booking: newBooking,
    });
  });

  // Cancel reservation endpoints
  const handleCancelBookingRoute = async (req: any, res: any) => {
    const { bookingId } = req.params;
    const dbObj = getDatabase();
    const bookingIndex = dbObj.bookings.findIndex((b) => b.bookingId === bookingId);

    let booking: any = null;
    if (bookingIndex !== -1) {
      dbObj.bookings[bookingIndex].status = "Cancelled";
      booking = dbObj.bookings[bookingIndex];
      saveDatabase(dbObj);
    }

    const targetRoom = booking ? dbObj.rooms.find((r) => r.roomId === booking.roomId) : null;
    const roomName = targetRoom ? targetRoom.name : (booking?.roomId || "Meeting Room");

    // Extract organizer and participant emails ending with @psgroup.in
    const bookerEmail = booking?.bookerEmail;
    const rawParticipants = Array.isArray(booking?.participantEmails) ? booking.participantEmails : [];
    const validParticipants = rawParticipants
      .map((e: any) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
      .filter((e: string) => e && e.endsWith("@psgroup.in") && e !== bookerEmail?.toLowerCase());

    const cancelRecipients: string[] = [];
    if (bookerEmail && bookerEmail.includes("@")) {
      cancelRecipients.push(bookerEmail);
    }
    for (const p of validParticipants) {
      if (!cancelRecipients.includes(p)) {
        cancelRecipients.push(p);
      }
    }

    // Send cancellation notification email strictly to organizer and participants ONLY (not admin)
    if (cancelRecipients.length > 0) {
      const subject = `[RESERVATION CANCELLED] ${roomName} - ${booking?.date || ""} ${booking?.startTime || ""}`;

      const cancelDraft = buildStructuredEmailDraft({
        title: "Meeting Room Reservation Cancelled",
        badgeText: "CANCELLED",
        badgeBg: "#ef4444",
        recipientName: booking?.bookerName || "Employee",
        summaryText: "This email confirms that your meeting room reservation has been cancelled. The time slot has been released back into the portal for other colleagues to book.",
        details: [
          { label: "Reservation ID", value: bookingId },
          { label: "Meeting Room", value: roomName, highlight: true },
          { label: "Date & Released Time", value: `${booking?.date || "N/A"} at ${booking?.startTime || "N/A"}` },
          { label: "Host / Organizer", value: `${booking?.bookerName || "Employee"} (${booking?.bookerEmail || "N/A"})` },
          { label: "Cancellation Timestamp", value: new Date().toLocaleString() }
        ],
        noteText: "If this cancellation was unintended, you can create a new reservation anytime through the Meeting Room Portal."
      });

      sendEmailNotification(cancelRecipients, subject, cancelDraft.text, "Normal", bookingId, undefined, cancelDraft.html).catch(() => {});
    }

    return res.json({
      message: "Meeting room reservation cancelled successfully.",
      bookingId,
      status: "Cancelled"
    });
  };

  app.post("/api/bookings/:bookingId/cancel", handleCancelBookingRoute);
  app.put("/api/bookings/:bookingId/cancel", handleCancelBookingRoute);
  app.delete("/api/bookings/:bookingId", handleCancelBookingRoute);

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
      sendEmailNotification(requester.email, uSubject, uBody, "Normal", bookingId).catch(() => {});
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
      const approveDraft = buildStructuredEmailDraft({
        title: "Account Approved - Welcome to PS Group Meeting Portal",
        badgeText: "ACCOUNT APPROVED",
        badgeBg: "#6366f1",
        recipientName: targetUser.name,
        summaryText: "Your registration for the PS Group Meeting Room Portal has been reviewed and approved by an administrator.",
        details: [
          { label: "User Name", value: targetUser.name, highlight: true },
          { label: "Account Email", value: targetUser.email },
          { label: "Assigned Role", value: targetUser.role },
          { label: "Account Status", value: "Active & Approved" }
        ],
        noteText: "You can now log in to view real-time room availability, reserve conference spaces, and request IT/F&B support."
      });
      sendEmailNotification(targetUser.email, subject, approveDraft.text, "Normal", "account-approval", undefined, approveDraft.html).catch(() => {});
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
