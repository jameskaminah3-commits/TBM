// zaina-platform/web/console/main.tsx — the console's entry point.

import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

createRoot(document.getElementById("root")!).render(<App />);
