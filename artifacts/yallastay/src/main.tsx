import { setAuthTokenGetter } from "@workspace/api-client-react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

setAuthTokenGetter(() => {
  try { return JSON.parse(localStorage.getItem("ys_auth") || "null")?.token || null; }
  catch { return null; }
});

import { loadInstance, startWlRewriter } from "@/lib/instance";
loadInstance().finally(() => { createRoot(document.getElementById("root")!).render(<App />); startWlRewriter(); });
