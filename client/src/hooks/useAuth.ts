// Replit Auth Integration
import { useQuery } from "@tanstack/react-query";

export function useAuth() {
  const { data: user, isLoading } = useQuery<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    profileImageUrl: string | null;
  }>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
  };
}
