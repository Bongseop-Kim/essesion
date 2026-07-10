import { useState } from "react";

type DaumAddress = { zonecode: string; address: string };
type DaumPostcode = new (options: {
  oncomplete: (data: DaumAddress) => void;
}) => { open: () => void };

declare global {
  interface Window {
    daum?: { Postcode: DaumPostcode };
  }
}

const SCRIPT_ID = "daum-postcode-script";
let postcodeLoadPromise: Promise<void> | null = null;

function loadPostcode() {
  if (window.daum?.Postcode) return Promise.resolve();
  if (postcodeLoadPromise) return postcodeLoadPromise;

  document.getElementById(SCRIPT_ID)?.remove();
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src =
    "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

  postcodeLoadPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      script.remove();
      postcodeLoadPromise = null;
      reject(new Error("postcode load failed"));
    };
    script.addEventListener(
      "load",
      () => {
        if (window.daum?.Postcode) resolve();
        else fail();
      },
      { once: true },
    );
    script.addEventListener("error", fail, { once: true });
    document.head.append(script);
  });
  return postcodeLoadPromise;
}

export function useDaumPostcode() {
  const [loading, setLoading] = useState(false);

  return {
    loading,
    async search(onComplete: (address: DaumAddress) => void) {
      setLoading(true);
      try {
        await loadPostcode();
        if (!window.daum?.Postcode) throw new Error("postcode unavailable");
        new window.daum.Postcode({ oncomplete: onComplete }).open();
      } finally {
        setLoading(false);
      }
    },
  };
}
