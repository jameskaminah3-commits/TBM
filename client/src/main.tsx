import { createRoot } from "react-dom/client";
import App from "./App";
import { configureMobileApiFetch } from "./lib/mobile-api";
import "./index.css";

configureMobileApiFetch();

createRoot(document.getElementById("root")!).render(<App />);
