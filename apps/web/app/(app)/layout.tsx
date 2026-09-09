import { AppHeader } from "../../src/features/app-shell/AppHeader";
import { ViewerProvider } from "../../src/shared/lib/viewer";
import styles from "../../src/features/app-shell/app.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ViewerProvider>
      <div className={styles.shell}>
        <AppHeader />
        {children}
      </div>
    </ViewerProvider>
  );
}
