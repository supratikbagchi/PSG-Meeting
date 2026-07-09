import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar,
  Clock,
  Users,
  Shield,
  LogOut,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  Mail,
  Sliders,
  Settings,
  Briefcase,
  Search,
  ChevronRight,
  Sparkles,
  MapPin,
  Tag
} from "lucide-react";
import { apiService } from "./services/apiService";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";
import { User, Room, Booking, NotificationLog, Recommendation, AdminActivityLog } from "./types";

// Helper to format Firestore/Firebase errors nicely for the UI
function formatError(err: any): string {
  if (!err) return "";
  const message = err.message || String(err);
  try {
    if (message.trim().startsWith("{") && message.trim().endsWith("}")) {
      const parsed = JSON.parse(message);
      if (parsed.error) {
        const errMsg = parsed.error;
        if (errMsg.includes("permission") || errMsg.includes("Permission") || errMsg.includes("insufficient")) {
          return "Access Denied: Missing or insufficient permissions. Please register and check your inbox to verify your account.";
        }
        return errMsg;
      }
    }
  } catch (e) {}

  if (message.includes("auth/invalid-credential") || message.includes("Invalid credentials")) {
    return "Invalid corporate email address or password.";
  }
  if (message.includes("auth/email-already-in-use")) {
    return "The email address is already in use by another corporate account.";
  }
  if (message.includes("auth/weak-password")) {
    return "Password should be at least 6 characters long.";
  }
  return message;
}

export default function App() {
  // Session States
  const [currentUser, setCurrentUser] = useState<User | null>({
    uid: "guest-user",
    email: "guest@example.com",
    name: "Guest",
    role: "User",
    isApproved: true,
    createdAt: new Date().toISOString()
  });
  const [sessionLoading, setSessionLoading] = useState(false);

  // View & Navigation States
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTab, setActiveTab] = useState<"book" | "my-bookings" | "admin">("book");

  // Core Lists
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [adminActivities, setAdminActivities] = useState<AdminActivityLog[]>([]);

  // Loading & Global Error States
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Authentication Forms
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  // Availability Search Form
  const [searchDate, setSearchDate] = useState(() => {
    const d = new Date();
    // If it is past 18:00 (6 PM) in the user's local timezone, default to tomorrow
    if (d.getHours() >= 18) {
      d.setDate(d.getDate() + 1);
    }
    return d.toLocaleDateString("en-CA");
  });
  const [searchAttendees, setSearchAttendees] = useState(4);
  const [searchDuration, setSearchDuration] = useState(60); // minutes
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [searchingAvailability, setSearchingAvailability] = useState(false);

  // Active Booking Creation States
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedStartTime, setSelectedStartTime] = useState<string>("");
  const [customAttendees, setCustomAttendees] = useState<number>(4);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);
  const [submittingBooking, setSubmittingBooking] = useState(false);

  // Booker Guest Info States
  const [bookerName, setBookerName] = useState(() => localStorage.getItem("ps_booker_name") || "");
  const [bookerEmail, setBookerEmail] = useState(() => localStorage.getItem("ps_booker_email") || "");
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);

  // Admin Manage Room Form
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [formRoomName, setFormRoomName] = useState("");
  const [formRoomCapacity, setFormRoomCapacity] = useState(10);
  const [formRoomFeature, setFormRoomFeature] = useState("");
  const [formRoomFeaturesList, setFormRoomFeaturesList] = useState<string[]>([]);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);

  // Triggering counts for badges
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const [pendingBookingCount, setPendingBookingCount] = useState(0);

  // Verify Auth Session On Mount with real-time Firebase Auth listener
  useEffect(() => {
    setSessionLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (firebaseUser.isAnonymous) {
          setCurrentUser({
            uid: "guest-user",
            email: "guest@example.com",
            name: "Guest",
            role: "User",
            isApproved: true,
            createdAt: new Date().toISOString(),
            emailVerified: true
          });
        } else {
          try {
            const userDoc = await apiService.getUserDoc(firebaseUser.uid);
            if (userDoc) {
              setCurrentUser({
                ...userDoc,
                emailVerified: firebaseUser.emailVerified
              });
            } else {
              setCurrentUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email || "",
                name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
                role: "User",
                isApproved: true,
                createdAt: new Date().toISOString(),
                emailVerified: firebaseUser.emailVerified
              });
            }
          } catch (err) {
            console.error("Error restoring user session on state change:", err);
          }
        }
      } else {
        // Fallback to guest user
        setCurrentUser({
          uid: "guest-user",
          email: "guest@example.com",
          name: "Guest",
          role: "User",
          isApproved: true,
          createdAt: new Date().toISOString(),
          emailVerified: true
        });
      }
      setSessionLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Rooms & Bookings
  const fetchRoomsData = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const roomsData = await apiService.getRooms();
      setRooms(roomsData);
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const fetchBookingsData = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const bookingsData = await apiService.getBookings();
      setBookings(bookingsData);
      setPendingBookingCount(0);
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setBookingsLoading(false);
    }
  }, []);

  // Fetch Admin Specific Data
  const fetchAdminData = useCallback(async () => {
    if (!currentUser || currentUser.role !== "Admin") return;
    setAdminLoading(true);
    try {
      const [usersList, notifLogs, activities] = await Promise.all([
        apiService.getAdminUsers(),
        apiService.getNotificationLogs(),
        apiService.getAdminActivities(),
      ]);
      setAdminUsers(usersList);
      setNotificationLogs(notifLogs);
      setAdminActivities(activities);
      setPendingUserCount(usersList.filter((u) => !u.isApproved).length);
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setAdminLoading(false);
    }
  }, [currentUser]);

  // Load standard data on mount and on user changes
  useEffect(() => {
    fetchRoomsData();
    fetchBookingsData();
    if (currentUser?.role === "Admin") {
      fetchAdminData();
    }
  }, [currentUser, fetchRoomsData, fetchBookingsData, fetchAdminData]);

  // Handle Availability Search
  const triggerAvailabilityCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchingAvailability(true);
    setBookingSuccess(null);
    setBookingError(null);

    const now = new Date();
    const clientDate = now.toLocaleDateString("en-CA");
    const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      const results = await apiService.checkAvailability({
        date: searchDate,
        attendeesCount: searchAttendees,
        duration: searchDuration,
        clientDate,
        clientTime,
      });
      setRecommendations(results);
      // Clear selected slot details to avoid stale checkout
      setSelectedRoom(null);
      setSelectedStartTime("");
    } catch (err: any) {
      setBookingError(formatError(err));
    } finally {
      setSearchingAvailability(false);
    }
  };

  // Automatically fetch recommendations on initial layout load
  useEffect(() => {
    triggerAvailabilityCheck();
  }, []);

  // Actions: User Authentication
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const response = await apiService.login(loginEmail, loginPassword);
      setCurrentUser(response.user);
      setLoginEmail("");
      setLoginPassword("");
    } catch (err: any) {
      setLoginError(formatError(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const response = await apiService.login(loginEmail, loginPassword);
      setCurrentUser(response.user);
      setLoginEmail("");
      setLoginPassword("");
      setShowAdminLoginModal(false);
      setActiveTab("admin");
    } catch (err: any) {
      setLoginError(formatError(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);

    if (regPassword !== regConfirmPassword) {
      setRegError("Passwords do not match");
      return;
    }

    setRegLoading(true);
    try {
      const response = await apiService.register(regEmail, regPassword, regName);
      setRegSuccess(response.message);
      // reset fields
      setRegName("");
      setRegEmail("");
      setRegPassword("");
      setRegConfirmPassword("");
    } catch (err: any) {
      setRegError(formatError(err));
    } finally {
      setRegLoading(false);
    }
  };

  const handleLogout = () => {
    apiService.logout();
    setCurrentUser(null);
    setActiveTab("book");
  };

  // Selection of slot triggers reservation checkout panel
  const handleSelectSlot = (room: Room, startTime: string) => {
    setSelectedRoom(room);
    setSelectedStartTime(startTime);
    setCustomAttendees(searchAttendees);
    setBookingSuccess(null);
    setBookingError(null);

    if (currentUser && currentUser.uid !== "guest-user") {
      setBookerName(currentUser.name || "");
      setBookerEmail(currentUser.email || "");
    }
  };

  // Confirm booking request
  const handleConfirmBooking = async () => {
    if (!selectedRoom || !selectedStartTime) return;
    if (!bookerName.trim() || !bookerEmail.trim()) {
      setBookingError("Please provide your Name and Email address to complete your instant reservation.");
      return;
    }
    setSubmittingBooking(true);
    setBookingError(null);
    setBookingSuccess(null);

    const now = new Date();
    const clientDate = now.toLocaleDateString("en-CA");
    const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      const result = await apiService.createBooking({
        roomId: selectedRoom.roomId,
        date: searchDate,
        startTime: selectedStartTime,
        duration: searchDuration,
        bookerName: bookerName.trim(),
        bookerEmail: bookerEmail.trim(),
        attendeesCount: customAttendees,
        clientDate,
        clientTime,
      });
      setBookingSuccess(result.message);
      
      // Store locally for subsequent reservations convenience
      localStorage.setItem("ps_booker_name", bookerName.trim());
      localStorage.setItem("ps_booker_email", bookerEmail.trim());

      // Refresh Lists
      fetchBookingsData();
      
      // Re-trigger availability check to update ui immediately
      triggerAvailabilityCheck();
      
      // Clear selection
      setSelectedRoom(null);
      setSelectedStartTime("");
    } catch (err: any) {
      setBookingError(formatError(err));
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Admin Actions: Approve User registration
  const handleApproveUser = async (userId: string, approve: boolean) => {
    setAdminLoading(true);
    try {
      await apiService.approveUser(userId, approve);
      fetchAdminData();
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin Actions: Toggle admin role status
  const handleToggleAdminRole = async (user: User) => {
    setAdminLoading(true);
    const targetRole = user.role === "Admin" ? "User" : "Admin";
    try {
      await apiService.approveUser(user.uid, user.isApproved, targetRole);
      fetchAdminData();
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin Actions: Delete User
  const handleDeleteUser = async (userId: string) => {
    setAdminLoading(true);
    try {
      await apiService.deleteUser(userId);
      fetchAdminData();
      fetchBookingsData();
      triggerAvailabilityCheck();
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin Actions: Approve/Reject Bookings
  const handleProcessBooking = async (bookingId: string, status: "Approved" | "Rejected") => {
    setAdminLoading(true);
    try {
      await apiService.updateBookingStatus(bookingId, status);
      fetchBookingsData();
      fetchAdminData();
      triggerAvailabilityCheck();
    } catch (err: any) {
      setGlobalError(formatError(err));
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin Actions: Manage Meeting Rooms
  const handleOpenAddRoom = () => {
    setEditingRoom(null);
    setFormRoomName("");
    setFormRoomCapacity(10);
    setFormRoomFeaturesList(["Projector", "Whiteboard"]);
    setFormRoomFeature("");
    setRoomActionError(null);
    setShowRoomModal(true);
  };

  const handleOpenEditRoom = (room: Room) => {
    setEditingRoom(room);
    setFormRoomName(room.name);
    setFormRoomCapacity(room.capacity);
    setFormRoomFeaturesList([...room.features]);
    setFormRoomFeature("");
    setRoomActionError(null);
    setShowRoomModal(true);
  };

  const handleAddFeatureTag = () => {
    if (!formRoomFeature.trim()) return;
    if (formRoomFeaturesList.includes(formRoomFeature.trim())) return;
    setFormRoomFeaturesList([...formRoomFeaturesList, formRoomFeature.trim()]);
    setFormRoomFeature("");
  };

  const handleRemoveFeatureTag = (tag: string) => {
    setFormRoomFeaturesList(formRoomFeaturesList.filter((f) => f !== tag));
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomActionError(null);
    if (!formRoomName.trim()) {
      setRoomActionError("Please enter a meeting room name");
      return;
    }

    try {
      if (editingRoom) {
        // Edit Room
        await apiService.updateRoom(editingRoom.roomId, formRoomName, formRoomCapacity, formRoomFeaturesList);
      } else {
        // Create Room
        await apiService.addRoom(formRoomName, formRoomCapacity, formRoomFeaturesList);
      }
      setShowRoomModal(false);
      fetchRoomsData();
      triggerAvailabilityCheck();
    } catch (err: any) {
      setRoomActionError(formatError(err));
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm("Are you sure you want to delete this room and all associated bookings? This is permanent.")) return;
    try {
      await apiService.deleteRoom(roomId);
      fetchRoomsData();
      fetchBookingsData();
      triggerAvailabilityCheck();
    } catch (err: any) {
      setGlobalError(formatError(err));
    }
  };

  // Admin Actions: Trigger 2-minute persistent loops manually
  const handleManualAlertTrigger = async () => {
    setAdminLoading(true);
    try {
      const response = await apiService.triggerAlertLoop();
      alert(response.message);
      fetchAdminData();
    } catch (err: any) {
      alert("Error triggering alarm checker: " + err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  // Loading Splash Screen
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-slate-50">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-10 w-10 text-slate-800 animate-spin mb-4" />
          <h1 className="text-xl font-display font-bold tracking-tight text-slate-900">Meeting Room Booking Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Verifying corporate credentials...</p>
        </div>
      </div>
    );
  }

  // ==================== AUTH VIEW (LOGIN / REGISTER) ====================
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
          {/* Top Decorative Banner */}
          <div className="bg-slate-900 px-6 py-8 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Briefcase className="w-32 h-32" />
            </div>
            <div className="relative z-10 flex items-center space-x-2">
              <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-display font-bold tracking-tight">PS Group</h1>
                <p className="text-xs text-slate-400">Meeting Room Booking Portal</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex border-b border-slate-200 mb-6">
              <button
                id="login-tab-btn"
                onClick={() => {
                  setAuthMode("login");
                  setLoginError(null);
                  setRegError(null);
                }}
                className={`flex-1 pb-3 text-center font-medium text-sm transition-all relative ${
                  authMode === "login" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Sign In
                {authMode === "login" && (
                  <motion.div layoutId="auth-tab-bar" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                )}
              </button>
              <button
                id="register-tab-btn"
                onClick={() => {
                  setAuthMode("register");
                  setLoginError(null);
                  setRegError(null);
                }}
                className={`flex-1 pb-3 text-center font-medium text-sm transition-all relative ${
                  authMode === "register" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Register
                {authMode === "register" && (
                  <motion.div layoutId="auth-tab-bar" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                )}
              </button>
            </div>

            {authMode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2.5 text-xs text-red-700">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <span>{loginError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                  <p className="text-[10px] text-slate-400">Please log in with your registered email.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="login-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Password
                  </label>
                  <input
                    id="login-pass"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                </div>

                <button
                  id="submit-login-btn"
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-850 text-white rounded-lg text-sm font-semibold shadow-md transition-all flex justify-center items-center cursor-pointer disabled:opacity-55"
                >
                  {loginLoading ? <RefreshCw className="h-4 w-4 animate-spin text-blue-500 mr-2" /> : null}
                  Sign In to Portal
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                {regError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2.5 text-xs text-red-700">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <span>{regError}</span>
                  </div>
                )}

                {regSuccess && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start space-x-2.5 text-xs text-blue-800">
                    <CheckCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-blue-900">Registration Submitted!</p>
                      <p className="text-slate-600 leading-relaxed">{regSuccess}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="reg-name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    placeholder="Supratik Bagchi"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    placeholder="username@example.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                  <p className="text-[10px] text-slate-500 font-medium">⚠️ Any valid email address can register.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="reg-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Password
                    </label>
                    <input
                      id="reg-pass"
                      type="password"
                      required
                      placeholder="••••••••"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="reg-confirm-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Confirm
                    </label>
                    <input
                      id="reg-confirm-pass"
                      type="password"
                      required
                      placeholder="••••••••"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <button
                  id="submit-register-btn"
                  type="submit"
                  disabled={regLoading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-850 text-white rounded-lg text-sm font-semibold shadow-md transition-all flex justify-center items-center cursor-pointer disabled:opacity-55"
                >
                  {regLoading ? <RefreshCw className="h-4 w-4 animate-spin text-blue-500 mr-2" /> : null}
                  Register Account
                </button>
              </form>
            )}

            <div className="mt-5 border-t border-slate-100 pt-4 text-center">
              <button
                id="cancel-auth-btn"
                onClick={() => {
                  setCurrentUser({
                    uid: "guest-user",
                    email: "guest@example.com",
                    name: "Guest",
                    role: "User",
                    isApproved: true,
                    createdAt: new Date().toISOString(),
                    emailVerified: true
                  });
                }}
                className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium underline"
              >
                ← Back to Dashboard as Guest
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== MAIN PORTAL VIEW ====================
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Banner indicating system error if any */}
      {globalError && (
        <div className="bg-red-600 text-white text-xs px-4 py-2 flex justify-between items-center z-50">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-semibold">Error: {globalError}</span>
          </div>
          <button
            id="clear-error-btn"
            onClick={() => setGlobalError(null)}
            className="text-white/85 hover:text-white font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {currentUser && currentUser.uid !== "guest-user" && !currentUser.emailVerified && (
        <div className="bg-amber-500 text-slate-950 text-xs px-4 py-3 flex justify-between items-center z-40 border-b border-amber-600 font-medium">
          <div className="flex items-center space-x-2 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
            <AlertTriangle className="h-4 w-4 shrink-0 text-slate-900 animate-bounce" />
            <span>
              <strong>Verification Required:</strong> Please check your inbox to verify your account before booking.
            </span>
            <button
              id="top-resend-verification-btn"
              onClick={async () => {
                try {
                  if (auth.currentUser) {
                    await auth.currentUser.reload();
                    if (auth.currentUser.emailVerified) {
                      setCurrentUser(prev => prev ? { ...prev, emailVerified: true } : null);
                      alert("Your email has been verified! You can now book rooms.");
                    } else {
                      const { sendEmailVerification } = await import("firebase/auth");
                      await sendEmailVerification(auth.currentUser);
                      alert("Verification email resent to " + auth.currentUser.email);
                    }
                  }
                } catch (err: any) {
                  alert("Error: " + (err.message || "Failed to resend verification email."));
                }
              }}
              className="ml-auto bg-slate-950 hover:bg-slate-850 text-white font-bold px-3 py-1 rounded transition-colors cursor-pointer text-[10px]"
            >
              Verify / Resend
            </button>
          </div>
        </div>
      )}

      {/* Main Premium Corporate Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo Group */}
            <div className="flex items-center space-x-3">
              <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/10 shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <span className="text-lg font-display font-extrabold tracking-tight text-slate-900 block leading-tight">
                  PS Group <span className="text-blue-600 font-bold">Portal</span>
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block -mt-0.5">
                  Corporate Operations
                </span>
              </div>
            </div>

            {/* Profile & Navigation Desktop controls */}
            <div className="flex items-center space-x-3">
              {currentUser?.role === "Admin" ? (
                <>
                  <span className="text-[10px] uppercase font-bold tracking-wider bg-blue-100 text-blue-700 px-3 py-1 rounded-full flex items-center">
                    <Shield className="w-3 h-3 mr-1" />
                    Admin Mode
                  </span>
                  <button
                    id="admin-logout-btn"
                    onClick={() => {
                      apiService.logout();
                      setCurrentUser({
                        uid: "guest-user",
                        email: "guest@example.com",
                        name: "Guest",
                        role: "User",
                        isApproved: true,
                        createdAt: new Date().toISOString(),
                        emailVerified: true
                      });
                      setActiveTab("book");
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer border border-red-100 bg-red-50/50 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-all"
                  >
                    Logout Admin
                  </button>
                </>
              ) : currentUser && currentUser.uid !== "guest-user" ? (
                <>
                  <div className="flex flex-col items-end mr-1">
                    <span className="text-xs font-bold text-slate-800">{currentUser.name}</span>
                    <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full mt-0.5 font-sans ${
                      currentUser.emailVerified 
                        ? "bg-green-100 text-green-700" 
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {currentUser.emailVerified ? "✓ Verified Employee" : "⚠️ Unverified Email"}
                    </span>
                  </div>
                  <button
                    id="employee-logout-btn"
                    onClick={() => {
                      apiService.logout();
                      setCurrentUser({
                        uid: "guest-user",
                        email: "guest@example.com",
                        name: "Guest",
                        role: "User",
                        isApproved: true,
                        createdAt: new Date().toISOString(),
                        emailVerified: true
                      });
                      setActiveTab("book");
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer border border-red-100 bg-red-50/50 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-all"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-500 px-3 py-1 rounded-full">
                    Public Guest Booker
                  </span>
                  <button
                    id="employee-signin-btn"
                    onClick={() => {
                      setCurrentUser(null);
                    }}
                    className="text-xs text-slate-700 hover:text-slate-900 font-semibold cursor-pointer border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-lg transition-all"
                  >
                    Employee Sign In
                  </button>
                  <button
                    id="show-admin-login-btn"
                    onClick={() => {
                      setLoginEmail("");
                      setLoginPassword("");
                      setLoginError(null);
                      setShowAdminLoginModal(true);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold cursor-pointer border border-blue-100 bg-blue-50/50 hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-all flex items-center"
                  >
                    <Shield className="w-3 h-3 mr-1" />
                    Admin Sign In
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Corporate Summary & Tabs Bar */}
      <div className="bg-slate-900 text-slate-300 py-6 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="md:flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-display font-bold tracking-tight text-white">
                Meeting Room Reservation Dashboard
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Ensure perfect meeting conditions. Allocate corporate assets and filter slots instantly.
              </p>
            </div>

            {/* Main Tabs Navigation */}
            <div className="flex items-center space-x-1.5 mt-4 md:mt-0 bg-slate-800 p-1 rounded-xl">
              <button
                id="tab-book-btn"
                onClick={() => setActiveTab("book")}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                  activeTab === "book"
                    ? "bg-blue-600 text-white shadow-md font-bold"
                    : "text-slate-300 hover:text-white hover:bg-slate-700"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Book a Room</span>
              </button>

              <button
                id="tab-my-bookings-btn"
                onClick={() => setActiveTab("my-bookings")}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                  activeTab === "my-bookings"
                    ? "bg-blue-600 text-white shadow-md font-bold"
                    : "text-slate-300 hover:text-white hover:bg-slate-700"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>All Reservations</span>
                {bookings.length > 0 && (
                  <span className="bg-slate-900 text-blue-400 font-bold px-1.5 py-0.2 rounded-full text-[9px]">
                    {bookings.length}
                  </span>
                )}
              </button>

              {currentUser?.role === "Admin" && (
                <button
                  id="tab-admin-portal-btn"
                  onClick={() => {
                    setActiveTab("admin");
                  }}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 relative cursor-pointer ${
                    activeTab === "admin"
                      ? "bg-blue-600 text-white shadow-md font-bold"
                      : "text-slate-300 hover:text-white hover:bg-slate-700"
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin Portal</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {/* ==================== TAB 1: RESERVATION DESK ==================== */}
          {activeTab === "book" && (
            <motion.div
              key="book-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Sidebar filter query form */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center space-x-2 mb-4 border-b border-slate-100 pb-3">
                    <Sliders className="text-blue-600 h-5 w-5" />
                    <h3 className="font-display font-semibold text-slate-900">Room Preferences</h3>
                  </div>

                  <form onSubmit={triggerAvailabilityCheck} className="space-y-4">
                    <div className="space-y-1">
                      <label htmlFor="search-date" className="block text-xs font-semibold text-slate-600 uppercase">
                        Date
                      </label>
                      <div className="relative">
                        <input
                          id="search-date"
                          type="date"
                          value={searchDate}
                          min={new Date().toLocaleDateString("en-CA")}
                          onChange={(e) => setSearchDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                        />
                        <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="search-attendees" className="block text-xs font-semibold text-slate-600 uppercase">
                        Attendees Count
                      </label>
                      <div className="relative">
                        <input
                          id="search-attendees"
                          type="number"
                          min="1"
                          max="50"
                          value={searchAttendees}
                          onChange={(e) => setSearchAttendees(parseInt(e.target.value) || 1)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                        />
                        <Users className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      </div>
                      <p className="text-[10px] text-slate-400">Rooms with smaller capacity are automatically filtered out.</p>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="search-duration" className="block text-xs font-semibold text-slate-600 uppercase">
                        Duration
                      </label>
                      <div className="relative">
                        <select
                          id="search-duration"
                          value={searchDuration}
                          onChange={(e) => setSearchDuration(parseInt(e.target.value))}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all appearance-none"
                        >
                          <option value="30">30 Minutes</option>
                          <option value="60">1 Hour</option>
                          <option value="90">1.5 Hours</option>
                          <option value="120">2 Hours</option>
                          <option value="180">3 Hours</option>
                          <option value="240">4 Hours</option>
                        </select>
                        <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      </div>
                    </div>

                    <button
                      id="search-availability-btn"
                      type="submit"
                      disabled={searchingAvailability}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md shadow-blue-100 transition-colors flex justify-center items-center cursor-pointer disabled:opacity-55"
                    >
                      {searchingAvailability ? <RefreshCw className="h-4 w-4 animate-spin text-white mr-2" /> : <Search className="h-4 w-4 mr-2 text-white" />}
                      Search Available Rooms
                    </button>
                  </form>
                </div>
              </div>

              {/* Suggestions Panel */}
              <div className="lg:col-span-2 space-y-6">
                {bookingSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start space-x-3 text-blue-800"
                  >
                    <CheckCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-900">Reservation Pending Approval!</p>
                      <p className="text-sm text-slate-600 mt-1">{bookingSuccess}</p>
                      <button
                        id="view-bookings-redirect-btn"
                        onClick={() => setActiveTab("my-bookings")}
                        className="text-xs font-bold text-blue-700 underline mt-2 block"
                      >
                        View booking status inside my reservations →
                      </button>
                    </div>
                  </motion.div>
                )}

                {bookingError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-800">
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-900">Overlapping Slot Check Conflict</p>
                      <p className="text-xs text-red-700 mt-1">{bookingError}</p>
                    </div>
                  </div>
                )}

                {/* Suggested slots result list */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="font-display font-semibold text-slate-900 text-lg">Suggested Available Meeting Rooms</h3>
                      <p className="text-xs text-slate-500">
                        Date: <span className="font-semibold text-slate-700">{searchDate}</span> | Capacity ≥ <span className="font-semibold text-slate-700">{searchAttendees}</span> | Duration: <span className="font-semibold text-slate-700">{searchDuration}m</span>
                      </p>
                    </div>
                    <button
                      id="refresh-availability-btn"
                      onClick={() => triggerAvailabilityCheck()}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 transition-all cursor-pointer"
                      title="Refresh Results"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>

                  {searchingAvailability ? (
                    <div className="py-20 flex flex-col items-center justify-center">
                      <RefreshCw className="h-8 w-8 text-slate-400 animate-spin mb-3" />
                      <p className="text-sm text-slate-500">Recalculating room overlaps...</p>
                    </div>
                  ) : recommendations.length === 0 ? (
                    <div className="py-16 text-center">
                      <XCircle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-600 font-semibold">No Suitable Rooms Found</p>
                      <p className="text-xs text-slate-400 mt-1">Adjust attendees size or date query constraint.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {recommendations.map((rec) => (
                        <div key={rec.room.roomId} className="border border-slate-200/60 rounded-2xl p-5 hover:bg-slate-50/40 transition-all">
                          <div className="sm:flex justify-between items-start mb-4">
                            <div>
                              <h4 className="font-display font-semibold text-slate-900 text-base flex items-center">
                                <span className="mr-2 text-blue-600">■</span>
                                {rec.room.name}
                              </h4>
                              <div className="flex items-center space-x-1.5 mt-1 text-xs text-slate-500">
                                <Users className="w-3.5 h-3.5" />
                                <span>Up to {rec.room.capacity} attendees</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2 sm:mt-0">
                              {rec.room.features.map((feature, i) => (
                                <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium flex items-center">
                                  <Tag className="w-2.5 h-2.5 mr-1 text-slate-400" />
                                  {feature}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Horizontal Slots scroll list */}
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Time Slots (30-min intervals):</span>
                            {(!rec.slots || rec.slots.length === 0) && rec.availableSlots.length === 0 ? (
                              <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-100 font-medium">
                                ⚠️ No slots found for this room on the chosen day.
                              </p>
                            ) : (
                              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                                {(rec.slots || rec.availableSlots.map(s => ({ time: s, isAvailable: true }))).map((slotObj: any) => {
                                  const slot = typeof slotObj === "string" ? slotObj : slotObj.time;
                                  const isAvailable = typeof slotObj === "string" ? true : slotObj.isAvailable;
                                  const bookedBy = typeof slotObj === "string" ? null : slotObj.bookedBy;
                                  const isSelected = selectedRoom?.roomId === rec.room.roomId && selectedStartTime === slot;

                                  if (!isAvailable) {
                                    return (
                                      <div
                                        key={slot}
                                        className="py-1 px-1.5 text-xs font-medium rounded-lg border text-center bg-slate-50 text-slate-400 border-slate-200 select-none flex flex-col justify-center items-center opacity-70"
                                        title={bookedBy ? `Booked by ${bookedBy}` : "This slot has already passed today"}
                                      >
                                        <span className={bookedBy ? "line-through text-slate-400" : "text-slate-350"}>{slot}</span>
                                        <span className={`text-[8px] font-bold ${bookedBy ? "text-red-500 font-semibold" : "text-slate-400/80"} scale-90`}>
                                          {bookedBy ? "Taken" : "Past"}
                                        </span>
                                      </div>
                                    );
                                  }

                                  return (
                                    <button
                                      key={slot}
                                      id={`slot-${rec.room.roomId}-${slot}`}
                                      onClick={() => handleSelectSlot(rec.room, slot)}
                                      className={`py-1.5 px-2 text-xs font-semibold rounded-lg border text-center transition-all cursor-pointer ${
                                        isSelected
                                          ? "bg-blue-600 text-white border-blue-600 shadow-sm font-bold scale-105"
                                          : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                                      }`}
                                    >
                                      {slot}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Instant Checkout / Confirm Reservation Panel */}
                <AnimatePresence>
                  {selectedRoom && selectedStartTime && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-slate-900 text-white rounded-2xl shadow-lg border border-slate-800 p-6 overflow-hidden"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="h-5 w-5 text-blue-400 animate-pulse" />
                          <h3 className="font-display font-semibold text-lg">Confirm Instant Reservation</h3>
                        </div>
                        <button
                          id="close-checkout-btn"
                          onClick={() => {
                            setSelectedRoom(null);
                            setSelectedStartTime("");
                          }}
                          className="text-slate-400 hover:text-white"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-800/60 p-4 rounded-xl text-xs mb-4">
                        <div>
                          <span className="text-slate-400 block mb-0.5">ROOM:</span>
                          <span className="font-bold text-sm text-blue-400">{selectedRoom.name}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">DATE:</span>
                          <span className="font-bold text-sm">{searchDate}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">START TIME:</span>
                          <span className="font-bold text-sm text-blue-400">{selectedStartTime}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">DURATION:</span>
                          <span className="font-bold text-sm">{searchDuration} Minutes</span>
                        </div>
                      </div>

                      {currentUser && currentUser.uid !== "guest-user" && !currentUser.emailVerified ? (
                        <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 space-y-3 my-4">
                          <div className="flex items-start space-x-3">
                            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-white">Verification Required</p>
                              <p className="text-sm mt-1 text-slate-300">
                                Please check your inbox to verify your account before booking.
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-end pt-1">
                            <button
                              id="checkout-resend-btn"
                              onClick={async () => {
                                try {
                                  if (auth.currentUser) {
                                    await auth.currentUser.reload();
                                    if (auth.currentUser.emailVerified) {
                                      setCurrentUser(prev => prev ? { ...prev, emailVerified: true } : null);
                                      alert("Your email is now verified! You can proceed with booking.");
                                    } else {
                                      const { sendEmailVerification } = await import("firebase/auth");
                                      await sendEmailVerification(auth.currentUser);
                                      alert("Verification email resent. Please check your inbox.");
                                    }
                                  }
                                } catch (err: any) {
                                  alert("Error: " + (err.message || "Failed to resend."));
                                }
                              }}
                              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                            >
                              Resend Verification Email / Refresh Status
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Guest Identification Fields */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/40 p-4 rounded-xl mb-4 border border-slate-800">
                            <div className="flex flex-col space-y-1.5">
                              <label htmlFor="booker-name" className="text-xs font-semibold text-slate-300">YOUR NAME <span className="text-red-500">*</span></label>
                              <input
                                id="booker-name"
                                type="text"
                                placeholder="Enter full name"
                                value={bookerName}
                                onChange={(e) => setBookerName(e.target.value)}
                                className="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                                required
                              />
                            </div>
                            <div className="flex flex-col space-y-1.5">
                              <label htmlFor="booker-email" className="text-xs font-semibold text-slate-300">EMAIL ADDRESS <span className="text-red-500">*</span></label>
                              <input
                                id="booker-email"
                                type="email"
                                placeholder="your.email@psgroup.in"
                                value={bookerEmail}
                                onChange={(e) => setBookerEmail(e.target.value)}
                                className="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                                required
                              />
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div className="flex items-center space-x-2.5 w-full sm:w-auto">
                              <label htmlFor="custom-attendees" className="text-xs text-slate-300 shrink-0">ATTENDEES COUNT:</label>
                              <input
                                id="custom-attendees"
                                type="number"
                                min="1"
                                max={selectedRoom.capacity}
                                value={customAttendees}
                                onChange={(e) => setCustomAttendees(parseInt(e.target.value) || 1)}
                                className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500 w-20"
                              />
                              <span className="text-[10px] text-slate-500">Max: {selectedRoom.capacity}</span>
                            </div>

                            <button
                              id="confirm-booking-btn"
                              onClick={handleConfirmBooking}
                              disabled={submittingBooking}
                              className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-500/20 transition-all flex items-center justify-center cursor-pointer disabled:opacity-55"
                            >
                              {submittingBooking ? <RefreshCw className="h-4 w-4 animate-spin text-white mr-2" /> : null}
                              Confirm and Reserve Room
                            </button>
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* ==================== TAB 2: ALL RESERVATIONS ==================== */}
          {activeTab === "my-bookings" && (
            <motion.div
              key="bookings-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-display font-semibold text-slate-900 text-lg">All Active Reservations</h3>
                    <p className="text-xs text-slate-500">View all locked slots. Reservations are approved instantly on a first-come, first-served basis.</p>
                  </div>
                  <button
                    id="refresh-my-bookings-btn"
                    onClick={() => fetchBookingsData()}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 transition-all cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>

                {bookingsLoading ? (
                  <div className="py-20 flex flex-col items-center justify-center">
                    <RefreshCw className="h-8 w-8 text-slate-400 animate-spin mb-3" />
                    <p className="text-sm text-slate-500">Loading schedules...</p>
                  </div>
                ) : bookings.length === 0 ? (
                  <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-xl">
                    <Calendar className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-600 font-semibold">No Reservations Found</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">No rooms have been reserved yet on the portal.</p>
                    <button
                      id="book-first-room-btn"
                      onClick={() => setActiveTab("book")}
                      className="inline-flex items-center px-4 py-2 bg-slate-950 text-white hover:bg-slate-850 font-bold text-xs rounded-lg shadow cursor-pointer"
                    >
                      Search Rooms Now
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Room Name</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Booked By</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Start Time</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Created At</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200 text-sm">
                        {bookings.map((booking) => {
                          const room = rooms.find((r) => r.roomId === booking.roomId);
                          return (
                            <tr key={booking.bookingId} className="hover:bg-slate-50/50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="font-semibold text-slate-900">{room ? room.name : "Unknown Room"}</div>
                                <div className="text-xs text-slate-400">ID: {booking.bookingId.substring(0, 10)}...</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="font-medium text-slate-800">{booking.bookerName || "Guest User"}</div>
                                <div className="text-xs text-slate-400 font-mono">{booking.bookerEmail || "guest@example.com"}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-slate-600">{booking.date}</td>
                              <td className="px-6 py-4 whitespace-nowrap font-mono font-medium text-blue-600">{booking.startTime}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-slate-600">{booking.duration} mins</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="px-2.5 py-1 text-xs font-bold rounded-full uppercase tracking-wider bg-green-100 text-green-800">
                                  {booking.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-400">
                                {new Date(booking.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ==================== TAB 3: ADMIN PORTAL ==================== */}
          {activeTab === "admin" && currentUser.role === "Admin" && (
            <motion.div
              key="admin-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {/* Meeting Rooms Configuration */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="sm:flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-display font-semibold text-slate-900 text-lg">Meeting Rooms Configuration</h3>
                    <p className="text-xs text-slate-500">Add, edit, or remove rooms, feature sets, and seating capacities.</p>
                  </div>
                  <button
                    id="admin-add-room-btn"
                    onClick={handleOpenAddRoom}
                    className="mt-2 sm:mt-0 inline-flex items-center px-4 py-2 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-lg shadow cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                    Add Meeting Room
                  </button>
                </div>

                {roomsLoading ? (
                  <div className="py-20 flex flex-col items-center justify-center">
                    <RefreshCw className="h-8 w-8 text-slate-400 animate-spin mb-3" />
                    <p className="text-sm text-slate-500">Loading room inventory...</p>
                  </div>
                ) : rooms.length === 0 ? (
                  <p className="text-center text-slate-500 py-10">No rooms registered.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {rooms.map((room) => (
                      <div key={room.roomId} className="border border-slate-200 rounded-2xl p-5 hover:bg-slate-50/50 transition-all flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-display font-bold text-slate-900 text-base">{room.name}</h4>
                            <span className="bg-slate-100 text-slate-700 text-xs font-semibold px-2.5 py-1 rounded-lg">
                              Cap: {room.capacity} seats
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono mb-3">ROOM ID: {room.roomId}</p>

                          <div className="flex flex-wrap gap-1 mb-4">
                            {room.features.map((feature, i) => (
                              <span key={i} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 font-medium px-2 py-0.5 rounded flex items-center">
                                <Tag className="w-2.5 h-2.5 mr-1 text-slate-400" />
                                {feature}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-end space-x-2 border-t border-slate-100 pt-3">
                          <button
                            id={`edit-room-btn-${room.roomId}`}
                            onClick={() => handleOpenEditRoom(room)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded border border-slate-200 transition-all cursor-pointer"
                            title="Edit Room Properties"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            id={`delete-room-btn-${room.roomId}`}
                            onClick={() => handleDeleteRoom(room.roomId)}
                            className="p-1.5 text-red-500 hover:text-red-750 hover:bg-red-50 rounded border border-red-200 transition-all cursor-pointer"
                            title="Delete Room"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-400">
        <p>© 2026 PS Group Real Estate Private Limited. All Rights Reserved.</p>
        <p className="mt-1">Corporate Meeting Room Reservation Portal. Built for high-efficiency operations.</p>
      </footer>

      {/* ==================== ADMIN EDIT ROOM MODAL ==================== */}
      <AnimatePresence>
        {showRoomModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
                <h3 className="font-display font-semibold text-base">{editingRoom ? "Edit Meeting Room" : "Add New Meeting Room"}</h3>
                <button
                  id="close-room-modal-btn"
                  onClick={() => setShowRoomModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveRoom} className="p-6 space-y-4 text-sm">
                {roomActionError && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-semibold flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 shrink-0" />
                    {roomActionError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="form-room-name" className="block text-xs font-semibold text-slate-700 uppercase">Room Name</label>
                  <input
                    id="form-room-name"
                    type="text"
                    required
                    placeholder="Boardroom Alpha"
                    value={formRoomName}
                    onChange={(e) => setFormRoomName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:bg-white transition-all text-slate-950"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="form-room-capacity" className="block text-xs font-semibold text-slate-700 uppercase">Seating Capacity</label>
                  <input
                    id="form-room-capacity"
                    type="number"
                    required
                    min="1"
                    max="100"
                    placeholder="12"
                    value={formRoomCapacity}
                    onChange={(e) => setFormRoomCapacity(parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:bg-white transition-all text-slate-950"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="form-room-feature-input" className="block text-xs font-semibold text-slate-700 uppercase">Add Feature Tags</label>
                  <div className="flex space-x-2">
                    <input
                      id="form-room-feature-input"
                      type="text"
                      placeholder="Smart TV"
                      value={formRoomFeature}
                      onChange={(e) => setFormRoomFeature(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddFeatureTag();
                        }
                      }}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:bg-white transition-all text-slate-950"
                    />
                    <button
                      id="add-feature-tag-btn"
                      type="button"
                      onClick={handleAddFeatureTag}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-4 rounded-lg font-bold text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-2">
                    {formRoomFeaturesList.map((tag) => (
                      <span key={tag} className="bg-slate-100 text-slate-700 text-xs font-medium px-2 py-1 rounded flex items-center">
                        {tag}
                        <button
                          id={`remove-feature-tag-${tag}`}
                          type="button"
                          onClick={() => handleRemoveFeatureTag(tag)}
                          className="ml-1 text-slate-400 hover:text-slate-600 font-bold"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  id="save-room-btn"
                  type="submit"
                  className="w-full mt-4 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-500/10 transition-colors flex justify-center items-center cursor-pointer"
                >
                  Save Meeting Room Configuration
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== SECURE ADMIN LOGIN MODAL ==================== */}
      <AnimatePresence>
        {showAdminLoginModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden"
            >
              <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
                <h3 className="font-display font-semibold text-base flex items-center">
                  <Shield className="w-4 h-4 mr-2 text-blue-500 animate-pulse" />
                  Secure Admin Sign In
                </h3>
                <button
                  id="close-admin-login-modal-btn"
                  onClick={() => setShowAdminLoginModal(false)}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAdminLogin} className="p-6 space-y-4 text-sm">
                {loginError && (
                  <div className="p-3 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-semibold flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 shrink-0" />
                    {loginError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="admin-id-input" className="block text-xs font-semibold text-slate-700 uppercase">Admin Username / ID</label>
                  <input
                    id="admin-id-input"
                    type="text"
                    required
                    placeholder="Enter Admin ID"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:bg-white transition-all text-slate-950 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="admin-password-input" className="block text-xs font-semibold text-slate-700 uppercase">Password</label>
                  <input
                    id="admin-password-input"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:bg-white transition-all text-slate-950"
                  />
                </div>

                <button
                  id="admin-login-submit-btn"
                  type="submit"
                  disabled={loginLoading}
                  className="w-full mt-4 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-md transition-colors flex justify-center items-center cursor-pointer disabled:opacity-55"
                >
                  {loginLoading ? "Authenticating Securely..." : "Verify & Authenticate"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
