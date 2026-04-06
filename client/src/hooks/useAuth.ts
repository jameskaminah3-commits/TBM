import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

function parseProviderTypes(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is "stays" | "cars" | "cooks" | "errands" | "experiences" =>
      ["stays", "cars", "cooks", "errands", "experiences"].includes(entry));
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<{
    id: string;
    email: string;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string;
    providerType: string | null;
    profileImageUrl: string | null;
    warningCount: number;
    moderationNote: string | null;
  }>({
    queryKey: ["/api/auth/user"],
    retry: false,
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const providerTypes = parseProviderTypes(user?.providerType);

  return {
    user: user ? { ...user, providerTypes } : undefined,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    isProvider: user?.role === "provider",
  };
}
