import { useLocation } from "wouter";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="font-serif text-6xl md:text-7xl font-semibold mb-4">404</h1>
        <h2 className="text-2xl md:text-3xl font-semibold mb-4">Page Not Found</h2>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button size="lg" onClick={() => setLocation("/")} data-testid="button-home">
          <Home className="mr-2 h-5 w-5" />
          Back to Home
        </Button>
      </div>
    </div>
  );
}
