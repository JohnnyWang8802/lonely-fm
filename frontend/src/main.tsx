import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/index.css";
import { unlockAudioPlayback } from "./utils/audio";

const unlockAudioFromUserAction = () => {
  void unlockAudioPlayback();
};

window.addEventListener("pointerdown", unlockAudioFromUserAction, { capture: true });
window.addEventListener("keydown", unlockAudioFromUserAction, { capture: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
