import { createRoot } from "react-dom/client";
import App from "./App";
import { configureMobileApiFetch } from "./lib/mobile-api";
import { prefetchRouteData } from "./lib/route-prefetch";
import "./index.css";

configureMobileApiFetch();
prefetchRouteData(window.location.pathname);

createRoot(document.getElementById("root")!).render(<App />);
