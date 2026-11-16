import { createContext } from "react";

// Whether readers load remote and embedded mail images. The toolbar toggle
// beside Privacy owns the saved preference; images load unless it is off.
export const RemoteImagesContext = createContext(true);

const storageKey = "remote-images";

// Reads the saved preference. Only an explicit "off" hides images.
export function savedRemoteImages(): boolean {
  try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; }
}

// Saves the preference; storage failures keep the in-memory choice.
export function saveRemoteImages(on: boolean) {
  try { localStorage.setItem(storageKey, on ? "on" : "off"); } catch { /* keep the session choice */ }
}
