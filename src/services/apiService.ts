import { User, Room, Booking, NotificationLog, Recommendation, AdminActivityLog } from "../types";

const API_BASE = "/api";

// Fetch helper to inject JWT authorization header automatically
async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body: any = null
): Promise<T> {
  const token = localStorage.getItem("ps_booking_token");
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
  }

  return response.json() as Promise<T>;
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
   * Login credentials verification
   */
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const data = await apiRequest<{ token: string; user: User }>("/auth/login", "POST", { email, password });
    this.setSession(data.token, data.user);
    return data;
  },

  /**
   * Register a new corporate employee profile
   */
  async register(email: string, password: string, name: string): Promise<{ message: string; user: User }> {
    return apiRequest<{ message: string; user: User }>("/auth/register", "POST", { email, password, name });
  },

  /**
   * Get authenticated user profile details from backend
   */
  async getProfile(): Promise<{ user: User }> {
    try {
      const data = await apiRequest<{ user: User }>("/auth/me", "GET");
      localStorage.setItem("ps_booking_user", JSON.stringify(data.user));
      return data;
    } catch (err) {
      this.logout();
      throw err;
    }
  },

  // ==================== ROOM PORTAL SERVICE ====================

  /**
   * Fetch all registered meeting rooms
   */
  async getRooms(): Promise<Room[]> {
    return apiRequest<Room[]>("/rooms", "GET");
  },

  /**
   * Create a new corporate meeting room
   */
  async addRoom(name: string, capacity: number, features: string[]): Promise<Room> {
    return apiRequest<Room>("/rooms", "POST", { name, capacity, features });
  },

  /**
   * Modify properties of an existing meeting room
   */
  async updateRoom(roomId: string, name: string, capacity: number, features: string[]): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`, "PUT", { name, capacity, features });
  },

  /**
   * Remove a meeting room
   */
  async deleteRoom(roomId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/rooms/${roomId}`, "DELETE");
  },

  // ==================== BOOKING PORTAL SERVICE ====================

  /**
   * Fetch accessible booking logs (Admins see all, Users see their own)
   */
  async getBookings(): Promise<Booking[]> {
    return apiRequest<Booking[]>("/bookings", "GET");
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
    return apiRequest<{ message: string; booking: Booking }>("/bookings", "POST", bookingDetails);
  },

  /**
   * Modify the status of a pending reservation request (Approved or Rejected)
   */
  async updateBookingStatus(bookingId: string, status: "Approved" | "Rejected"): Promise<Booking> {
    return apiRequest<Booking>(`/bookings/${bookingId}/status`, "PUT", { status });
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
    return apiRequest<Recommendation[]>("/availability", "POST", query);
  },

  // ==================== ADMIN SYSTEM LOGS SERVICE ====================

  /**
   * Fetch all user accounts (Admin Portal)
   */
  async getAdminUsers(): Promise<User[]> {
    return apiRequest<User[]>("/admin/users", "GET");
  },

  /**
   * Approve or decline a pending user registration
   */
  async approveUser(userId: string, approved: boolean, role?: "User" | "Admin"): Promise<{ message: string; user: User }> {
    return apiRequest<{ message: string; user: User }>(`/admin/users/${userId}/approve`, "PUT", { approved, role });
  },

  /**
   * Retrieve all notification logs (email loops) sent by the background checker
   */
  async getNotificationLogs(): Promise<NotificationLog[]> {
    return apiRequest<NotificationLog[]>("/admin/notification-logs", "GET");
  },

  /**
   * Manually trigger the pending bookings notification alert loop
   */
  async triggerAlertLoop(): Promise<{ message: string }> {
    return apiRequest<{ message: string }>("/admin/trigger-check", "POST");
  },

  /**
   * Delete a user account (Admin Portal)
   */
  async deleteUser(userId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}`, "DELETE");
  },

  /**
   * Retrieve all admin activity logs (Admin Portal)
   */
  async getAdminActivities(): Promise<AdminActivityLog[]> {
    return apiRequest<AdminActivityLog[]>("/admin/activities", "GET");
  }
};
