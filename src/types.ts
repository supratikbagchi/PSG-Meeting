/** Suggested departments offered when an organisation sets up its own list. */
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
  orgRole?: "owner" | "admin" | "member";
  status?: "active" | "pending" | "disabled";
  isApproved: boolean;
  emailVerified?: boolean;
  createdAt: string;
  department?: string;
}

export type PlanTier = "starter" | "business" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";

export interface Plan {
  tier: PlanTier;
  name: string;
  monthlyPriceInr: number | null;
  roomLimit: number | null;
  userLimit: number | null;
  features: string[];
}

export interface OrgSettings {
  workdayStart: string;
  workdayEnd: string;
  maxDurationMins: number;
  maxAdvanceDays: number;
  bufferMins: number;
  slotStepMins: number;
  departments: string[];
}

export interface Org {
  orgId: string;
  name: string;
  logoUrl?: string;
  timezone: string;
  emailDomains: string[];
  restrictParticipantsToDomains: boolean;
  allowDomainSignup?: boolean;
  requireApproval?: boolean;
  ownerUid?: string;
  createdAt?: string;
  settings: OrgSettings;
  notifications: { itEmail?: string; hospitalityEmail?: string; contactEmail?: string };
  subscription: {
    tier: PlanTier;
    planName: string;
    status: SubscriptionStatus;
    canWrite: boolean;
    trialEndsAt?: string;
    currentPeriodEnd?: string;
    graceEndsAt?: string;
    roomLimit: number | null;
    userLimit: number | null;
  };
}

export interface Session {
  auth: { uid: string; email: string; emailVerified: boolean };
  isPlatformAdmin: boolean;
  user: User | null;
  org: Org | null;
  pendingInvites: { token: string; orgName: string; role: string }[];
  domainOrg: { orgId: string; name: string; requireApproval: boolean } | null;
  plans: Plan[];
}

export interface OrgInvite {
  token: string;
  orgId: string;
  orgName: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired?: boolean;
  link?: string;
}

export interface PlatformOrg {
  orgId: string;
  name: string;
  emailDomains: string[];
  createdAt: string;
  ownerUid: string;
  members: number;
  rooms: number;
  subscription: Org["subscription"] & { effectiveStatus: SubscriptionStatus; provider?: string };
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
