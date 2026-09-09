import { AppHeader } from "../../src/features/app-shell/AppHeader";
import styles from "../../src/features/app-shell/app-shell.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppHeader />
      {children}
    </div>
  );
}
