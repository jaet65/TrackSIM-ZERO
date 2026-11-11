import React, { useState, useRef, useEffect, useMemo } from "react";
import { SEVERITIES, SEVERITY_ORDER, type Severity } from "../lib/catalog";

export interface CatalogErrorOption {
  name: string;
  severity: Severity;
  weight: number;
}

export interface ErrorComboboxProps {
  optionsBySeverity: Record<Severity, CatalogErrorOption[]>;
  value: string; // Nombre seleccionado o texto actual
  onChange: (value: string, isCustom?: boolean) => void;
  placeholder?: string;
  className?: string;
}

export default function ErrorCombobox({
  optionsBySeverity,
  value,
  onChange,
  placeholder = "Buscar o escribir infracción...",
  className = "",
}: ErrorComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lista plana de opciones filtradas
  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: { item: CatalogErrorOption; isCustomAction?: boolean }[] = [];

    for (const sev of SEVERITY_ORDER) {
      const items = optionsBySeverity[sev] || [];
      for (const it of items) {
        if (!q || it.name.toLowerCase().includes(q)) {
          result.push({ item: it });
        }
      }
    }

    // Si hay texto escrito y no coincide exactamente con ninguna opción existente, dar opción de agregar personalizada
    if (q && !result.some((r) => r.item.name.toLowerCase() === q)) {
      result.push({
        item: {
          name: query.trim(),
          severity: "MODERADO",
          weight: 1,
        },
        isCustomAction: true,
      });
    }

    return result;
  }, [optionsBySeverity, query]);

  // Si cambia el value externamente y está vacío, limpiar query
  useEffect(() => {
    if (!value) {
      setQuery("");
    } else {
      setQuery(value);
    }
  }, [value]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Mantener el índice resaltado dentro de los límites
  useEffect(() => {
    if (highlightedIndex >= filteredList.length) {
      setHighlightedIndex(Math.max(0, filteredList.length - 1));
    }
  }, [filteredList.length, highlightedIndex]);

  const handleSelect = (name: string, isCustom = false) => {
    onChange(name, isCustom);
    setQuery(name);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setQuery("");
    inputRef.current?.focus();
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        return;
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < filteredList.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredList.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredList[highlightedIndex]) {
        const selected = filteredList[highlightedIndex];
        handleSelect(selected.item.name, selected.isCustomAction);
      } else if (query.trim()) {
        handleSelect(query.trim(), true);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition"
        />

        {query ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
            title="Limpiar campo"
          >
            ✕
          </button>
        ) : (
          <span className="pointer-events-none absolute right-2.5 text-xs text-slate-400">
            🔍
          </span>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-xl py-1 text-xs divide-y divide-slate-100">
          {filteredList.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-slate-500">
              No se encontraron coincidencias.
            </div>
          ) : (
            filteredList.map((entry, idx) => {
              const isSelected = highlightedIndex === idx;
              const isCustom = entry.isCustomAction;
              const sev = entry.item.severity;
              const sevCfg = SEVERITIES[sev];

              return (
                <div
                  key={`${entry.item.name}-${idx}`}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => handleSelect(entry.item.name, isCustom)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition ${
                    isSelected ? "bg-indigo-50 text-indigo-950 font-semibold" : "hover:bg-slate-50 text-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    {isCustom ? (
                      <span className="text-sm">✏️</span>
                    ) : (
                      <span className={`h-2 w-2 rounded-full shrink-0 ${sevCfg.dot}`} />
                    )}
                    <span className="truncate">
                      {isCustom ? (
                        <span>
                          Usar como falta personalizada: <strong className="text-indigo-600">"{entry.item.name}"</strong>
                        </span>
                      ) : (
                        entry.item.name
                      )}
                    </span>
                  </div>

                  {!isCustom && (
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${sevCfg.badge}`}
                    >
                      {sevCfg.label} (-{entry.item.weight} pts)
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

