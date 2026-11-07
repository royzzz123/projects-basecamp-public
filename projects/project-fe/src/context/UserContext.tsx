import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, type User } from "@/lib/api";

interface UserContextValue {
  user: User | null;
  loading: boolean;
  reload: () => void;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  reload: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [tick]);

  return (
    <UserContext.Provider value={{ user, loading, reload: () => setTick((t) => t + 1) }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
