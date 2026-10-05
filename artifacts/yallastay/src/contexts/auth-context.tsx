import { apiFetch } from "@/lib/api-fetch";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  phone?: string;
  lastLogin?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
  isRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("ys_auth");
    if (stored) {
      try {
        const { user: u, token: t } = JSON.parse(stored);
        const payload = JSON.parse(atob(t.split(".")[0]));
        if (payload.exp > Date.now()) {
          setUser(u);
          setToken(t);
        } else {
          localStorage.removeItem("ys_auth");
        }
      } catch {
        localStorage.removeItem("ys_auth");
      }
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const res = await apiFetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem("ys_auth", JSON.stringify({ user: data.user, token: data.token }));
  }

  function logout() {
    setUser(null);
    setToken(null);
    localStorage.removeItem("ys_auth");
  }

  function isRole(...roles: string[]) {
    if (!user) return false;
    if (user.role === "super_admin") return true;
    return roles.includes(user.role);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, isRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  reservations: "Reservations",
  cleaner: "Cleaner",
  maintenance: "Maintenance",
  accountant: "Accountant",
  owner: "Owner",
};

export const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  manager: "bg-teal-100 text-teal-700",
  reservations: "bg-green-100 text-green-700",
  cleaner: "bg-sky-100 text-sky-700",
  maintenance: "bg-orange-100 text-orange-700",
  accountant: "bg-amber-100 text-amber-700",
  owner: "bg-pink-100 text-pink-700",
};
