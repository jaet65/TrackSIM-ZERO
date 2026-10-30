import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Catalog from "./pages/Catalog";
import Exercises from "./pages/Exercises";
import Groups from "./pages/Groups";
import { AuthProvider } from "./components/AuthProvider";
import ProtectedLayout from "./components/ProtectedLayout";

const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";

// Si estamos en web/localhost y la URL trae un hash legado (#/ruta), convertirlo a ruta limpia sin #
if (!isFileProtocol && typeof window !== "undefined" && window.location.hash.startsWith("#/")) {
  const cleanUrl = window.location.hash.slice(1);
  window.history.replaceState(null, "", cleanUrl);
}

const Router = isFileProtocol ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <Router>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/grupos" element={<Groups />} />
            <Route path="/drivers/:id" element={<Driver />} />
            <Route path="/catalogo" element={<Catalog />} />
            <Route path="/ejercicios" element={<Exercises />} />
            <Route path="*" element={<p className="p-6">Página no encontrada.</p>} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  </StrictMode>,
);
