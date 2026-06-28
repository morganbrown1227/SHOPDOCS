import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import EquipmentDetail from "@/pages/EquipmentDetail";
import QRScan from "@/pages/QRScan";
import QRResolve from "@/pages/QRResolve";
import AdminEquipmentList from "@/pages/AdminEquipmentList";
import EquipmentForm from "@/pages/EquipmentForm";
import AdminUsers from "@/pages/AdminUsers";
import AdminAuditLogs from "@/pages/AdminAuditLogs";
import QRPrintSheet from "@/pages/QRPrintSheet";
import AdminDeviceTypes from "@/pages/AdminDeviceTypes";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/qr/:code" element={<ProtectedRoute><QRResolve /></ProtectedRoute>} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="/search" element={<Dashboard />} />
              <Route path="/scan" element={<QRScan />} />
              <Route path="/equipment/:id" element={<EquipmentDetail />} />
              <Route path="/admin/equipment" element={<ProtectedRoute roles={["admin", "editor"]}><AdminEquipmentList /></ProtectedRoute>} />
              <Route path="/admin/equipment/new" element={<ProtectedRoute roles={["admin", "editor"]}><EquipmentForm /></ProtectedRoute>} />
              <Route path="/admin/equipment/:id/edit" element={<ProtectedRoute roles={["admin", "editor"]}><EquipmentForm /></ProtectedRoute>} />
              <Route path="/admin/qr-sheet" element={<ProtectedRoute roles={["admin", "editor"]}><QRPrintSheet /></ProtectedRoute>} />
              <Route path="/admin/device-types" element={<ProtectedRoute roles={["admin"]}><AdminDeviceTypes /></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute roles={["admin"]}><AdminUsers /></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute roles={["admin"]}><AdminAuditLogs /></ProtectedRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
