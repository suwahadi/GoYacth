export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  phone: string;
  nationality: string;
  locale: string;
  role: "ADMIN" | "CUSTOMER";
  status: string;
  last_login_at: string | null;
  created_at: string;
}

export interface CustomerRefund {
  id: string;
  amount: number;
  channel: string;
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "COMPLETED" | "REJECTED";
  needs_bank_details: boolean;
  bank_name: string;
  bank_account_name: string;
  completed_at: string | null;
}

export interface OwnReview {
  id: string;
  status: string;
  title: string;
  body: string;
  rating_overall: number;
}
