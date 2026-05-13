import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { FaApple } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import type { IconType } from "react-icons";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/brand-mark";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

type Mode = "sign-in" | "sign-up" | "verify-email" | "forgot-password" | "reset-password";

type ModeCopy = {
  title: string;
  description: string;
  submitLabel: string;
};

const modeCopy: Record<Mode, ModeCopy> = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to continue with your bookings, inbox, or dashboard.",
    submitLabel: "Sign In",
  },
  "sign-up": {
    title: "Create account",
    description: "Use one account for bookings, updates, and future requests.",
    submitLabel: "Create Account",
  },
  "verify-email": {
    title: "Verify your email",
    description: "Enter the 6-digit code we sent to finish setting up your account.",
    submitLabel: "Verify and Continue",
  },
  "forgot-password": {
    title: "Reset password",
    description: "Enter your email and we will send you a 6-digit code.",
    submitLabel: "Send Code",
  },
  "reset-password": {
    title: "Enter your code",
    description: "Use the code from your email and choose a new password.",
    submitLabel: "Reset Password",
  },
};

async function readApiJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error("The app received an HTML page instead of API JSON. Restart the backend and frontend dev servers.");
  }

  return text ? JSON.parse(text) : null;
}

type ApiErrorPayload = {
  message?: string;
  requiresEmailVerification?: boolean;
  email?: string | null;
  devOtp?: string;
};

type AuthSuccessPayload = {
  message?: string;
  email?: string | null;
  devOtp?: string;
  otpBypassed?: boolean;
  user?: {
    role?: string | null;
  } | null;
};

type SocialProvider = "google" | "apple";

const socialProviderCopy: Record<SocialProvider, { label: string; Icon: IconType }> = {
  google: {
    label: "Google",
    Icon: FcGoogle,
  },
  apple: {
    label: "Apple",
    Icon: FaApple,
  },
};

function getEnabledSocialProviders(): SocialProvider[] {
  const configuredProviderValue = String(import.meta.env.VITE_SOCIAL_LOGIN_PROVIDERS ?? "google");
  const configuredProviders = configuredProviderValue
    .split(",")
    .map((provider: string) => provider.trim().toLowerCase())
    .filter((provider: string): provider is SocialProvider => provider === "google" || provider === "apple");

  return Array.from(new Set(configuredProviders));
}

function parseApiError(error: unknown): ApiErrorPayload | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const jsonStart = error.message.indexOf("{");
  if (jsonStart === -1) {
    return null;
  }

  try {
    return JSON.parse(error.message.slice(jsonStart)) as ApiErrorPayload;
  } catch {
    return null;
  }
}

function getApiErrorMessage(error: unknown, fallback = "Please try again.") {
  const payload = parseApiError(error);
  if (payload?.message) {
    return payload.message;
  }

  if (error instanceof Error) {
    const prefixPattern = /^\d{3}:\s*/;
    return error.message.replace(prefixPattern, "") || fallback;
  }

  return fallback;
}

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function getNextPath() {
  if (typeof window === "undefined") {
    return "/";
  }

  const search = new URLSearchParams(window.location.search);
  const next = search.get("next");
  return next && next.startsWith("/") ? next : "/";
}

function formatNextPathLabel(path: string) {
  if (path === "/" || !path) {
    return "home";
  }

  return path
    .replace(/^\//, "")
    .split("?")[0]
    .split("/")
    .map((part) => part.replace(/-/g, " "))
    .join(" / ");
}

function resolvePostAuthPath(nextPath: string, isAdmin: boolean) {
  if (nextPath.startsWith("/admin") && !isAdmin) {
    return "/";
  }

  return nextPath;
}

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [resetPasswordOtpBypassed, setResetPasswordOtpBypassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [socialSubmitting, setSocialSubmitting] = useState<SocialProvider | null>(null);
  const [isCompletingSocialLogin, setIsCompletingSocialLogin] = useState(false);

  const nextPath = getNextPath();
  const socialProviders = useMemo(() => getEnabledSocialProviders(), []);
  const nextPathLabel = useMemo(() => formatNextPathLabel(nextPath), [nextPath]);
  const resolvedNextPath = useMemo(() => resolvePostAuthPath(nextPath, isAdmin), [isAdmin, nextPath]);
  const currentMode = useMemo(() => {
    if (mode === "reset-password" && resetPasswordOtpBypassed) {
      return {
        ...modeCopy[mode],
        title: "Set a new password",
        description: "OTP verification is skipped for local testing. Enter your email and choose a new password.",
      };
    }

    return modeCopy[mode];
  }, [mode, resetPasswordOtpBypassed]);

  function openMode(nextMode: Mode) {
    if (nextMode !== "reset-password") {
      setResetPasswordOtpBypassed(false);
    }

    setMode(nextMode);
  }

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation(resolvedNextPath);
    }
  }, [isAuthenticated, isLoading, resolvedNextPath, setLocation]);

  useEffect(() => {
    const supabaseClient = supabase;
    if (!supabaseClient || isAuthenticated || isCompletingSocialLogin) {
      return;
    }

    let cancelled = false;

    async function completeSocialLogin(authClient: NonNullable<typeof supabase>) {
      const { data, error } = await authClient.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        return;
      }

      setIsCompletingSocialLogin(true);
      try {
        const res = await apiRequest("POST", "/api/auth/social-session", { accessToken });
        const user = await readApiJson(res);
        if (cancelled) {
          return;
        }

        queryClient.setQueryData(["/api/auth/user"], user);
        await authClient.auth.signOut();
        toast({
          title: "Signed in",
          description: "Welcome back.",
        });
        await refreshAuthAndRedirect(user?.role);
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Social login failed",
            description: getApiErrorMessage(error),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setIsCompletingSocialLogin(false);
        }
      }
    }

    void completeSocialLogin(supabaseClient);

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isCompletingSocialLogin, toast]);

  async function refreshAuthAndRedirect(userRole?: string | null) {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    setLocation(resolvePostAuthPath(nextPath, userRole === "admin"));
  }

  async function handleSocialSignIn(provider: SocialProvider) {
    if (!supabase) {
      toast({
        title: "Social login unavailable",
        description: "Supabase is not configured for this environment yet.",
        variant: "destructive",
      });
      return;
    }

    setSocialSubmitting(provider);
    try {
      const redirectTo = `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams: provider === "google"
            ? {
                access_type: "offline",
                prompt: "select_account",
              }
            : undefined,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      toast({
        title: "Social login failed",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
      setSocialSubmitting(null);
    }
  }

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const res = await apiRequest("POST", "/api/auth/signup", {
        name,
        email,
        phone,
        password,
      });

      const data = await readApiJson(res) as AuthSuccessPayload;
      if (data?.otpBypassed && data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
        setPassword("");
        toast({
          title: "Account ready",
          description: data.message ?? "OTP verification is skipped for local testing.",
        });
        await refreshAuthAndRedirect(data.user.role);
        return;
      }

      setEmail(data?.email ?? email.trim());
      setPassword("");
      setOtp("");
      openMode("verify-email");
      toast({
        title: "Verify your email",
        description:
          data?.devOtp && import.meta.env.DEV
            ? `Development code: ${data.devOtp}`
            : "We sent a 6-digit verification code to your email.",
      });
    } catch (error) {
      const payload = parseApiError(error);
      if (payload?.requiresEmailVerification) {
        setEmail(payload.email ?? email.trim().toLowerCase());
        setPassword("");
        setOtp("");
        openMode("verify-email");
        toast({
          title: "Verify your email",
          description: payload.message ?? "Enter the code we sent to finish setting up your account.",
        });
        return;
      }

      toast({
        title: "Sign up failed",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const res = await apiRequest("POST", "/api/auth/signin", {
        identifier,
        password,
      });

      const user = await readApiJson(res);
      queryClient.setQueryData(["/api/auth/user"], user);
      toast({
        title: "Signed in",
        description: "Welcome back.",
      });
      setResetPasswordOtpBypassed(false);
      await refreshAuthAndRedirect(user?.role);
    } catch (error) {
      const payload = parseApiError(error);
      if (payload?.requiresEmailVerification) {
        const verificationEmail = payload.email ?? (looksLikeEmail(identifier) ? identifier.trim().toLowerCase() : email.trim().toLowerCase());
        setEmail(verificationEmail);
        setPassword("");
        setOtp("");
        openMode("verify-email");
        toast({
          title: "Verify your email",
          description: payload.message ?? "Enter the code we sent to your email to continue.",
        });
        return;
      }

      toast({
        title: "Sign in failed",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyEmail(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const res = await apiRequest("POST", "/api/auth/verify-email", {
        email,
        otp,
      });

      const user = await readApiJson(res);
      queryClient.setQueryData(["/api/auth/user"], user);
      toast({
        title: "Email verified",
        description: "Your account is ready.",
      });
      setResetPasswordOtpBypassed(false);
      await refreshAuthAndRedirect(user?.role);
    } catch (error) {
      toast({
        title: "Verification failed",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendVerification() {
    setSubmitting(true);

    try {
      const res = await apiRequest("POST", "/api/auth/resend-verification", { email });
      const data = await readApiJson(res) as AuthSuccessPayload;
      toast({
        title: data?.otpBypassed ? "Local testing active" : "Code sent",
        description:
          data?.otpBypassed
            ? (data.message ?? "OTP verification is skipped for local testing.")
            : data?.devOtp && import.meta.env.DEV
            ? `Development code: ${data.devOtp}`
            : "Check your email for the new 6-digit verification code.",
      });
    } catch (error) {
      toast({
        title: "Could not resend code",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      const data = await readApiJson(res) as AuthSuccessPayload;
      setResetPasswordOtpBypassed(Boolean(data?.otpBypassed));
      setOtp("");
      setMode("reset-password");
      toast({
        title: data?.otpBypassed ? "Set a new password" : "OTP sent",
        description:
          data?.otpBypassed
            ? (data.message ?? "OTP verification is skipped for local testing.")
            : data.devOtp && import.meta.env.DEV
            ? `Development OTP: ${data.devOtp}`
            : "Check your email for the 6-digit OTP.",
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const payload = resetPasswordOtpBypassed
        ? { email, newPassword }
        : { email, otp, newPassword };
      const res = await apiRequest("POST", "/api/auth/reset-password", payload);

      const user = await readApiJson(res);
      queryClient.setQueryData(["/api/auth/user"], user);
      toast({
        title: "Password updated",
        description: "You are now signed in.",
      });
      setResetPasswordOtpBypassed(false);
      await refreshAuthAndRedirect(user?.role);
    } catch (error) {
      toast({
        title: "Could not reset password",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100svh] bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.1),transparent_34%),linear-gradient(180deg,rgba(255,252,247,1),rgba(246,248,247,1))]">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col justify-center px-4 py-6 sm:px-6 sm:py-10">
        <Button type="button" variant="ghost" size="sm" asChild className="mb-4 w-fit rounded-full px-2 text-muted-foreground">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </Button>

        <Card className="overflow-hidden rounded-[2rem] border-stone-200/80 bg-white/95 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.42)]">
          <CardHeader className="space-y-5 px-5 pb-0 pt-6 sm:px-6">
            <div className="space-y-3">
              <Link href="/" className="inline-flex items-center gap-3">
                <BrandMark className="h-10 shrink-0" />
                <span className="font-serif text-lg tracking-[0.08em] text-stone-950">
                  Tembea Bila Matata
                </span>
              </Link>

              {nextPath !== "/" ? (
                <div className="inline-flex w-fit rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium capitalize text-muted-foreground">
                  Continue to {nextPathLabel}
                </div>
              ) : null}

              <div className="space-y-2">
                <CardTitle className="text-2xl tracking-tight text-stone-950 sm:text-[2rem]">
                  {currentMode.title}
                </CardTitle>
                <CardDescription className="text-sm leading-6 sm:text-base">
                  {currentMode.description}
                </CardDescription>
              </div>
            </div>

            {mode === "sign-in" || mode === "sign-up" ? (
              <div className="grid grid-cols-2 gap-2 rounded-[1.35rem] border border-stone-200/80 bg-stone-50/90 p-1.5">
                <Button
                  type="button"
                  variant={mode === "sign-in" ? "default" : "ghost"}
                  className="min-h-11 rounded-[1rem] px-3 text-sm"
                  onClick={() => openMode("sign-in")}
                >
                  Sign In
                </Button>
                <Button
                  type="button"
                  variant={mode === "sign-up" ? "default" : "ghost"}
                  className="min-h-11 rounded-[1rem] px-3 text-sm"
                  onClick={() => openMode("sign-up")}
                >
                  Sign Up
                </Button>
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-5 px-5 pb-6 pt-5 sm:px-6">
            {mode === "sign-in" ? (
              <>
                {socialProviders.length > 0 ? (
                  <div className="space-y-3">
                    {socialProviders.map((provider) => {
                      const { Icon, label } = socialProviderCopy[provider];
                      const busy = socialSubmitting === provider || isCompletingSocialLogin;

                      return (
                        <Button
                          key={provider}
                          type="button"
                          variant="outline"
                          className="min-h-12 w-full rounded-2xl border-stone-200 bg-white text-base text-stone-900 hover:bg-stone-50"
                          onClick={() => void handleSocialSignIn(provider)}
                          disabled={submitting || Boolean(socialSubmitting) || isCompletingSocialLogin}
                        >
                          <Icon className="mr-2 h-5 w-5" />
                          {busy ? `Connecting ${label}...` : `Continue with ${label}`}
                        </Button>
                      );
                    })}
                    <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <span className="h-px flex-1 bg-stone-200" />
                      or
                      <span className="h-px flex-1 bg-stone-200" />
                    </div>
                  </div>
                ) : null}

                <form className="space-y-4" onSubmit={handleSignIn}>
                  <div className="space-y-2">
                    <Label htmlFor="identifier">Email or phone</Label>
                    <Input
                      id="identifier"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="jane@example.com or +254..."
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="Password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      enterKeyHint="go"
                      required
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline"
                      onClick={() => openMode("forgot-password")}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Button className="min-h-12 w-full rounded-2xl text-base" type="submit" disabled={submitting}>
                    {submitting ? "Signing in..." : currentMode.submitLabel}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  New here?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => openMode("sign-up")}
                  >
                    Create account
                  </button>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                  Need to verify your email?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => {
                      setEmail(looksLikeEmail(identifier) ? identifier.trim().toLowerCase() : email);
                      setOtp("");
                      openMode("verify-email");
                    }}
                  >
                    Enter code
                  </button>
                </div>
              </>
            ) : null}

            {mode === "sign-up" ? (
              <>
                {socialProviders.length > 0 ? (
                  <div className="space-y-3">
                    {socialProviders.map((provider) => {
                      const { Icon, label } = socialProviderCopy[provider];
                      const busy = socialSubmitting === provider || isCompletingSocialLogin;

                      return (
                        <Button
                          key={provider}
                          type="button"
                          variant="outline"
                          className="min-h-12 w-full rounded-2xl border-stone-200 bg-white text-base text-stone-900 hover:bg-stone-50"
                          onClick={() => void handleSocialSignIn(provider)}
                          disabled={submitting || Boolean(socialSubmitting) || isCompletingSocialLogin}
                        >
                          <Icon className="mr-2 h-5 w-5" />
                          {busy ? `Connecting ${label}...` : `Continue with ${label}`}
                        </Button>
                      );
                    })}
                    <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <span className="h-px flex-1 bg-stone-200" />
                      or
                      <span className="h-px flex-1 bg-stone-200" />
                    </div>
                  </div>
                ) : null}

                <form className="space-y-4" onSubmit={handleSignUp}>
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="Jane Doe"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="jane@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="email"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="+254700000000"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      enterKeyHint="go"
                      required
                      minLength={8}
                    />
                  </div>
                  <Button className="min-h-12 w-full rounded-2xl text-base" type="submit" disabled={submitting}>
                    {submitting ? "Creating account..." : currentMode.submitLabel}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => openMode("sign-in")}
                  >
                    Sign in
                  </button>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                  Already have a code?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => {
                      setOtp("");
                      openMode("verify-email");
                    }}
                  >
                    Verify email
                  </button>
                </div>
              </>
            ) : null}

            {mode === "verify-email" ? (
              <>
                <form className="space-y-4" onSubmit={handleVerifyEmail}>
                  <div className="space-y-2">
                    <Label htmlFor="verify-email">Email</Label>
                    <Input
                      id="verify-email"
                      type="email"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="jane@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="email"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verify-otp">Verification code</Label>
                    <Input
                      id="verify-otp"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base tracking-[0.18em]"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                      enterKeyHint="go"
                      required
                    />
                  </div>
                  <Button className="min-h-12 w-full rounded-2xl text-base" type="submit" disabled={submitting}>
                    {submitting ? "Verifying..." : currentMode.submitLabel}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  Didn&apos;t get the code?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleResendVerification()}
                    disabled={submitting}
                  >
                    Send again
                  </button>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                  Already verified?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => openMode("sign-in")}
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            ) : null}

            {mode === "forgot-password" ? (
              <>
                <form className="space-y-4" onSubmit={handleForgotPassword}>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="jane@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="email"
                      enterKeyHint="send"
                      required
                    />
                  </div>
                  <Button className="min-h-12 w-full rounded-2xl text-base" type="submit" disabled={submitting}>
                    {submitting ? "Sending..." : currentMode.submitLabel}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  Remembered it?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => openMode("sign-in")}
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            ) : null}

            {mode === "reset-password" ? (
              <>
                <form className="space-y-4" onSubmit={handleResetPassword}>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email-confirm">Email</Label>
                    <Input
                      id="reset-email-confirm"
                      type="email"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="jane@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="email"
                      enterKeyHint="next"
                      required
                    />
                  </div>
                  {resetPasswordOtpBypassed ? (
                    <div className="rounded-2xl border border-teal-200/80 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-900">
                      Local testing mode is active on this device, so OTP verification is skipped here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="otp">OTP</Label>
                      <Input
                        id="otp"
                        className="h-12 rounded-2xl border-stone-200 px-4 text-base tracking-[0.18em]"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="6-digit code"
                        value={otp}
                        onChange={(event) => setOtp(event.target.value)}
                        enterKeyHint="next"
                        required
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      className="h-12 rounded-2xl border-stone-200 px-4 text-base"
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      enterKeyHint="go"
                      required
                      minLength={8}
                    />
                  </div>
                  <Button className="min-h-12 w-full rounded-2xl text-base" type="submit" disabled={submitting}>
                    {submitting ? "Updating..." : currentMode.submitLabel}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  Need a new code?{" "}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline-offset-4 hover:underline"
                    onClick={() => {
                      setResetPasswordOtpBypassed(false);
                      openMode("forgot-password");
                    }}
                  >
                    Send again
                  </button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
