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
  Tag,
  X,
  Filter,
  SlidersHorizontal,
  Check,
  Building,
  RotateCcw,
  Send,
  Info,
  CalendarCheck,
  History,
  CalendarX,
  DoorClosed,
  Cpu,
  CheckCircle2,
  Coffee,
  MessageSquare,
  Star
} from "lucide-react";
import { apiService } from "./services/apiService";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";
import { User, Room, Booking, NotificationLog, Recommendation, AdminActivityLog, DEPARTMENT_LIST, ExternalGuest } from "./types";

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

// Utility to retrieve API URL base for Microsoft Outlook Integration when deployed on Vercel
function getApiUrl(path: string): string {
  // Option to configure a custom API URL in environment variables
  const envApiUrl = (import.meta as any).env?.VITE_API_URL;
  if (envApiUrl) {
    return `${envApiUrl.replace(/\/$/, "")}${path}`;
  }

  // Fallback to the live Cloud Run production container URL if hosted externally (e.g., Vercel)
  const isCloudRunOrLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.endsWith("run.app");

  if (!isCloudRunOrLocal) {
    const cloudRunBase = "https://ais-pre-jeqaeefd3h7gpit4pq6mfe-563717408510.asia-east1.run.app";
    return `${cloudRunBase}${path}`;
  }

  return path;
}

export default function App() {
  // Session States
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    return apiService.getCachedUser();
  });
  const [sessionLoading, setSessionLoading] = useState(() => {
    return !apiService.getCachedUser();
  });

  // View & Navigation States
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [activeTab, setActiveTab] = useState<"book" | "my-bookings" | "admin" | "feedback">("book");
  const [searchTargetTime, setSearchTargetTime] = useState<string>("");
  const [searchFloor, setSearchFloor] = useState<string>("All");

  // Feedback States
  const [feedbacks, setFeedbacks] = useState<import("./types").FeedbackItem[]>([]);
  const [feedbackAmenitiesRating, setFeedbackAmenitiesRating] = useState(5);
  const [feedbackAppRating, setFeedbackAppRating] = useState(5);
  const [feedbackComments, setFeedbackComments] = useState("");
  const [feedbackSelectedBookingId, setFeedbackSelectedBookingId] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

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

  // Forgot Password Form
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regDepartment, setRegDepartment] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  // Availability Search Form
  const [searchDate, setSearchDate] = useState(() => {
    const d = new Date();
    // If it is past 20:00 (8 PM) in the user's local timezone, default to tomorrow
    if (d.getHours() >= 20) {
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
  const [bookingReason, setBookingReason] = useState("");
  const [meetingType, setMeetingType] = useState<"Internal" | "External">("Internal");
  const [externalName, setExternalName] = useState("");
  const [externalCompany, setExternalCompany] = useState("");
  const [externalWhomToMeet, setExternalWhomToMeet] = useState("");
  const [externalGuests, setExternalGuests] = useState<ExternalGuest[]>([
    { name: "", company: "", email: "", phone: "", whomToMeet: "" }
  ]);

  const handleAddGuest = () => {
    setExternalGuests(prev => [...prev, { name: "", company: "", email: "", phone: "", whomToMeet: "" }]);
  };

  const handleRemoveGuest = (index: number) => {
    setExternalGuests(prev => {
      if (prev.length <= 1) {
        setExternalName("");
        setExternalCompany("");
        setExternalWhomToMeet("");
        return [{ name: "", company: "", email: "", phone: "", whomToMeet: "" }];
      }
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length > 0 && index === 0) {
        setExternalName(updated[0].name || "");
        setExternalCompany(updated[0].company || "");
        setExternalWhomToMeet(updated[0].whomToMeet || "");
      }
      return updated;
    });
  };

  const handleGuestChange = (index: number, field: keyof ExternalGuest, value: string) => {
    setExternalGuests(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);

  // New Checkbox, Search, and IT Support Notification States
  const [itSupportRequired, setItSupportRequired] = useState(false);
  const [fbRequired, setFbRequired] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [reservationSearchQuery, setReservationSearchQuery] = useState("");
  const [reservationFilterCategory, setReservationFilterCategory] = useState<"All" | "IT" | "FB" | "External">("All");
  const [reservationTimeTab, setReservationTimeTab] = useState<"upcoming" | "past_cancelled">("upcoming");

  // Multi-Facet Filter Pop-up Modal States (Amazon/Flipkart Style)
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterDepartment, setFilterDepartment] = useState<string>("All");
  const [filterITSupport, setFilterITSupport] = useState<"All" | "Yes" | "No">("All");
  const [filterFB, setFilterFB] = useState<"All" | "Yes" | "No">("All");
  const [filterMeetingType, setFilterMeetingType] = useState<"All" | "Internal" | "External">("All");
  const [filterRoomId, setFilterRoomId] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<"All" | "Approved" | "Cancelled">("All");
  const [filterStartDate, setFilterStartDate] = useState<string>("");
  const [filterEndDate, setFilterEndDate] = useState<string>("");

  // Temp states for Filter Pop-Up Modal
  const [tempDepartment, setTempDepartment] = useState<string>("All");
  const [tempITSupport, setTempITSupport] = useState<"All" | "Yes" | "No">("All");
  const [tempFB, setTempFB] = useState<"All" | "Yes" | "No">("All");
  const [tempMeetingType, setTempMeetingType] = useState<"All" | "Internal" | "External">("All");
  const [tempRoomId, setTempRoomId] = useState<string>("All");
  const [tempStatus, setTempStatus] = useState<"All" | "Approved" | "Cancelled">("All");
  const [tempStartDate, setTempStartDate] = useState<string>("");
  const [tempEndDate, setTempEndDate] = useState<string>("");
  const [deptSearchInModal, setDeptSearchInModal] = useState<string>("");
  const [activeModalFacet, setActiveModalFacet] = useState<"department" | "room" | "requirements" | "scope" | "status" | "date">("department");

  // Admin Manage Room Form
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [formRoomName, setFormRoomName] = useState("");
  const [formRoomCapacity, setFormRoomCapacity] = useState(10);
  const [formRoomFeature, setFormRoomFeature] = useState("");
  const [formRoomFeaturesList, setFormRoomFeaturesList] = useState<string[]>([]);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);

  // Cancellation Modal States
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelSuccessMsg, setCancelSuccessMsg] = useState<string | null>(null);

  // Triggering counts for badges
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const [pendingBookingCount, setPendingBookingCount] = useState(0);

  // Verify Auth Session On Mount with real-time Firebase Auth listener
  useEffect(() => {
    if (!currentUser) {
      setSessionLoading(true);
    }
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (firebaseUser.isAnonymous) {
          setCurrentUser(null);
          localStorage.removeItem("ps_booking_user");
          localStorage.removeItem("ps_booking_token");
        } else {
          try {
            const userDoc = await apiService.getUserDoc(firebaseUser.uid);
            if (userDoc) {
              const fullUser = {
                ...userDoc,
                emailVerified: firebaseUser.emailVerified
              };
              setCurrentUser(fullUser);
              localStorage.setItem("ps_booking_user", JSON.stringify(fullUser));
            } else {
              const defaultUser = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || "",
                name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
                role: "User",
                isApproved: true,
                createdAt: new Date().toISOString(),
                emailVerified: firebaseUser.emailVerified
              };
              setCurrentUser(defaultUser);
              localStorage.setItem("ps_booking_user", JSON.stringify(defaultUser));
            }
          } catch (err) {
            console.error("Error restoring user session on state change:", err);
          }
        }
      } else {
        // No user logged in! Setting to null instead of guest-user fallback.
        setCurrentUser(null);
        localStorage.removeItem("ps_booking_user");
        localStorage.removeItem("ps_booking_token");
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
      const [bookingsData, usersList] = await Promise.all([
        apiService.getBookings(),
        apiService.getAdminUsers().catch(() => [])
      ]);
      setBookings(bookingsData);
      if (usersList && usersList.length > 0) {
        setAdminUsers(usersList);
      }
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

    const todayObj = new Date();
    const maxDateObj = new Date();
    maxDateObj.setDate(todayObj.getDate() + 5);
    const maxBookingDateISO = maxDateObj.toLocaleDateString("en-CA");

    if (searchDate > maxBookingDateISO) {
      setBookingError(`Bookings are restricted to up to 5 days in advance. You cannot book beyond ${maxBookingDateISO}.`);
      setSearchingAvailability(false);
      return;
    }

    const now = new Date();
    const clientDate = now.toLocaleDateString("en-CA");
    const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      const results = await apiService.checkAvailability({
        date: searchDate,
        attendeesCount: searchAttendees,
        duration: searchDuration,
        features: selectedFeatures,
        floor: searchFloor,
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

    // Automatically wipe previous bookings once on start
    const clearPreviousBookings = async () => {
      if (!localStorage.getItem("ps_bookings_cleared_v2")) {
        try {
          await apiService.clearAllBookings();
          localStorage.setItem("ps_bookings_cleared_v2", "true");
          fetchBookingsData();
        } catch (err) {
          console.warn("Could not auto-clear previous bookings on startup:", err);
        }
      }
    };
    clearPreviousBookings();
  }, []);

  // Actions: User Authentication
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(null);
    setForgotLoading(true);
    try {
      await apiService.sendPasswordReset(forgotEmail);
      setForgotSuccess("A password reset link has been sent to your email address!");
      setForgotEmail("");
    } catch (err: any) {
      setForgotError(formatError(err));
    } finally {
      setForgotLoading(false);
    }
  };

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

    if (!regDepartment.trim()) {
      setRegError("Department field is mandatory.");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setRegError("Passwords do not match. Please re-enter passwords.");
      return;
    }

    setRegLoading(true);
    try {
      const response = await apiService.register(regEmail, regPassword, regName, regDepartment);
      setRegSuccess(response.message);
      // reset fields
      setRegName("");
      setRegEmail("");
      setRegDepartment("");
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
    setBookingReason("");
    setMeetingType("Internal");
    setExternalName("");
    setExternalCompany("");
    setExternalWhomToMeet("");

    if (currentUser) {
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
    if (!bookingReason.trim()) {
      setBookingError("Meeting Agenda is mandatory and must be filled.");
      return;
    }

    if (meetingType === "External") {
      const validGuests = externalGuests.filter(g => g.name && g.name.trim() !== "");
      if (validGuests.length === 0 && !externalName.trim()) {
        setBookingError("At least one external guest name is required for External meetings.");
        return;
      }
      const primaryWhomToMeet = validGuests[0]?.whomToMeet?.trim() || externalWhomToMeet.trim();
      if (!primaryWhomToMeet) {
        setBookingError("For external bookings, 'Whom to meet' is required.");
        return;
      }
    }

    if (Number(searchDuration) > 60) {
      setBookingError("Meeting duration is restricted to a maximum of 1 hour (60 minutes).");
      return;
    }

    const todayObj = new Date();
    const maxDateObj = new Date();
    maxDateObj.setDate(todayObj.getDate() + 5);
    const maxBookingDateISO = maxDateObj.toLocaleDateString("en-CA");
    if (searchDate > maxBookingDateISO) {
      setBookingError(`Bookings are restricted to up to 5 days in advance. You cannot book beyond ${maxBookingDateISO}.`);
      return;
    }

    setSubmittingBooking(true);
    setBookingError(null);
    setBookingSuccess(null);

    const now = new Date();
    const clientDate = now.toLocaleDateString("en-CA");
    const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const validExternalGuests = meetingType === "External" 
      ? externalGuests.filter(g => g.name && g.name.trim() !== "")
      : undefined;

    try {
      const result = await apiService.createBooking({
        roomId: selectedRoom.roomId,
        date: searchDate,
        startTime: selectedStartTime,
        duration: searchDuration,
        bookerName: bookerName.trim(),
        bookerEmail: bookerEmail.trim(),
        department: currentUser?.department || "",
        reason: bookingReason.trim(),
        meetingType,
        externalGuests: validExternalGuests,
        externalName: meetingType === "External" ? (validExternalGuests?.[0]?.name?.trim() || externalName.trim()) : undefined,
        externalCompany: meetingType === "External" ? (validExternalGuests?.[0]?.company?.trim() || externalCompany.trim()) : undefined,
        externalWhomToMeet: meetingType === "External" ? (validExternalGuests?.[0]?.whomToMeet?.trim() || externalWhomToMeet.trim() || bookerName.trim()) : undefined,
        attendeesCount: customAttendees,
        itSupportRequired,
        fbRequired,
        clientDate,
        clientTime,
        outlookSynced: false,
      });

      // Automatically dispatch IT team notification email via server endpoint
      let emailDiagnostic = "";
      try {
        const itRes = await fetch(getApiUrl("/api/notify-it-helpdesk"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking: result.booking,
            roomName: selectedRoom.name
          })
        });
        if (itRes.ok) {
          const itData = await itRes.json();
          emailDiagnostic = itData.message;
        }
      } catch (itErr) {
        console.warn("Server email dispatch notification to IT Team failed, recorded in DB logs instead:", itErr);
      }

      let successMsg = result.message;
      if (emailDiagnostic) {
        successMsg += ` [IT Email Status: ${emailDiagnostic}]`;
      }

      setBookingSuccess(successMsg);
      
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
      setBookingReason("");
      setMeetingType("Internal");
      setExternalName("");
      setExternalCompany("");
      setExternalWhomToMeet("");
      setItSupportRequired(false);
      setFbRequired(false);
    } catch (err: any) {
      setBookingError(formatError(err));
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Export meeting reservation or IT Support reminder as a standard .ics calendar invite file
  const handleExportICS = (booking: Booking, roomName: string, isITSupport: boolean = false) => {
    try {
      const [hours, minutes] = booking.startTime.split(":").map(Number);
      const startDateObj = new Date(booking.date);
      startDateObj.setHours(hours, minutes, 0, 0);
      const endDateObj = new Date(startDateObj.getTime() + booking.duration * 60000);

      const formatICSDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      };

      const stamp = formatICSDate(new Date());
      const startStr = formatICSDate(startDateObj);
      const endStr = formatICSDate(endDateObj);

      const summary = isITSupport
        ? `[IT Support Required] ${roomName} - ${booking.reason || "Meeting"}`
        : `[Reserved] ${roomName} Meeting`;

      const descriptionLines = isITSupport
        ? [
            `IT HELPDESK ACTION REQUIRED`,
            `==================================`,
            `Meeting Room: ${roomName}`,
            `Date: ${booking.date}`,
            `Time: ${booking.startTime} (${booking.duration} Minutes)`,
            `Host Name: ${booking.bookerName || "Employee"}`,
            `Host Email: ${booking.bookerEmail || "N/A"}`,
            `Agenda: ${booking.reason || "N/A"}`,
            `Target Email: ithelpdesk@psgroup.in`,
            `Action: Setup IT & AV Support prior to meeting start`
          ]
        : [
            `Meeting Room Reservation Details`,
            `==================================`,
            `Room Name: ${roomName}`,
            `Booked By: ${booking.bookerName || "Employee"} (${booking.bookerEmail || ""})`,
            `Reason: ${booking.reason || "N/A"}`,
            `IT Support Required: ${booking.itSupportRequired ? "Yes ✅" : "No ❌"}`,
            `F&B Required: ${booking.fbRequired ? "Yes ✅" : "No ❌"}`
          ];

      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PS Group//Meeting Room Portal//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:booking-${booking.bookingId}${isITSupport ? "-it" : ""}@psgroup.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${startStr}`,
        `DTEND:${endStr}`,
        `SUMMARY:${summary}`,
        `LOCATION:${roomName}`,
        `DESCRIPTION:${descriptionLines.join("\\n")}`,
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${isITSupport ? "IT Support Required Reminder" : "Meeting Room Reservation Reminder"}`,
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n");

      const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filePrefix = isITSupport ? "IT_Support_" : "Meeting_Room_";
      link.setAttribute("download", `${filePrefix}${roomName.replace(/\s+/g, "_")}_${booking.bookingId.substring(0, 8)}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Failed to export calendar invitation: " + err.message);
    }
  };

  const handleSendFeedbackEmail = async (booking: Booking) => {
    try {
      const room = rooms.find(r => r.roomId === booking.roomId);
      const roomName = room ? room.name : "Meeting Room";
      await apiService.sendFeedbackRequestEmail(booking, roomName);
      alert(`Automated feedback request email sent to organizer (${booking.bookerEmail})!`);
    } catch (err: any) {
      alert("Error sending feedback request: " + (err.message || "Failed"));
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackError(null);
    setFeedbackSuccess(null);
    setFeedbackSubmitting(true);

    try {
      const selectedBooking = bookings.find(b => b.bookingId === feedbackSelectedBookingId);
      const roomName = selectedBooking 
        ? (rooms.find(r => r.roomId === selectedBooking.roomId)?.name || selectedBooking.roomId)
        : "General Meeting Area";

      await apiService.submitFeedback({
        bookingId: feedbackSelectedBookingId || "GENERAL",
        roomId: selectedBooking?.roomId || "GENERAL",
        roomName,
        userId: currentUser?.uid || "GUEST",
        userName: currentUser?.name || bookerName || "Employee",
        userEmail: currentUser?.email || bookerEmail || "employee@psgroup.in",
        ratingAmenities: feedbackAmenitiesRating,
        ratingApp: feedbackAppRating,
        comments: feedbackComments.trim()
      });

      setFeedbackSuccess("Thank you! Your feedback on room amenities and the portal experience has been recorded.");
      setFeedbackComments("");
      setFeedbackAmenitiesRating(5);
      setFeedbackAppRating(5);

      const updatedList = await apiService.getFeedbacks();
      setFeedbacks(updatedList);
    } catch (err: any) {
      setFeedbackError(err.message || "Failed to submit feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Helper to trigger direct server email dispatch to IT Team (it@psgroup.in)
  const handleEmailITHelpdesk = async (booking: Booking, roomName: string) => {
    try {
      const res = await fetch(getApiUrl("/api/notify-it-helpdesk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking, roomName })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Server Email Dispatched to IT Team (it@psgroup.in)!\n\nStatus: ${data.status.toUpperCase()}\nDetails: ${data.message}`);
        fetchAdminData();
      } else {
        alert("Server email dispatch failed. Please check backend service status.");
      }
    } catch (err: any) {
      alert("Error triggering server email dispatch: " + (err.message || String(err)));
    }
  };

  const handleSendTestITEmail = async () => {
    try {
      setAdminLoading(true);
      const res = await fetch(getApiUrl("/api/send-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "it@psgroup.in",
          subject: "[TEST DISPATCH] IT Helpdesk Notification Test",
          body: "This is a diagnostic test email to verify SMTP mail server connectivity for IT Support dispatch.",
          priority: "High",
          bookingId: "test-booking"
        })
      });
      const data = await res.json();
      alert(`Outbound Email Dispatch Diagnostic:\n\nStatus: ${data.status.toUpperCase()}\nDetails: ${data.message}`);
      fetchAdminData();
    } catch (err: any) {
      alert("Test email failed: " + err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  // Organizer Actions: Cancel Reservation
  const handleCancelBooking = (booking: Booking) => {
    setBookingToCancel(booking);
  };

  const confirmCancelBooking = async () => {
    if (!bookingToCancel) return;
    setCancelLoading(true);
    try {
      await apiService.cancelBooking(bookingToCancel.bookingId);
      setBookings((prev) =>
        prev.map((b) =>
          b.bookingId === bookingToCancel.bookingId ? { ...b, status: "Cancelled" } : b
        )
      );
      setCancelSuccessMsg();
      setBookingToCancel(null);
      fetchBookingsData();
      triggerAvailabilityCheck();
    } catch (err: any) {
      setGlobalError("Failed to cancel reservation: " + (err.message || err));
    } finally {
      setCancelLoading(false);
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
            {authMode !== "forgot" && (
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
            )}

            {authMode === "forgot" ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="mb-4">
                  <h3 className="text-slate-900 font-display font-semibold text-lg mb-1">Forgot Password</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Enter your registered email address, and we'll send you a secure link to reset your account credentials instantly.
                  </p>
                </div>

                {forgotError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2.5 text-xs text-red-700">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                    <span>{forgotError}</span>
                  </div>
                )}

                {forgotSuccess && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start space-x-2.5 text-xs text-emerald-800">
                    <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{forgotSuccess}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                </div>

                <button
                  id="submit-forgot-btn"
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-850 text-white rounded-lg text-sm font-semibold shadow-md transition-all flex justify-center items-center cursor-pointer disabled:opacity-55"
                >
                  {forgotLoading ? <RefreshCw className="h-4 w-4 animate-spin text-blue-500 mr-2" /> : null}
                  Send Password Reset Link
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("login");
                      setForgotError(null);
                      setForgotSuccess(null);
                    }}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-all cursor-pointer inline-flex items-center"
                  >
                    ← Back to Sign In
                  </button>
                </div>
              </form>
            ) : authMode === "login" ? (
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
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                  <p className="text-[10px] text-slate-400">Please log in with your registered email.</p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label htmlFor="login-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("forgot");
                        setForgotEmail(loginEmail);
                        setForgotError(null);
                        setForgotSuccess(null);
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-all cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <input
                    id="login-pass"
                    type="password"
                    required
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
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                  <p className="text-[10px] text-slate-500 font-medium">⚠️ Any valid email address can register.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="reg-department" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Department <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="reg-department"
                    required
                    value={regDepartment}
                    onChange={(e) => setRegDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all cursor-pointer font-medium"
                  >
                    <option value="" disabled>-- Select Your Department --</option>
                    {DEPARTMENT_LIST.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="reg-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="reg-pass"
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="reg-confirm-pass" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Re-Enter Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="reg-confirm-pass"
                      type="password"
                      required
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
            className="text-white/85 hover:text-white font-bold px-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Banner indicating cancellation success if any */}
      {cancelSuccessMsg && (
        <div className="bg-emerald-600 text-white text-xs px-4 py-2 flex justify-between items-center z-50">
          <div className="flex items-center space-x-2">
            <Check className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{cancelSuccessMsg}</span>
          </div>
          <button
            id="clear-cancel-msg-btn"
            onClick={() => setCancelSuccessMsg(null)}
            className="text-white/85 hover:text-white font-bold px-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {currentUser && !currentUser.emailVerified && (
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
                      setCurrentUser(null);
                      setActiveTab("book");
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer border border-red-100 bg-red-50/50 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-all"
                  >
                    Logout Admin
                  </button>
                </>
              ) : currentUser ? (
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
                      setCurrentUser(null);
                      setActiveTab("book");
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer border border-red-100 bg-red-50/50 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-all"
                  >
                    Sign Out
                  </button>
                </>
              ) : null}
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
                {(() => {
                  const isAdminUser = currentUser?.role?.toLowerCase() === "admin" || currentUser?.role === "Admin";
                  const count = bookings.filter((b) => {
                    if (isAdminUser) return true;
                    return (
                      (currentUser?.uid && b.userId === currentUser.uid) ||
                      (currentUser?.email && b.bookerEmail?.toLowerCase() === currentUser.email?.toLowerCase())
                    );
                  }).length;
                  return count > 0 ? (
                    <span className="bg-slate-900 text-blue-400 font-bold px-1.5 py-0.2 rounded-full text-[9px]">
                      {count}
                    </span>
                  ) : null;
                })()}
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

              <button
                id="tab-feedback-btn"
                onClick={() => {
                  setActiveTab("feedback");
                  apiService.getFeedbacks().then(setFeedbacks).catch(console.error);
                }}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                  activeTab === "feedback"
                    ? "bg-blue-600 text-white shadow-md font-bold"
                    : "text-slate-300 hover:text-white hover:bg-slate-700"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Feedback</span>
              </button>
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
                  <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                    <div className="flex items-center space-x-2">
                      <Sliders className="text-blue-600 h-5 w-5" />
                      <h3 className="font-display font-semibold text-slate-900">Room Preferences</h3>
                    </div>
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                      🕒 10 AM – 7 PM
                    </span>
                  </div>

                  <form onSubmit={triggerAvailabilityCheck} className="space-y-4">
                    <div className="space-y-1">
                      <label htmlFor="search-date" className="block text-xs font-semibold text-slate-600 uppercase">
                        Date <span className="text-[10px] text-blue-600 font-normal">(Up to 5 days)</span>
                      </label>
                      <div className="relative">
                        <input
                          id="search-date"
                          type="date"
                          value={searchDate}
                          min={new Date().toLocaleDateString("en-CA")}
                          max={(() => {
                            const d = new Date();
                            d.setDate(d.getDate() + 5);
                            return d.toLocaleDateString("en-CA");
                          })()}
                          onChange={(e) => setSearchDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                        />
                        <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      </div>
                      <p className="text-[10px] text-slate-400">Bookings permitted up to 5 days in advance.</p>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="search-floor" className="block text-xs font-semibold text-slate-600 uppercase">
                        Floor Number
                      </label>
                      <select
                        id="search-floor"
                        value={searchFloor}
                        onChange={(e) => setSearchFloor(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                      >
                        <option value="All">All Floors</option>
                        <option value="Floor 1">Floor 1</option>
                        <option value="Floor 2">Floor 2</option>
                        <option value="Floor 3">Floor 3</option>
                        <option value="Floor 4">Floor 4</option>
                        <option value="Floor 5">Floor 5</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="search-target-time" className="block text-xs font-semibold text-slate-600 uppercase">
                        Preferred Meeting Time <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <select
                        id="search-target-time"
                        value={searchTargetTime}
                        onChange={(e) => setSearchTargetTime(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                      >
                        <option value="">Any Time (Show All Slots)</option>
                        <option value="10:00">10:00 AM</option>
                        <option value="10:15">10:15 AM</option>
                        <option value="10:30">10:30 AM</option>
                        <option value="10:45">10:45 AM</option>
                        <option value="11:00">11:00 AM</option>
                        <option value="11:15">11:15 AM</option>
                        <option value="11:30">11:30 AM</option>
                        <option value="11:45">11:45 AM</option>
                        <option value="12:00">12:00 PM</option>
                        <option value="12:15">12:15 PM</option>
                        <option value="12:30">12:30 PM</option>
                        <option value="12:45">12:45 PM</option>
                        <option value="13:00">01:00 PM</option>
                        <option value="13:15">01:15 PM</option>
                        <option value="13:30">01:30 PM</option>
                        <option value="13:45">01:45 PM</option>
                        <option value="14:00">02:00 PM</option>
                        <option value="14:15">02:15 PM</option>
                        <option value="14:30">02:30 PM</option>
                        <option value="14:45">02:45 PM</option>
                        <option value="15:00">03:00 PM</option>
                        <option value="15:15">03:15 PM</option>
                        <option value="15:30">03:30 PM</option>
                        <option value="15:45">03:45 PM</option>
                        <option value="16:00">04:00 PM</option>
                        <option value="16:15">04:15 PM</option>
                        <option value="16:30">04:30 PM</option>
                        <option value="16:45">04:45 PM</option>
                        <option value="17:00">05:00 PM</option>
                        <option value="17:15">05:15 PM</option>
                        <option value="17:30">05:30 PM</option>
                        <option value="17:45">05:45 PM</option>
                        <option value="18:00">06:00 PM</option>
                        <option value="18:15">06:15 PM</option>
                        <option value="18:30">06:30 PM</option>
                        <option value="18:45">06:45 PM</option>
                      </select>
                      <p className="text-[10px] text-slate-400">Highlights slots around this time without hiding other available times.</p>
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
                        Duration <span className="text-[10px] text-amber-600 font-normal">(Max 1 hour)</span>
                      </label>
                      <div className="relative">
                        <select
                          id="search-duration"
                          value={searchDuration}
                          onChange={(e) => setSearchDuration(parseInt(e.target.value))}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all appearance-none"
                        >
                          <option value="15">15 Minutes</option>
                          <option value="30">30 Minutes</option>
                          <option value="45">45 Minutes</option>
                          <option value="60">1 Hour (Max Allowed)</option>
                        </select>
                        <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <label className="block text-xs font-semibold text-slate-600 uppercase">
                        Required Room Features
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {["AC", "Whiteboard", "Projector", "TV Screen"].map((feature) => {
                          const isSelected = selectedFeatures.includes(feature);
                          return (
                            <button
                              id={`feature-btn-${feature}`}
                              key={feature}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedFeatures(selectedFeatures.filter(f => f !== feature));
                                } else {
                                  setSelectedFeatures([...selectedFeatures, feature]);
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-blue-50 border-blue-300 text-blue-700 font-bold"
                                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              <span>{feature}</span>
                              {isSelected && <span className="text-blue-600 text-[10px]">✓</span>}
                            </button>
                          );
                        })}
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
                      <h3 className="font-display font-semibold text-slate-900 text-lg flex items-center gap-2">
                        <span>Suggested Available Meeting Rooms</span>
                        <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                          Hours: 10:00 AM – 07:00 PM
                        </span>
                      </h3>

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
                      <p className="text-xs text-slate-400 mt-1">Adjust attendees size, floor, or date query constraint.</p>
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
                              <div className="flex items-center space-x-2 mt-1 text-xs text-slate-500">
                                <div className="flex items-center space-x-1">
                                  <Users className="w-3.5 h-3.5" />
                                  <span>Up to {rec.room.capacity} attendees</span>
                                </div>
                                <span className="text-slate-300">•</span>
                                <span className="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                                  📍 {rec.room.floor || "Floor 1"}
                                </span>
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
                                  const isTarget = searchTargetTime && slot === searchTargetTime;

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
                                      className={`py-1.5 px-2 text-xs font-semibold rounded-lg border text-center transition-all cursor-pointer relative ${
                                        isSelected
                                          ? "bg-blue-600 text-white border-blue-600 shadow-sm font-bold scale-105"
                                          : isTarget
                                          ? "bg-blue-50 text-blue-900 border-blue-500 ring-2 ring-blue-400 font-bold shadow-xs"
                                          : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                                      }`}
                                    >
                                      {isTarget && !isSelected && (
                                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                        </span>
                                      )}
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

                      {currentUser && !currentUser.emailVerified ? (
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
                          {/* Booker Identification Details (Read-only as they are logged in) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/40 p-4 rounded-xl mb-4 border border-slate-800">
                            <div className="flex flex-col space-y-1.5">
                              <span className="text-xs font-semibold text-slate-400">YOUR NAME</span>
                              <span className="text-sm font-semibold text-white bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                                {currentUser?.name || "Employee"}
                              </span>
                            </div>
                            <div className="flex flex-col space-y-1.5">
                              <span className="text-xs font-semibold text-slate-400">EMAIL ADDRESS</span>
                              <span className="text-sm font-semibold text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 font-mono">
                                {currentUser?.email}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col space-y-1.5 mb-5">
                            <label htmlFor="booking-reason" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Meeting Agenda <span className="text-red-500">*</span>
                            </label>
                            <input
                              id="booking-reason"
                              type="text"
                              required
                              placeholder="e.g. Q3 Strategy Discussion"
                              value={bookingReason}
                              onChange={(e) => setBookingReason(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-slate-850 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                            />
                            <p className="text-[10px] text-slate-500">⚠️ Entering a meeting agenda is mandatory for corporate tracking.</p>
                          </div>

                          {/* Meeting Type Selection */}
                          <div className="flex flex-col space-y-1.5 mb-5">
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Type of Meeting <span className="text-red-500">*</span>
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => setMeetingType("Internal")}
                                className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all cursor-pointer text-center ${
                                  meetingType === "Internal"
                                    ? "bg-blue-600 border-blue-500 text-white"
                                    : "bg-slate-850 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                              >
                                Internal Meeting
                              </button>
                              <button
                                type="button"
                                onClick={() => setMeetingType("External")}
                                className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all cursor-pointer text-center ${
                                  meetingType === "External"
                                    ? "bg-blue-600 border-blue-500 text-white"
                                    : "bg-slate-850 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                              >
                                External Meeting
                              </button>
                            </div>
                          </div>

                          {/* Conditional External Visitor Information Section */}
                          {meetingType === "External" && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="bg-slate-850/60 border border-slate-800 rounded-xl p-4 mb-5 space-y-4"
                            >
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                                <div className="flex items-center space-x-2">
                                  <Users className="h-4 w-4 text-blue-400" />
                                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                                    External Guest / Visitor Details
                                  </h4>
                                </div>
                                <span className="text-[11px] font-semibold text-blue-300 bg-blue-950/60 border border-blue-800/50 px-2.5 py-0.5 rounded-full">
                                  {externalGuests.length} {externalGuests.length === 1 ? "Guest" : "Guests"}
                                </span>
                              </div>

                              {externalGuests.map((guest, idx) => (
                                <div
                                  key={idx}
                                  className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5 space-y-3 transition-all hover:border-slate-700"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                                      <span className="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center text-[10px] font-mono">
                                        {idx + 1}
                                      </span>
                                      <span>Guest #{idx + 1} {idx === 0 ? "(Primary Visitor)" : ""}</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveGuest(idx)}
                                      className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors text-xs flex items-center gap-1 cursor-pointer"
                                      title={externalGuests.length > 1 ? "Remove guest" : "Clear guest details"}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      <span className="text-[10px]">{externalGuests.length > 1 ? "Remove" : "Clear"}</span>
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex flex-col space-y-1">
                                      <label className="text-[10px] font-semibold text-slate-400">
                                        GUEST NAME <span className="text-red-500">*</span>
                                      </label>
                                      <input
                                        type="text"
                                        required
                                        placeholder="e.g. John Doe"
                                        value={guest.name}
                                        onChange={(e) => {
                                          handleGuestChange(idx, "name", e.target.value);
                                          if (idx === 0) setExternalName(e.target.value);
                                        }}
                                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                      />
                                    </div>

                                    <div className="flex flex-col space-y-1">
                                      <label className="text-[10px] font-semibold text-slate-400">
                                        COMPANY / ORGANIZATION
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="e.g. ABC Corp"
                                        value={guest.company || ""}
                                        onChange={(e) => {
                                          handleGuestChange(idx, "company", e.target.value);
                                          if (idx === 0) setExternalCompany(e.target.value);
                                        }}
                                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                      />
                                    </div>

                                    <div className="flex flex-col space-y-1">
                                      <label className="text-[10px] font-semibold text-slate-400">
                                        EMAIL ADDRESS <span className="text-slate-500">(Optional)</span>
                                      </label>
                                      <input
                                        type="email"
                                        placeholder="e.g. guest@company.com"
                                        value={guest.email || ""}
                                        onChange={(e) => handleGuestChange(idx, "email", e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                      />
                                    </div>

                                    <div className="flex flex-col space-y-1">
                                      <label className="text-[10px] font-semibold text-slate-400">
                                        PHONE / CONTACT <span className="text-slate-500">(Optional)</span>
                                      </label>
                                      <input
                                        type="tel"
                                        placeholder="e.g. +91 9876543210"
                                        value={guest.phone || ""}
                                        onChange={(e) => handleGuestChange(idx, "phone", e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex flex-col space-y-1">
                                    <label className="text-[10px] font-semibold text-slate-400">
                                      WHOM TO MEET AT PS GROUP <span className="text-red-500">* (Mandatory)</span>
                                    </label>
                                    <input
                                      type="text"
                                      required
                                      placeholder={bookerName || "Employee Name"}
                                      value={guest.whomToMeet || ""}
                                      onChange={(e) => {
                                        handleGuestChange(idx, "whomToMeet", e.target.value);
                                        if (idx === 0) setExternalWhomToMeet(e.target.value);
                                      }}
                                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                    />
                                  </div>
                                </div>
                              ))}

                              <button
                                type="button"
                                onClick={handleAddGuest}
                                className="w-full py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-blue-500/50 rounded-lg text-xs font-semibold text-blue-400 hover:text-blue-300 transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                              >
                                <Plus className="h-4 w-4" />
                                <span>Add Another Guest / Visitor</span>
                              </button>
                            </motion.div>
                          )}

                          {/* Additional Requirements */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-850 p-4 rounded-xl mb-5 border border-slate-800">
                            <div className="space-y-3">
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Additional Services</span>
                              
                              <label className="flex items-center space-x-3 text-sm text-slate-200 cursor-pointer select-none">
                                <input
                                  id="it-support-checkbox"
                                  type="checkbox"
                                  checked={itSupportRequired}
                                  onChange={(e) => setItSupportRequired(e.target.checked)}
                                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="font-medium">IT Support Required</span>
                              </label>

                              <label className="flex items-center space-x-3 text-sm text-slate-200 cursor-pointer select-none">
                                <input
                                  id="fb-checkbox"
                                  type="checkbox"
                                  checked={fbRequired}
                                  onChange={(e) => setFbRequired(e.target.checked)}
                                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="font-medium">F&B Required (Food & Beverages)</span>
                              </label>
                            </div>

                            <div className="space-y-2 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-4 flex flex-col justify-center">
                              {itSupportRequired ? (
                                <div className="p-3 bg-blue-900/30 border border-blue-500/30 rounded-xl space-y-1">
                                  <div className="flex items-center space-x-2 text-xs font-bold text-blue-400">
                                    <Mail className="h-3.5 w-3.5 text-blue-400" />
                                    <span>IT Helpdesk Automated Dispatch</span>
                                  </div>
                                  <p className="text-[11px] text-slate-300 leading-snug">
                                    Meeting details (date, time, room, host) will be emailed directly to <strong className="text-blue-300 font-semibold">ithelpdesk@psgroup.in</strong> with an attached calendar event invite.
                                  </p>
                                </div>
                              ) : (
                                <div className="p-3 bg-slate-800/60 border border-slate-750 rounded-xl">
                                  <p className="text-[11px] text-slate-400 leading-snug">
                                    Check <strong className="text-slate-300 font-medium">IT Support Required</strong> if you require projector, video conference setup, audio equipment, or tech assistance during your meeting.
                                  </p>
                                </div>
                              )}
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
          {activeTab === "my-bookings" && (() => {
            const isAdmin = currentUser?.role?.toLowerCase() === "admin" || currentUser?.role === "Admin";

            // Helper to resolve department for any booking (from booking.department or host user profile)
            const getBookingDepartment = (booking: Booking): string => {
              if (booking.department && booking.department.trim() !== "" && booking.department !== "N/A") {
                return booking.department;
              }
              if (booking.bookerEmail) {
                const match = adminUsers.find(
                  (u) => u.email?.toLowerCase() === booking.bookerEmail?.toLowerCase() || u.uid === booking.userId
                );
                if (match?.department) {
                  return match.department;
                }
              }
              return "N/A";
            };

            // 1. User Visibility Scope Filter: Admin sees all, Regular users see only their own bookings
            const visibleBookings = bookings.filter((booking) => {
              if (isAdmin) return true;
              const matchUid = currentUser?.uid && booking.userId === currentUser.uid;
              const matchEmail = currentUser?.email && booking.bookerEmail?.toLowerCase() === currentUser.email?.toLowerCase();
              return matchUid || matchEmail;
            });

            // Helper to determine if a booking is past or cancelled
            const now = new Date();
            const todayISO = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
            const currentHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

            const isPastOrCancelled = (b: Booking): boolean => {
              if (b.status === "Cancelled") return true;
              if (!b.date) return false;
              if (b.date < todayISO) return true;
              if (b.date === todayISO) {
                if (b.startTime && b.startTime < currentHM) {
                  return true;
                }
              }
              return false;
            };

            // 2. Separate into Upcoming vs Past & Cancelled
            const upcomingBookings = visibleBookings.filter((b) => !isPastOrCancelled(b));
            const pastCancelledBookings = visibleBookings.filter((b) => isPastOrCancelled(b));

            const currentTabBookings = reservationTimeTab === "upcoming" ? upcomingBookings : pastCancelledBookings;

            const openFilterModal = () => {
              setTempDepartment(filterDepartment);
              setTempITSupport(filterITSupport);
              setTempFB(filterFB);
              setTempMeetingType(filterMeetingType);
              setTempRoomId(filterRoomId);
              setTempStatus(filterStatus);
              setTempStartDate(filterStartDate);
              setTempEndDate(filterEndDate);
              setDeptSearchInModal("");
              setShowFilterModal(true);
            };

            const applyModalFilters = () => {
              setFilterDepartment(tempDepartment);
              setFilterITSupport(tempITSupport);
              setFilterFB(tempFB);
              setFilterMeetingType(tempMeetingType);
              setFilterRoomId(tempRoomId);
              setFilterStatus(tempStatus);
              setFilterStartDate(tempStartDate);
              setFilterEndDate(tempEndDate);
              setShowFilterModal(false);
            };

            const resetAllActiveFilters = () => {
              setFilterDepartment("All");
              setFilterITSupport("All");
              setFilterFB("All");
              setFilterMeetingType("All");
              setFilterRoomId("All");
              setFilterStatus("All");
              setFilterStartDate("");
              setFilterEndDate("");
              setReservationFilterCategory("All");
              setReservationSearchQuery("");
            };

            const activeFilterCount = (() => {
              let count = 0;
              if (filterDepartment !== "All") count++;
              if (filterITSupport !== "All") count++;
              if (filterFB !== "All") count++;
              if (filterMeetingType !== "All") count++;
              if (filterRoomId !== "All") count++;
              if (filterStatus !== "All") count++;
              if (filterStartDate !== "" || filterEndDate !== "") count++;
              if (reservationFilterCategory !== "All") count++;
              return count;
            })();

            const tempActiveFilterCount = (() => {
              let count = 0;
              if (tempDepartment !== "All") count++;
              if (tempITSupport !== "All") count++;
              if (tempFB !== "All") count++;
              if (tempMeetingType !== "All") count++;
              if (tempRoomId !== "All") count++;
              if (tempStatus !== "All") count++;
              if (tempStartDate !== "" || tempEndDate !== "") count++;
              return count;
            })();

            // Multi-facet filter logic applied on currentTabBookings
            const filteredBookings = currentTabBookings.filter((booking) => {
              const room = rooms.find((r) => r.roomId === booking.roomId);
              const roomName = room ? room.name.toLowerCase() : "";
              const hostName = (booking.bookerName || "").toLowerCase();
              const hostEmail = (booking.bookerEmail || "").toLowerCase();
              const deptName = getBookingDepartment(booking).toLowerCase();
              const reason = (booking.reason || "").toLowerCase();
              const externalName = (booking.externalName || "").toLowerCase();
              const externalCompany = (booking.externalCompany || "").toLowerCase();
              const externalWhomToMeet = (booking.externalWhomToMeet || "").toLowerCase();
              const externalGuestsStr = (booking.externalGuests || [])
                .map(g => `${g.name} ${g.company || ""} ${g.email || ""} ${g.phone || ""} ${g.whomToMeet || ""}`)
                .join(" ")
                .toLowerCase();
              const dateStr = (booking.date || "").toLowerCase();
              const startTimeStr = (booking.startTime || "").toLowerCase();

              // Quick Category Pill Filter
              if (reservationFilterCategory === "IT" && !booking.itSupportRequired) return false;
              if (reservationFilterCategory === "FB" && !booking.fbRequired) return false;
              if (reservationFilterCategory === "External" && booking.meetingType !== "External") return false;

              // Department Facet Filter
              if (filterDepartment !== "All" && deptName !== filterDepartment.toLowerCase()) {
                return false;
              }

              // IT Support Facet Filter
              if (filterITSupport === "Yes" && !booking.itSupportRequired) return false;
              if (filterITSupport === "No" && booking.itSupportRequired) return false;

              // F&B Facet Filter
              if (filterFB === "Yes" && !booking.fbRequired) return false;
              if (filterFB === "No" && booking.fbRequired) return false;

              // Meeting Type Facet Filter
              if (filterMeetingType !== "All" && booking.meetingType !== filterMeetingType) return false;

              // Room Location Facet Filter
              if (filterRoomId !== "All" && booking.roomId !== filterRoomId) return false;

              // Status Facet Filter
              if (filterStatus !== "All" && booking.status !== filterStatus) return false;

              // Date Range Facet Filter
              if (filterStartDate && booking.date < filterStartDate) return false;
              if (filterEndDate && booking.date > filterEndDate) return false;

              // Multi-field text query
              if (!reservationSearchQuery.trim()) return true;

              const query = reservationSearchQuery.toLowerCase().trim();

              const isYes = query === "yes";
              const isNo = query === "no";

              const matchesIT = booking.itSupportRequired && (
                query.includes("it") || query.includes("support") || query.includes("tech") || isYes
              );
              const matchesFB = booking.fbRequired && (
                query.includes("f&b") || query.includes("fb") || query.includes("food") || query.includes("beverage") || isYes
              );

              const matchesNoIT = !booking.itSupportRequired && (query.includes("no it") || isNo);
              const matchesNoFB = !booking.fbRequired && (query.includes("no f&b") || query.includes("no fb") || isNo);

              return (
                hostName.includes(query) ||
                hostEmail.includes(query) ||
                deptName.includes(query) ||
                reason.includes(query) ||
                externalName.includes(query) ||
                externalCompany.includes(query) ||
                externalWhomToMeet.includes(query) ||
                externalGuestsStr.includes(query) ||
                dateStr.includes(query) ||
                startTimeStr.includes(query) ||
                roomName.includes(query) ||
                matchesIT ||
                matchesFB ||
                matchesNoIT ||
                matchesNoFB
              );
            });

            // Sort by meeting date & start time (most recent / upcoming date popped first)
            filteredBookings.sort((a, b) => {
              if (reservationTimeTab === "upcoming") {
                // Soonest upcoming meeting date & start time first
                const dateCmp = (a.date || "").localeCompare(b.date || "");
                if (dateCmp !== 0) return dateCmp;
                return (a.startTime || "").localeCompare(b.startTime || "");
              } else {
                // Most recently occurred / cancelled date first
                const dateCmp = (b.date || "").localeCompare(a.date || "");
                if (dateCmp !== 0) return dateCmp;
                return (b.startTime || "").localeCompare(a.startTime || "");
              }
            });

            return (
              <motion.div
                key="bookings-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.15 }}
                className="space-y-6"
              >
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  {/* Top Header Section */}
                  <div className="flex flex-col gap-4 mb-6 border-b border-slate-100 pb-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="font-display font-semibold text-slate-900 text-lg flex items-center gap-2">
                          <span>{isAdmin ? "All System Reservations (Admin)" : "My Bookings & Reservations"}</span>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            {visibleBookings.length} Total
                          </span>
                        </h3>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Flipkart / Amazon Style Filter Button */}
                        <button
                          id="open-filter-modal-btn"
                          onClick={openFilterModal}
                          className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 border border-blue-200 rounded-xl transition-all cursor-pointer flex items-center space-x-2 text-xs font-bold shadow-sm"
                          title="Open Advanced Multi-Facet Filter Pop-up"
                        >
                          <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                          <span>Filter &amp; Refine</span>
                          {activeFilterCount > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-black bg-blue-600 text-white rounded-full ml-1">
                              {activeFilterCount}
                            </span>
                          )}
                        </button>

                        <button
                          id="refresh-my-bookings-btn"
                          onClick={() => fetchBookingsData()}
                          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-all cursor-pointer flex items-center space-x-1.5 text-xs font-semibold"
                          title="Refresh Reservations"
                        >
                          <RefreshCw className="h-4 w-4" />
                          <span className="hidden sm:inline">Refresh</span>
                        </button>
                      </div>
                    </div>

                    {/* Sub-Tabs: Upcoming Meetings vs Past & Cancelled Meetings */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="inline-flex p-1 bg-slate-100/90 rounded-xl border border-slate-200">
                        <button
                          id="tab-upcoming-meetings-btn"
                          type="button"
                          onClick={() => setReservationTimeTab("upcoming")}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
                            reservationTimeTab === "upcoming"
                              ? "bg-white text-blue-700 shadow-sm border border-slate-200"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                          }`}
                        >
                          <CalendarCheck className="h-4 w-4 text-blue-600" />
                          <span>Upcoming Meetings</span>
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-extrabold ${
                            reservationTimeTab === "upcoming"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-200 text-slate-700"
                          }`}>
                            {upcomingBookings.length}
                          </span>
                        </button>

                        <button
                          id="tab-past-cancelled-btn"
                          type="button"
                          onClick={() => setReservationTimeTab("past_cancelled")}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
                            reservationTimeTab === "past_cancelled"
                              ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                          }`}
                        >
                          <History className="h-4 w-4 text-slate-500" />
                          <span>Past &amp; Cancelled Meetings</span>
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-extrabold ${
                            reservationTimeTab === "past_cancelled"
                              ? "bg-slate-800 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}>
                            {pastCancelledBookings.length}
                          </span>
                        </button>
                      </div>

                      <div className="text-xs text-slate-400 font-medium flex items-center space-x-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>
                          {reservationTimeTab === "upcoming"
                            ? "Sorted by Meeting Date (Nearest Upcoming First)"
                            : "Sorted by Meeting Date (Most Recent Past First)"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Search Bar & Category Controls */}
                  <div className="mb-6 space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                    <div className="relative flex items-center">
                      <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                      <input
                        id="reservation-search-input"
                        type="text"
                        value={reservationSearchQuery}
                        onChange={(e) => setReservationSearchQuery(e.target.value)}
                        placeholder="Search by host name, email, department, guest name, agenda, date/time..."
                        className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                      />
                      {reservationSearchQuery && (
                        <button
                          onClick={() => setReservationSearchQuery("")}
                          className="absolute right-3 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Quick Filter Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-400 mr-1">Quick Filters:</span>
                        <button
                          onClick={() => setReservationFilterCategory("All")}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            reservationFilterCategory === "All"
                              ? "bg-slate-900 text-white shadow-sm"
                              : "bg-white text-slate-600 hover:bg-slate-200 border border-slate-200"
                          }`}
                        >
                          All Items
                        </button>
                        <button
                          onClick={() => setReservationFilterCategory("IT")}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
                            reservationFilterCategory === "IT"
                              ? "bg-purple-600 text-white shadow-sm"
                              : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                          }`}
                        >
                          <span>🔌 IT Support</span>
                        </button>
                        <button
                          onClick={() => setReservationFilterCategory("FB")}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
                            reservationFilterCategory === "FB"
                              ? "bg-rose-600 text-white shadow-sm"
                              : "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                          }`}
                        >
                          <span>☕ F&B Required</span>
                        </button>
                        <button
                          onClick={() => setReservationFilterCategory("External")}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
                            reservationFilterCategory === "External"
                              ? "bg-amber-600 text-white shadow-sm"
                              : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
                          }`}
                        >
                          <span>👤 External Visitors</span>
                        </button>
                      </div>

                      <div className="text-xs text-slate-500 font-medium">
                        Showing <strong className="text-slate-800">{filteredBookings.length}</strong> of {currentTabBookings.length} {reservationTimeTab === "upcoming" ? "upcoming" : "past/cancelled"} reservations
                      </div>
                    </div>

                    {/* Active Applied Filter Chips */}
                    {activeFilterCount > 0 && (
                      <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Filters:</span>
                        {filterDepartment !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-blue-100 text-blue-900 rounded-lg text-xs font-bold border border-blue-200">
                            <span>🏢 Dept: {filterDepartment}</span>
                            <button onClick={() => setFilterDepartment("All")} className="hover:text-blue-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {filterITSupport !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-purple-100 text-purple-900 rounded-lg text-xs font-bold border border-purple-200">
                            <span>🔌 IT Support: {filterITSupport}</span>
                            <button onClick={() => setFilterITSupport("All")} className="hover:text-purple-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {filterFB !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-100 text-rose-900 rounded-lg text-xs font-bold border border-rose-200">
                            <span>☕ F&B: {filterFB}</span>
                            <button onClick={() => setFilterFB("All")} className="hover:text-rose-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {filterMeetingType !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg text-xs font-bold border border-amber-200">
                            <span>👥 Scope: {filterMeetingType}</span>
                            <button onClick={() => setFilterMeetingType("All")} className="hover:text-amber-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {filterRoomId !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-bold border border-emerald-200">
                            <span>🚪 Room: {rooms.find(r => r.roomId === filterRoomId)?.name || filterRoomId}</span>
                            <button onClick={() => setFilterRoomId("All")} className="hover:text-emerald-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {filterStatus !== "All" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-300">
                            <span>📌 Status: {filterStatus}</span>
                            <button onClick={() => setFilterStatus("All")} className="hover:text-slate-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {(filterStartDate || filterEndDate) && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-100 text-indigo-900 rounded-lg text-xs font-bold border border-indigo-200">
                            <span>📅 Range: {filterStartDate || "Start"} → {filterEndDate || "End"}</span>
                            <button onClick={() => { setFilterStartDate(""); setFilterEndDate(""); }} className="hover:text-indigo-600 p-0.5 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}

                        <button
                          onClick={resetAllActiveFilters}
                          className="text-xs font-bold text-red-600 hover:text-red-800 hover:underline ml-auto flex items-center space-x-1 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Clear All Filters</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {bookingsLoading ? (
                    <div className="py-20 flex flex-col items-center justify-center">
                      <RefreshCw className="h-8 w-8 text-slate-400 animate-spin mb-3" />
                      <p className="text-sm text-slate-500">Loading schedules...</p>
                    </div>
                  ) : currentTabBookings.length === 0 ? (
                    <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                      {reservationTimeTab === "upcoming" ? (
                        <CalendarCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                      ) : (
                        <History className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                      )}
                      <p className="text-slate-700 font-semibold text-sm">
                        {reservationTimeTab === "upcoming"
                          ? "No Upcoming Meetings"
                          : "No Past or Cancelled Meetings"}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 mb-4 max-w-md mx-auto">
                        {reservationTimeTab === "upcoming"
                          ? isAdmin
                            ? "There are currently no upcoming room reservations scheduled across the system."
                            : "You do not have any upcoming room reservations booked."
                          : "There are no past or cancelled meeting records."}
                      </p>
                      {reservationTimeTab === "upcoming" && (
                        <button
                          id="book-first-room-btn"
                          onClick={() => setActiveTab("book")}
                          className="inline-flex items-center px-4 py-2 bg-slate-950 text-white hover:bg-slate-850 font-bold text-xs rounded-lg shadow cursor-pointer"
                        >
                          Book a Room Now
                        </button>
                      )}
                    </div>
                  ) : filteredBookings.length === 0 ? (
                    <div className="py-12 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                      <Search className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-700 font-semibold text-sm">No reservations match your filter criteria</p>
                      <p className="text-xs text-slate-400 mt-1 mb-3">Try clearing filters or selecting a different criteria.</p>
                      <button
                        onClick={resetAllActiveFilters}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg transition-all cursor-pointer inline-flex items-center space-x-1"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Clear All Active Filters</span>
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Room Name</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Booked By (Host &amp; Dept)</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Agenda &amp; Requirements</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Start Time</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200 text-sm">
                          {filteredBookings.map((booking) => {
                            const room = rooms.find((r) => r.roomId === booking.roomId);
                            const roomName = room ? room.name : "Meeting Room";
                            const bookingDept = getBookingDepartment(booking);

                            return (
                              <tr key={booking.bookingId} className="hover:bg-slate-50/50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="font-semibold text-slate-900">{roomName}</div>
                                  <div className="text-xs text-slate-400">ID: {booking.bookingId.substring(0, 10)}...</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="font-semibold text-slate-900">{booking.bookerName || "Guest User"}</div>
                                  <div className="text-xs text-slate-500 font-mono">{booking.bookerEmail || "N/A"}</div>
                                  <div className="mt-1">
                                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                                      <Building className="h-2.5 w-2.5 text-blue-600" />
                                      <span>{bookingDept}</span>
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap max-w-xs text-slate-700 font-medium">
                                  <div className="truncate font-semibold text-slate-850" title={booking.reason}>
                                    {booking.reason || "Corporate Meeting"}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    {booking.meetingType === "External" ? (
                                      <>
                                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-850 uppercase tracking-wider">
                                          External
                                        </span>
                                        <span className="text-[10px] text-slate-500 font-medium max-w-[180px] truncate" title={`Visitor: ${booking.externalName} (${booking.externalCompany || "N/A"}) - Meeting: ${booking.externalWhomToMeet}`}>
                                          👤 {booking.externalName} ({booking.externalCompany || "N/A"})
                                        </span>
                                      </>
                                    ) : (
                                      <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-850 uppercase tracking-wider">
                                        Internal
                                      </span>
                                    )}
                                    {booking.itSupportRequired && (
                                      <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-purple-100 text-purple-850 uppercase tracking-wider flex items-center space-x-1">
                                        <span>🔌 IT Support</span>
                                      </span>
                                    )}
                                    {booking.fbRequired && (
                                      <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-100 text-rose-850 uppercase tracking-wider">
                                        ☕ F&B Required
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-slate-600">{booking.date}</td>
                                <td className="px-6 py-4 whitespace-nowrap font-mono font-medium text-blue-600">{booking.startTime}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-slate-600">{booking.duration} mins</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`px-2.5 py-1 text-xs font-bold rounded-full uppercase tracking-wider ${
                                    booking.status === "Cancelled"
                                      ? "bg-red-100 text-red-800"
                                      : booking.status === "Approved"
                                        ? "bg-green-100 text-green-800"
                                        : "bg-slate-100 text-slate-800"
                                  }`}>
                                    {booking.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {booking.status !== "Cancelled" ? (
                                      <button
                                        id={`cancel-btn-${booking.bookingId}`}
                                        onClick={() => handleCancelBooking(booking)}
                                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-800 border border-red-200 rounded text-xs font-bold transition-all cursor-pointer shrink-0"
                                      >
                                        Cancel
                                      </button>
                                    ) : null}

                                    {booking.status !== "Cancelled" ? (
                                      <>
                                        <button
                                          id={`ics-btn-${booking.bookingId}`}
                                          onClick={() => handleExportICS(booking, roomName, false)}
                                          className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 border border-blue-200 rounded text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 shrink-0"
                                          title="Download calendar event file (.ics) for your calendar"
                                        >
                                          <span>📅 Calendar (.ics)</span>
                                        </button>

                                        {booking.itSupportRequired && (
                                          <button
                                            id={`it-mail-btn-${booking.bookingId}`}
                                            onClick={() => handleEmailITHelpdesk(booking, roomName)}
                                            className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 hover:text-purple-900 border border-purple-200 rounded text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 shrink-0"
                                            title="Trigger automated server email dispatch to it@psgroup.in"
                                          >
                                            <Mail className="h-3 w-3 text-purple-600" />
                                            <span>Send Email to IT</span>
                                          </button>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-xs text-slate-400 font-medium italic">Cancelled</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ==================== MULTI-FACET FILTER POPUP MODAL ==================== */}
                <AnimatePresence>
                  {showFilterModal && (
                    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-6 bg-slate-900/65 backdrop-blur-sm">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.18 }}
                        className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[85vh] max-h-[720px]"
                      >
                        {/* Modal Header */}
                        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
                          <div className="flex items-center space-x-3">
                            <div className="p-2.5 bg-blue-600 rounded-xl text-white shadow-md shadow-blue-500/20">
                              <SlidersHorizontal className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-display font-semibold text-base flex items-center gap-2">
                                <span>Filter &amp; Refine Reservations</span>
                                {tempActiveFilterCount > 0 && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-500 text-white shadow-sm">
                                    {tempActiveFilterCount} Active
                                  </span>
                                )}
                              </h3>
                              <p className="text-xs text-slate-400">Select categories on the left to filter room reservations.</p>
                            </div>
                          </div>
                          <button
                            id="close-filter-modal-btn"
                            type="button"
                            onClick={() => setShowFilterModal(false)}
                            className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        {/* Removable Active Filter Chips Bar */}
                        {tempActiveFilterCount > 0 && (
                          <div className="px-6 py-2.5 bg-blue-50/70 border-b border-blue-100 flex items-center flex-wrap gap-2 text-xs shrink-0">
                            <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider mr-1">Active Filters:</span>
                            {tempDepartment !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                🏢 {tempDepartment}
                                <button type="button" onClick={() => setTempDepartment("All")} className="hover:text-blue-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {tempRoomId !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                🚪 Room: {rooms.find(r => r.roomId === tempRoomId)?.name || tempRoomId}
                                <button type="button" onClick={() => setTempRoomId("All")} className="hover:text-blue-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {tempITSupport !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-purple-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                🔌 IT Support: {tempITSupport}
                                <button type="button" onClick={() => setTempITSupport("All")} className="hover:text-purple-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {tempFB !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                ☕ F&amp;B: {tempFB}
                                <button type="button" onClick={() => setTempFB("All")} className="hover:text-rose-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {tempMeetingType !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                👥 Scope: {tempMeetingType}
                                <button type="button" onClick={() => setTempMeetingType("All")} className="hover:text-amber-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {tempStatus !== "All" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-800 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                📌 Status: {tempStatus}
                                <button type="button" onClick={() => setTempStatus("All")} className="hover:text-slate-300 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}
                            {(tempStartDate !== "" || tempEndDate !== "") && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold text-[11px] gap-1 shadow-xs">
                                📅 Range: {tempStartDate || "Start"} → {tempEndDate || "End"}
                                <button type="button" onClick={() => { setTempStartDate(""); setTempEndDate(""); }} className="hover:text-emerald-200 cursor-pointer ml-1">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setTempDepartment("All");
                                setTempITSupport("All");
                                setTempFB("All");
                                setTempMeetingType("All");
                                setTempRoomId("All");
                                setTempStatus("All");
                                setTempStartDate("");
                                setTempEndDate("");
                              }}
                              className="text-[11px] font-extrabold text-blue-700 hover:underline cursor-pointer ml-auto"
                            >
                              Clear All
                            </button>
                          </div>
                        )}

                        {/* Modal Body: Flipkart / Amazon 2-Pane Split View */}
                        <div className="flex-1 flex overflow-hidden">
                          {/* LEFT SIDEBAR: Category Facet Navigation */}
                          <div className="w-52 sm:w-64 bg-slate-50 border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
                            <div className="p-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-200/80">
                              Filter Categories
                            </div>
                            <nav className="p-2 space-y-1">
                              {/* 1. Department Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("department")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "department"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <Building className={`h-4 w-4 ${activeModalFacet === "department" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>Department</span>
                                </span>
                                {tempDepartment !== "All" && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>

                              {/* 2. Room Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("room")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "room"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <DoorClosed className={`h-4 w-4 ${activeModalFacet === "room" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>Meeting Room</span>
                                </span>
                                {tempRoomId !== "All" && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>

                              {/* 3. Requirements Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("requirements")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "requirements"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <Cpu className={`h-4 w-4 ${activeModalFacet === "requirements" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>IT &amp; F&amp;B Services</span>
                                </span>
                                {(tempITSupport !== "All" || tempFB !== "All") && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>

                              {/* 4. Scope Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("scope")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "scope"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <Users className={`h-4 w-4 ${activeModalFacet === "scope" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>Meeting Scope</span>
                                </span>
                                {tempMeetingType !== "All" && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>

                              {/* 5. Status Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("status")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "status"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <CheckCircle2 className={`h-4 w-4 ${activeModalFacet === "status" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>Booking Status</span>
                                </span>
                                {tempStatus !== "All" && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>

                              {/* 6. Date Facet */}
                              <button
                                type="button"
                                onClick={() => setActiveModalFacet("date")}
                                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  activeModalFacet === "date"
                                    ? "bg-white text-blue-700 shadow-sm border border-slate-200 font-bold"
                                    : "text-slate-700 hover:bg-slate-200/70"
                                }`}
                              >
                                <span className="flex items-center space-x-2">
                                  <Calendar className={`h-4 w-4 ${activeModalFacet === "date" ? "text-blue-600" : "text-slate-400"}`} />
                                  <span>Date Range</span>
                                </span>
                                {(tempStartDate !== "" || tempEndDate !== "") && (
                                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                )}
                              </button>
                            </nav>
                          </div>

                          {/* RIGHT CONTENT PANEL: Active Facet Options */}
                          <div className="flex-1 p-6 overflow-y-auto bg-white">
                            {/* DEPARTMENT FACET PANEL */}
                            {activeModalFacet === "department" && (
                              <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                                  <div>
                                    <h4 className="font-bold text-sm text-slate-900">Filter by Department</h4>
                                    <p className="text-xs text-slate-500">Select host department responsible for the reservation slot.</p>
                                  </div>

                                  <div className="relative w-full sm:w-64">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                    <input
                                      type="text"
                                      placeholder="Search department..."
                                      value={deptSearchInModal}
                                      onChange={(e) => setDeptSearchInModal(e.target.value)}
                                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-[380px] overflow-y-auto pr-1">
                                  <button
                                    type="button"
                                    onClick={() => setTempDepartment("All")}
                                    className={`p-3 rounded-xl text-xs text-left transition-all cursor-pointer flex items-center justify-between border ${
                                      tempDepartment === "All"
                                        ? "bg-slate-900 text-white border-slate-900 font-bold shadow-sm"
                                        : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                    }`}
                                  >
                                    <span>All Departments</span>
                                    {tempDepartment === "All" && <Check className="h-4 w-4 text-blue-400" />}
                                  </button>

                                  {DEPARTMENT_LIST.filter(d => d.toLowerCase().includes(deptSearchInModal.toLowerCase().trim())).map((dept) => {
                                    const isSelected = tempDepartment === dept;
                                    return (
                                      <button
                                        key={dept}
                                        type="button"
                                        onClick={() => setTempDepartment(dept)}
                                        className={`p-3 rounded-xl text-xs text-left transition-all cursor-pointer flex items-center justify-between border ${
                                          isSelected
                                            ? "bg-blue-50 text-blue-900 border-blue-500 font-bold shadow-xs"
                                            : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                        }`}
                                      >
                                        <span>{dept}</span>
                                        {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* ROOM FACET PANEL */}
                            {activeModalFacet === "room" && (
                              <div className="space-y-4">
                                <div className="border-b border-slate-100 pb-3">
                                  <h4 className="font-bold text-sm text-slate-900">Filter by Meeting Room</h4>
                                  <p className="text-xs text-slate-500">Filter reservation entries booked inside a specific facility room.</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                                  <button
                                    type="button"
                                    onClick={() => setTempRoomId("All")}
                                    className={`p-3.5 rounded-xl text-xs text-left transition-all cursor-pointer border flex items-center justify-between ${
                                      tempRoomId === "All"
                                        ? "bg-slate-900 text-white border-slate-900 font-bold shadow-sm"
                                        : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                    }`}
                                  >
                                    <div>
                                      <div className="font-bold">All Meeting Rooms</div>
                                      <div className="text-[11px] opacity-70">Show slots across all facilities</div>
                                    </div>
                                    {tempRoomId === "All" && <Check className="h-4 w-4 text-blue-400" />}
                                  </button>

                                  {rooms.map((room) => {
                                    const isSelected = tempRoomId === room.roomId;
                                    return (
                                      <button
                                        key={room.roomId}
                                        type="button"
                                        onClick={() => setTempRoomId(room.roomId)}
                                        className={`p-3.5 rounded-xl text-xs text-left transition-all cursor-pointer border flex items-center justify-between ${
                                          isSelected
                                            ? "bg-blue-50 text-blue-950 border-blue-500 font-bold shadow-xs"
                                            : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                        }`}
                                      >
                                        <div>
                                          <div className="font-bold flex items-center gap-1.5">
                                            <span>{room.name}</span>
                                            <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                                              Cap: {room.capacity}
                                            </span>
                                          </div>
                                          <div className="text-[11px] text-slate-500 mt-0.5">Floor: {room.floor}</div>
                                        </div>
                                        {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* IT & F&B REQUIREMENTS FACET PANEL */}
                            {activeModalFacet === "requirements" && (
                              <div className="space-y-6">
                                <div className="border-b border-slate-100 pb-3">
                                  <h4 className="font-bold text-sm text-slate-900">IT &amp; Food / Beverage Services</h4>
                                  <p className="text-xs text-slate-500">Refine by tech assistance or catering requests attached to the reservation.</p>
                                </div>

                                {/* IT Support Toggle */}
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                    <Cpu className="h-4 w-4 text-purple-600" />
                                    <span>IT Tech Support Assistance</span>
                                  </label>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(["All", "Yes", "No"] as const).map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => setTempITSupport(opt)}
                                        className={`py-2.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                                          tempITSupport === opt
                                            ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                                        }`}
                                      >
                                        {opt === "All" ? "Any IT Status" : opt === "Yes" ? "Required (Yes)" : "Not Required"}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* F&B Catering Toggle */}
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                    <Coffee className="h-4 w-4 text-rose-600" />
                                    <span>Food &amp; Refreshments Catering</span>
                                  </label>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(["All", "Yes", "No"] as const).map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => setTempFB(opt)}
                                        className={`py-2.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                                          tempFB === opt
                                            ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                                        }`}
                                      >
                                        {opt === "All" ? "Any F&B Status" : opt === "Yes" ? "Required (Yes)" : "Not Required"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* MEETING SCOPE FACET PANEL */}
                            {activeModalFacet === "scope" && (
                              <div className="space-y-4">
                                <div className="border-b border-slate-100 pb-3">
                                  <h4 className="font-bold text-sm text-slate-900">Meeting Scope &amp; Guest Type</h4>
                                  <p className="text-xs text-slate-500">Filter between internal team sessions or external client meetings.</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {[
                                    { id: "All", title: "All Meetings", desc: "Internal staff and external guests" },
                                    { id: "Internal", title: "Internal Only", desc: "Only internal staff attendees" },
                                    { id: "External", title: "External Visitors", desc: "Includes registered client/guest visitors" }
                                  ].map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() => setTempMeetingType(item.id as any)}
                                      className={`p-4 rounded-xl text-xs text-left transition-all cursor-pointer border flex flex-col justify-between ${
                                        tempMeetingType === item.id
                                          ? "bg-amber-50 text-amber-950 border-amber-500 font-bold shadow-xs"
                                          : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                      }`}
                                    >
                                      <div>
                                        <div className="font-bold text-sm">{item.title}</div>
                                        <p className="text-[11px] text-slate-500 mt-1 font-normal">{item.desc}</p>
                                      </div>
                                      {tempMeetingType === item.id && (
                                        <div className="mt-3 text-amber-600 font-extrabold flex items-center gap-1">
                                          <Check className="h-4 w-4" /> Selected
                                        </div>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* RESERVATION STATUS FACET PANEL */}
                            {activeModalFacet === "status" && (
                              <div className="space-y-4">
                                <div className="border-b border-slate-100 pb-3">
                                  <h4 className="font-bold text-sm text-slate-900">Reservation Status</h4>
                                  <p className="text-xs text-slate-500">Filter by booking state in the room schedule system.</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {[
                                    { id: "All", title: "All Statuses", desc: "Include both active and cancelled slots" },
                                    { id: "Approved", title: "Approved / Active", desc: "Confirmed locked reservation slots" },
                                    { id: "Cancelled", title: "Cancelled", desc: "Previously cancelled reservations" }
                                  ].map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() => setTempStatus(item.id as any)}
                                      className={`p-4 rounded-xl text-xs text-left transition-all cursor-pointer border flex flex-col justify-between ${
                                        tempStatus === item.id
                                          ? "bg-blue-50 text-blue-950 border-blue-500 font-bold shadow-xs"
                                          : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                                      }`}
                                    >
                                      <div>
                                        <div className="font-bold text-sm">{item.title}</div>
                                        <p className="text-[11px] text-slate-500 mt-1 font-normal">{item.desc}</p>
                                      </div>
                                      {tempStatus === item.id && (
                                        <div className="mt-3 text-blue-600 font-extrabold flex items-center gap-1">
                                          <Check className="h-4 w-4" /> Selected
                                        </div>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* DATE FACET PANEL */}
                            {activeModalFacet === "date" && (
                              <div className="space-y-5">
                                <div className="border-b border-slate-100 pb-3">
                                  <h4 className="font-bold text-sm text-slate-900">Meeting Date Range</h4>
                                  <p className="text-xs text-slate-500">Filter room bookings within a specific start and end date window.</p>
                                </div>

                                <div className="max-w-lg bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-bold text-slate-700 block">From (Start Date):</label>
                                      <input
                                        type="date"
                                        value={tempStartDate}
                                        onChange={(e) => setTempStartDate(e.target.value)}
                                        className="w-full px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-bold text-slate-700 block">To (End Date):</label>
                                      <input
                                        type="date"
                                        value={tempEndDate}
                                        onChange={(e) => setTempEndDate(e.target.value)}
                                        className="w-full px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80">
                                    <span className="text-[11px] font-bold text-slate-500 mr-1">Presets:</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const today = new Date().toLocaleDateString("en-CA");
                                        setTempStartDate(today);
                                        setTempEndDate(today);
                                      }}
                                      className="px-2.5 py-1.5 bg-white hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                    >
                                      Today
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const tmr = new Date();
                                        tmr.setDate(tmr.getDate() + 1);
                                        const tmrISO = tmr.toLocaleDateString("en-CA");
                                        setTempStartDate(tmrISO);
                                        setTempEndDate(tmrISO);
                                      }}
                                      className="px-2.5 py-1.5 bg-white hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                    >
                                      Tomorrow
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const now = new Date();
                                        const todayISO = now.toLocaleDateString("en-CA");
                                        const next7 = new Date();
                                        next7.setDate(now.getDate() + 7);
                                        const next7ISO = next7.toLocaleDateString("en-CA");
                                        setTempStartDate(todayISO);
                                        setTempEndDate(next7ISO);
                                      }}
                                      className="px-2.5 py-1.5 bg-white hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                    >
                                      Next 7 Days
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const now = new Date();
                                        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-CA");
                                        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString("en-CA");
                                        setTempStartDate(firstDay);
                                        setTempEndDate(lastDay);
                                      }}
                                      className="px-2.5 py-1.5 bg-white hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                    >
                                      This Month
                                    </button>
                                    {(tempStartDate || tempEndDate) && (
                                      <button
                                        type="button"
                                        onClick={() => { setTempStartDate(""); setTempEndDate(""); }}
                                        className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold transition-all cursor-pointer ml-auto"
                                      >
                                        Clear Dates
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between shrink-0">
                          <button
                            id="reset-temp-filters-btn"
                            type="button"
                            onClick={() => {
                              setTempDepartment("All");
                              setTempITSupport("All");
                              setTempFB("All");
                              setTempMeetingType("All");
                              setTempRoomId("All");
                              setTempStatus("All");
                              setTempStartDate("");
                              setTempEndDate("");
                              setDeptSearchInModal("");
                            }}
                            className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center space-x-1 cursor-pointer"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Reset All Filters</span>
                          </button>

                          <div className="flex items-center space-x-3">
                            <button
                              id="cancel-filter-modal-btn"
                              type="button"
                              onClick={() => setShowFilterModal(false)}
                              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                            >
                              Cancel
                            </button>

                            <button
                              id="apply-modal-filters-btn"
                              type="button"
                              onClick={applyModalFilters}
                              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all cursor-pointer flex items-center space-x-1.5"
                            >
                              <Check className="h-4 w-4" />
                              <span>Apply Filters ({tempActiveFilterCount})</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })()}

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

              {/* Database Maintenance */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="sm:flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-display font-semibold text-slate-900 text-lg">Database & Maintenance</h3>
                    <p className="text-xs text-slate-500">Manage global bookings and clean up past records.</p>
                  </div>
                  <button
                    id="admin-clear-bookings-btn"
                    onClick={async () => {
                      try {
                        setAdminLoading(true);
                        await apiService.clearAllBookings();
                        setCancelSuccessMsg("All bookings have been successfully removed.");
                        fetchBookingsData();
                        fetchAdminData();
                      } catch (err: any) {
                        setGlobalError("Failed to clear bookings: " + err.message);
                      } finally {
                        setAdminLoading(false);
                      }
                    }}
                    className="mt-2 sm:mt-0 inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-750 text-white font-bold text-xs rounded-lg shadow cursor-pointer transition-all animate-pulse"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Wipe All Bookings
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Clicking this button will permanently delete all meeting reservations from Firestore, allowing you to start with a fresh booking schedule.
                </p>
              </div>

              {/* Outbound Email & IT Notification Logs */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="sm:flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-display font-semibold text-slate-900 text-lg flex items-center gap-2">
                      <Mail className="h-5 w-5 text-purple-600" />
                      <span>Outbound Email & IT Notification Logs (it@psgroup.in)</span>
                    </h3>
                    <p className="text-xs text-slate-500">Real-time status of outgoing emails, SMTP delivery states, and error diagnostics.</p>
                  </div>
                  <div className="flex items-center space-x-2 mt-2 sm:mt-0">
                    <button
                      id="admin-refresh-notifs-btn"
                      onClick={fetchAdminData}
                      className="inline-flex items-center px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-all cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      Refresh Logs
                    </button>
                    <button
                      id="admin-test-email-btn"
                      onClick={handleSendTestITEmail}
                      className="inline-flex items-center px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-lg shadow transition-all cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Test Email Dispatch
                    </button>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-4 text-xs text-amber-900 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>How IT Email Notifications Work in Cloud Environments:</span>
                  </p>
                  <p className="text-amber-800 leading-relaxed">
                    • <strong>Status "LOGGED_ONLY":</strong> The system generated the email and recorded it in the database. Outbound SMTP credentials (<code className="bg-amber-100 px-1 rounded">SMTP_HOST</code>, <code className="bg-amber-100 px-1 rounded">SMTP_USER</code>, <code className="bg-amber-100 px-1 rounded">SMTP_PASS</code>) are not configured in environment variables, so the email was logged safely rather than sent to inbox.
                  </p>
                  <p className="text-amber-800 leading-relaxed">
                    • <strong>Status "SUCCESS":</strong> Email was dispatched through SMTP server directly to <code className="bg-amber-100 px-1 rounded">it@psgroup.in</code>.
                  </p>
                  <p className="text-amber-800 leading-relaxed">
                    • <strong>Status "FAILED":</strong> SMTP server attempted delivery but returned an error (e.g. invalid host or credentials).
                  </p>
                </div>

                {notificationLogs.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-xs font-medium">No outbound email notifications logged yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                          <th className="px-4 py-3">Timestamp</th>
                          <th className="px-4 py-3">Recipient</th>
                          <th className="px-4 py-3">Subject</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Diagnostic Message / Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {notificationLogs.map((log) => {
                          const statusColor =
                            log.status === "success"
                              ? "bg-green-100 text-green-800 border-green-200"
                              : log.status === "failed"
                                ? "bg-red-100 text-red-800 border-red-200"
                                : "bg-amber-100 text-amber-800 border-amber-200";

                          const statusLabel =
                            log.status === "success"
                              ? "SUCCESS (SENT)"
                              : log.status === "failed"
                                ? "FAILED"
                                : "LOGGED (NO SMTP)";

                          return (
                            <tr key={log.notificationId} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                                {new Date(log.sentAt).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-800">{log.emailTo}</td>
                              <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={log.subject}>
                                {log.subject}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor}`}>
                                  {statusLabel}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600 max-w-md text-[11px] leading-relaxed">
                                {log.errorMessage || (log.status === "logged_only" ? "Recorded in database (SMTP server credentials not configured)" : "Delivered successfully.")}
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

          {/* ==================== TAB 4: FEEDBACK & EXPERIENCES ==================== */}
          {activeTab === "feedback" && (
            <motion.div
              key="feedback-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.15 }}
              className="space-y-8 max-w-4xl mx-auto"
            >
              {/* Header Box */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-900">Amenities &amp; App Experience Feedback</h3>
                    <p className="text-xs text-slate-500">Rate room amenities (AC, Projector, Wi-Fi, Cleanliness) and your booking portal experience.</p>
                  </div>
                </div>
              </div>

              {/* Feedback Submission Form */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <h4 className="font-display font-semibold text-slate-900 text-base mb-4 border-b border-slate-100 pb-3">
                  Submit Feedback
                </h4>

                {feedbackSuccess && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 text-emerald-800 mb-6">
                    <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-emerald-900">Feedback Submitted Successfully</p>
                      <p className="text-xs text-emerald-700 mt-1">{feedbackSuccess}</p>
                    </div>
                  </div>
                )}

                {feedbackError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-800 mb-6">
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-900">Submission Error</p>
                      <p className="text-xs text-red-700 mt-1">{feedbackError}</p>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSubmitFeedback} className="space-y-6">
                  {/* Select Associated Meeting Room Reservation */}
                  <div className="space-y-1.5">
                    <label htmlFor="feedback-booking-select" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Select Recent Meeting / Room (Optional)
                    </label>
                    <select
                      id="feedback-booking-select"
                      value={feedbackSelectedBookingId}
                      onChange={(e) => setFeedbackSelectedBookingId(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                    >
                      <option value="">General Application Feedback</option>
                      {bookings.map((b) => {
                        const r = rooms.find(rm => rm.roomId === b.roomId);
                        return (
                          <option key={b.bookingId} value={b.bookingId}>
                            {r ? r.name : b.roomId} — {b.date} at {b.startTime} ({b.reason || "Meeting"})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Room Amenities Rating */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Room Amenities Experience (AC, Screen, Wi-Fi, Seating)
                    </label>
                    <div className="flex items-center space-x-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={`amenities-star-${star}`}
                          type="button"
                          onClick={() => setFeedbackAmenitiesRating(star)}
                          className={`p-2 rounded-lg transition-all cursor-pointer ${
                            star <= feedbackAmenitiesRating
                              ? "text-amber-400 bg-amber-50 hover:bg-amber-100"
                              : "text-slate-300 hover:text-slate-400 bg-slate-50"
                          }`}
                        >
                          <Star className="h-6 w-6 fill-current" />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-slate-700 ml-2">
                        {feedbackAmenitiesRating === 5 ? "⭐⭐⭐⭐⭐ Excellent" :
                         feedbackAmenitiesRating === 4 ? "⭐⭐⭐⭐ Very Good" :
                         feedbackAmenitiesRating === 3 ? "⭐⭐⭐ Good" :
                         feedbackAmenitiesRating === 2 ? "⭐⭐ Fair" : "⭐ Needs Improvement"}
                      </span>
                    </div>
                  </div>

                  {/* App Booking Portal Rating */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Portal &amp; Booking Experience
                    </label>
                    <div className="flex items-center space-x-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={`app-star-${star}`}
                          type="button"
                          onClick={() => setFeedbackAppRating(star)}
                          className={`p-2 rounded-lg transition-all cursor-pointer ${
                            star <= feedbackAppRating
                              ? "text-blue-500 bg-blue-50 hover:bg-blue-100"
                              : "text-slate-300 hover:text-slate-400 bg-slate-50"
                          }`}
                        >
                          <Star className="h-6 w-6 fill-current" />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-slate-700 ml-2">
                        {feedbackAppRating === 5 ? "⭐⭐⭐⭐⭐ Outstanding" :
                         feedbackAppRating === 4 ? "⭐⭐⭐⭐ Great" :
                         feedbackAppRating === 3 ? "⭐⭐⭐ Satisfactory" :
                         feedbackAppRating === 2 ? "⭐⭐ Average" : "⭐ Difficult"}
                      </span>
                    </div>
                  </div>

                  {/* Comments */}
                  <div className="space-y-1.5">
                    <label htmlFor="feedback-comments" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Comments &amp; Improvement Suggestions
                    </label>
                    <textarea
                      id="feedback-comments"
                      rows={4}
                      value={feedbackComments}
                      onChange={(e) => setFeedbackComments(e.target.value)}
                      placeholder="Share details regarding room temp, screen connectivity, cleanliness, or suggestions for the booking portal..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all resize-none"
                    />
                  </div>

                  <button
                    id="submit-feedback-btn"
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md transition-all flex justify-center items-center cursor-pointer disabled:opacity-55"
                  >
                    {feedbackSubmitting ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                        <span>Submitting Feedback...</span>
                      </>
                    ) : (
                      <span>Submit Experience Feedback</span>
                    )}
                  </button>
                </form>
              </div>

              {/* Automated Email Feedback Request Prompt Section */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <h4 className="font-display font-semibold text-slate-900 text-base mb-2">
                  Request Feedback from Organizer
                </h4>
                <p className="text-xs text-slate-500 mb-4">
                  Send an automated polite feedback request email directly to the meeting organizer after a meeting concludes.
                </p>

                {bookings.filter(b => b.status === "Approved").length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No approved bookings available for feedback requests.</p>
                ) : (
                  <div className="space-y-2">
                    {bookings.filter(b => b.status === "Approved").slice(0, 5).map((b) => {
                      const r = rooms.find(rm => rm.roomId === b.roomId);
                      return (
                        <div key={`fb-email-${b.bookingId}`} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                          <div>
                            <span className="font-bold text-slate-800">{r ? r.name : b.roomId}</span>
                            <span className="text-slate-400 mx-2">•</span>
                            <span className="text-slate-600">{b.bookerName} ({b.bookerEmail})</span>
                            <span className="text-slate-400 mx-2">•</span>
                            <span className="text-slate-500 font-mono">{b.date} {b.startTime}</span>
                          </div>
                          <button
                            id={`send-fb-req-${b.bookingId}`}
                            onClick={() => handleSendFeedbackEmail(b)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center space-x-1 shrink-0"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            <span>Send Feedback Email</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Feedback History List */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                  <h4 className="font-display font-semibold text-slate-900 text-base">
                    Submitted Portal &amp; Room Feedbacks
                  </h4>
                  <button
                    onClick={() => apiService.getFeedbacks().then(setFeedbacks).catch(console.error)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 transition-all cursor-pointer"
                    title="Refresh Feedbacks"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>

                {feedbacks.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-xs font-medium">No feedback recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {feedbacks.map((fb) => (
                      <div key={fb.feedbackId} className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-slate-900">{fb.roomName}</span>
                            <span className="text-slate-400 mx-2">•</span>
                            <span className="text-slate-600 font-medium">{fb.userName} ({fb.userEmail})</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(fb.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-slate-700">
                          <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-bold text-[11px]">
                            Amenities: {"★".repeat(fb.ratingAmenities)} ({fb.ratingAmenities}/5)
                          </span>
                          <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded font-bold text-[11px]">
                            Portal: {"★".repeat(fb.ratingApp)} ({fb.ratingApp}/5)
                          </span>
                        </div>
                        {fb.comments && (
                          <p className="text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200/80 italic">
                            "{fb.comments}"
                          </p>
                        )}
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

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                  <p className="font-semibold text-slate-700">Concurrent Admin Role Sign-In:</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => { setLoginEmail("admin-reception"); setLoginPassword("QW!@12"); }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-left hover:border-blue-500 font-medium cursor-pointer"
                    >
                      🏢 Receptionist
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginEmail("admin-hospitality"); setLoginPassword("QW!@12"); }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-left hover:border-blue-500 font-medium cursor-pointer"
                    >
                      ☕ Hospitality Dept
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginEmail("admin-it"); setLoginPassword("QW!@12"); }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-left hover:border-blue-500 font-medium cursor-pointer"
                    >
                      💻 IT Dept
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginEmail("admin"); setLoginPassword("QW!@12"); }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-left hover:border-blue-500 font-medium cursor-pointer"
                    >
                      🛡️ General Admin
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="admin-id-input" className="block text-xs font-semibold text-slate-700 uppercase">Admin Username / ID</label>
                  <input
                    id="admin-id-input"
                    type="text"
                    required
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

      {/* Cancellation Confirmation Modal */}
      <AnimatePresence>
        {bookingToCancel && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200"
            >
              <div className="flex items-center space-x-3 mb-4 text-red-600">
                <div className="p-3 bg-red-100 rounded-full shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Cancel Reservation</h3>
                  <p className="text-xs text-slate-500">Confirm cancellation of this meeting room booking.</p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2 mb-6">
                <div className="flex justify-between text-slate-600">
                  <span className="font-medium text-slate-500">Room:</span>
                  <span className="font-bold text-slate-800">
                    {rooms.find((r) => r.roomId === bookingToCancel.roomId)?.name || bookingToCancel.roomId}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-medium text-slate-500">Date &amp; Time:</span>
                  <span className="font-bold text-slate-800">
                    {bookingToCancel.date} at {bookingToCancel.startTime} ({bookingToCancel.duration} mins)
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-medium text-slate-500">Booker / Host:</span>
                  <span className="font-bold text-slate-800">
                    {bookingToCancel.bookerName || "Employee"} ({bookingToCancel.bookerEmail || "N/A"})
                  </span>
                </div>
                {bookingToCancel.reason && (
                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium text-slate-500">Agenda:</span>
                    <span className="font-medium text-slate-700 italic truncate max-w-[200px]">
                      {bookingToCancel.reason}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setBookingToCancel(null)}
                  disabled={cancelLoading}
                  className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Keep Reservation
                </button>
                <button
                  type="button"
                  onClick={confirmCancelBooking}
                  disabled={cancelLoading}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 transition-all cursor-pointer flex items-center space-x-2"
                >
                  {cancelLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Cancelling...</span>
                    </>
                  ) : (
                    <span>Yes, Cancel Reservation</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
