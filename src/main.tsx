import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./app/App";
import { initializeTheme } from "./features/theme-settings/theme";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
