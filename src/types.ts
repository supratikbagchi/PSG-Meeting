export const DEPARTMENT_LIST = [
  "BIM",
  "Budgeting and Cost Control",
  "Central Monitoring Cell",
  "Contracts",
  "Corporate Legal",
  "Customer Care and Credit Assistance",
  "Customer Connect",
  "Customer Relationship",
  "EHS & Security",
  "Enterprise Technology & Automation",
  "ESG",
  "Facility and Operations",
  "Finance and Taxation / Accounts",
  "Government Approval and Compliances",
  "Human Resources",
  "Ideation and Design Management",
  "Land Legal",
  "Litigation and Dispute",
  "MEP",
  "Planning",
  "Plant and Machinery",
  "Procurement",
  "QA and QC",
  "Secretarial",
  "Stores"
] as const;

export interface User {
  uid: string;
  email: string;
  name: string;
  role: "User" | "Admin";
  isApproved: boolean;
  emailVerified?: boolean;
  createdAt: string;
  department?: string;
  passwordHash?: string;
}

export interface Room {
  roomId: string;
  name: string;
  capacity: number;
  features: string[];
  floor?: string | number;
}

export interface FeedbackItem {
  feedbackId: string;
  bookingId?: string;
  roomName?: string;
  userEmail: string;
  userName: string;
  amenitiesRating: number; // 1-5
  appRating: number; // 1-5
  comments: string;
  createdAt: string;
}

export interface ExternalGuest {
  guestId?: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  whomToMeet?: string;
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
  department?: string;
  attendeesCount?: number;
  reason: string;
  meetingType?: "Internal" | "External";
  externalName?: string;
  externalCompany?: string;
  externalWhomToMeet?: string;
  externalGuests?: ExternalGuest[];
  participantEmails?: string[];
  itSupportRequired?: boolean;
  fbRequired?: boolean;
  outlookEventId?: string;
  outlookSynced?: boolean;
  emailDeliveryNote?: string;
}

export interface NotificationLog {
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
