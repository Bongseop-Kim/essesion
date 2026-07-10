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

function loadPostcode() {
  if (window.daum?.Postcode) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(
      SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("postcode load failed")),
      {
        once: true,
      },
    );
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src =
        "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      document.head.append(script);
    }
  });
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
