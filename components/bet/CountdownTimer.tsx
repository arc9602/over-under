"use client";

import { useEffect, useState } from "react";

function getTimeLeft(deadline: string) {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return null;

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export function CountdownTimer({ deadline }: { deadline: string }) {
  const [label, setLabel] = useState(() => getTimeLeft(deadline));

  useEffect(() => {
    const interval = setInterval(() => {
      setLabel(getTimeLeft(deadline));
    }, 60000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!label) return <span className="text-xs text-muted-foreground">Expired</span>;
  return <span className="text-xs text-resolving">{label}</span>;
}
