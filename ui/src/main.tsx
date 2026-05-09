import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider } from "./components/ToastProvider";
import "./i18n/index";
import "./styles/globals.scss";
import "./styles/tailwind.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});
const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

if ("serviceWorker" in navigator) {
  const basePath = window.__BASE_PATH__ ?? "";
  const swPath = `${basePath.replace(/\/$/, "")}/sw.js`;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(swPath);
  });
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename={window.__BASE_PATH__ ?? "/"}>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
