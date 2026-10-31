import type { OrgSubscription } from "./plans.js";

export type OrgRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "pending" | "disabled";

export interface OrgSettings {
  workdayStart: string; // "HH:MM"
  workdayEnd: string; // "HH:MM"
  maxDurationMins: number;
  maxAdvanceDays: number;
  bufferMins: number;
  slotStepMins: number;
  departments: string[];
}

export interface OrgNotifications {
  itEmail?: string;
  hospitalityEmail?: string;
  contactEmail?: string; // shown to users ("If no rooms are available, contact…")
}

export interface Org {
  orgId: string;
  name: string;
  logoUrl?: string;
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  emailDomains: string[]; // e.g. ["psgroup.in"]
  allowDomainSignup: boolean; // anyone with a verified email on these domains may join
  requireApproval: boolean; // domain joiners start as "pending"
  restrictParticipantsToDomains: boolean;
  settings: OrgSettings;
  notifications: OrgNotifications;
  subscription: OrgSubscription;
  ownerUid: string;
  createdAt: string;
}

export interface Member {
  uid: string;
  email: string;
  name: string;
  role: OrgRole;
  status: MemberStatus;
  department?: string;
  createdAt: string;
}

export interface Membership {
  uid: string;
  orgId: string;
  email: string;
}

export interface Invite {
  token: string;
  orgId: string;
  orgName: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export const DEFAULT_SETTINGS: OrgSettings = {
  workdayStart: "10:00",
  workdayEnd: "19:00",
  maxDurationMins: 60,
  maxAdvanceDays: 5,
  bufferMins: 15,
  slotStepMins: 15,
  departments: [],
};
