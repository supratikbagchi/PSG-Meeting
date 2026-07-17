export interface User {
  uid: string;
  email: string;
  name: string;
  role: "User" | "Admin";
  isApproved: boolean;
  createdAt: string;
  department?: string;
}

export interface Room {
  roomId: string;
  name: string;
  capacity: number;
  features: string[];
}

export interface Booking {
  bookingId: string;
  userId?: string;
  roomId: string;
  date: string;
  startTime: string;
  duration: number;
  status: "pending" | "Approved" | "Rejected" | "Cancelled";
  createdAt: string;
  bookerName?: string;
  bookerEmail?: string;
  attendeesCount?: number;
  reason: string;
  meetingType?: "Internal" | "External";
  externalName?: string;
  externalCompany?: string;
  externalWhomToMeet?: string;
  itSupportRequired?: boolean;
  fbRequired?: boolean;
  outlookEventId?: string;
  outlookSynced?: boolean;
}

export interface NotificationLog {
  notificationId: string;
  bookingId: string;
  emailTo: string;
  subject: string;
  body: string;
  sentAt: string;
  priority: "Normal" | "High";
  status: "success" | "logged_only";
}

export interface Recommendation {
  room: Room;
  availableSlots: string[];
  slots?: { time: string; isAvailable: boolean; bookedBy?: string }[];
}

export interface AdminActivityLog {
  logId: string;
  adminEmail: string;
  adminName: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
}
