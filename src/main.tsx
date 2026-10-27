import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Catalog from "./pages/Catalog";
import Exercises from "./pages/Exercises";
import { AuthProvider } from "./components/AuthProvider";
import ProtectedLayout from "./components/ProtectedLayout";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/drivers/:id" element={<Driver />} />
            <Route path="/catalogo" element={<Catalog />} />
            <Route path="/ejercicios" element={<Exercises />} />
            <Route path="*" element={<p className="p-6">Página no encontrada.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
