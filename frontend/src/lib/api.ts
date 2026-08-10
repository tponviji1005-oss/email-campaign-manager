/**
 * Typed client for the Email Campaign backend.
 * Set VITE_API_BASE_URL to point at the backend (e.g. https://api.example.com).
 * When the URL is unset, requests fail fast with a clean "backend not connected"
 * error so pages can render an appropriate message.
 */
const RAW_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();

export const API_BASE_URL: string = RAW_BASE_URL?.replace(/\/$/, "") ?? "";
export const API_CONFIGURED = Boolean(API_BASE_URL);

export type CampaignStatus = "DRAFT" | "SENDING" | "SENT" | "FAILED";

export interface DashboardStats {
  totalCampaigns: number;
  emailsSent: number;
  validRecipients?: number;
  successRate?: number;
  pendingCampaigns: number;
  failedCampaigns: number;
}

export interface CampaignSummary {
  id: string;
  name?: string;
  senderName: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  createdAt: string;
  recipientCount: number;
  attachmentCount: number;
}

export interface ParsedRecipients {
  validRecipients: string[];
  invalidRecipients: string[];
  totalValid: number;
  totalInvalid: number;
}

export interface PaginatedCampaigns {
  items: CampaignSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_CONFIGURED) {
    throw new ApiError(
      "Backend not connected. Set VITE_API_BASE_URL to your Email Campaign API URL.",
      0,
    );
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET /auth/google — full page redirect; the backend owns the OAuth flow. */
export function googleSignInUrl(): string {
  return `${API_BASE_URL}/auth/google`;
}

export const api = {
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  getDashboardStats: () => request<DashboardStats>("/dashboard/stats"),

  parseRecipients: (raw: string) =>
    request<ParsedRecipients>("/campaigns/parse-recipients", {
      method: "POST",
      body: JSON.stringify({ recipients: raw }),
    }),

  sendCampaign: (payload: {
    senderName: string;
    subject: string;
    body: string;
    recipients: string[];
    attachments: File[];
  }) => {
    const form = new FormData();
    form.append("senderName", payload.senderName);
    form.append("subject", payload.subject);
    form.append("body", payload.body);
    form.append("recipients", JSON.stringify(payload.recipients));
    payload.attachments.forEach((file) => form.append("attachments", file));
    return request<{ id: string }>("/campaigns", { method: "POST", body: form });
  },

  listCampaigns: (params: { page: number; pageSize: number; search?: string | undefined }) => {
    const query = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.search) query.set("search", params.search);
    return request<PaginatedCampaigns>(`/campaigns?${query.toString()}`);
  },
};
