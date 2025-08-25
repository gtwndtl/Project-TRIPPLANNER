import { useState, useEffect } from "react";

export function useUserId() {
  const [userId, setUserId] = useState<number>(() => {
    const str = localStorage.getItem("id");
    return str ? parseInt(str, 10) : 0;
  });

  useEffect(() => {
    const syncUserId = () => {
      const str = localStorage.getItem("id");
      setUserId(str ? parseInt(str, 10) : 0);
    };

    // sync ตอนเริ่ม
    syncUserId();

    // ฟังการเปลี่ยนแปลงจาก tab อื่น
    const onStorage = (e: StorageEvent) => {
      if (e.key === "id" || e.key === "isLogin") syncUserId();
    };
    window.addEventListener("storage", onStorage);

    // ฟัง custom event จาก navbar
    const onUserChanged = () => syncUserId();
    window.addEventListener("UserChanged", onUserChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("UserChanged", onUserChanged);
    };
  }, []);

  return userId;
}
