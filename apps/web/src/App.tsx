import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./components/layout/ThemeProvider";
import { useAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import JoinHouseholdPage from "./pages/JoinHouseholdPage";
import InventoryPage from "./pages/InventoryPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join" element={<JoinHouseholdPage />} />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/inventory" />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
