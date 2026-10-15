"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, Check, ChevronDown, Filter, RefreshCw } from "lucide-react";

export interface ShopifyProductFilterProps {
  products?: string[];
  selectedProducts: string[];
  onChange: (selected: string[]) => void;
  productMode: "exclude" | "include";
  onProductModeChange: (mode: "exclude" | "include") => void;
  disabled?: boolean;
}

export function ShopifyProductFilter({
  products = [],
  selectedProducts = [],
  onChange,
  productMode,
  onProductModeChange: _onProductModeChange,
  disabled = false,
}: ShopifyProductFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Instant local state that hydrates from localStorage immediately (0ms wait)
  const [dbProducts, setDbProducts] = useState<string[]>(() => {
    if (products && products.length > 0) return products;
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("satmi_live_shopify_products");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return [];
  });
  const [syncingProducts, setSyncingProducts] = useState(false);

  // Synchronize when props.products are loaded
  useEffect(() => {
    if (products && products.length > 0) {
      setDbProducts(products);
      try {
        localStorage.setItem("satmi_live_shopify_products", JSON.stringify(products));
      } catch {
        // ignore
      }
    }
  }, [products]);

  // Proactively fetch products from the database via /api/products on mount
  useEffect(() => {
    let isMounted = true;
    fetch("/api/products")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.products && Array.isArray(data.products) && data.products.length > 0) {
          setDbProducts(data.products);
          try {
            localStorage.setItem("satmi_live_shopify_products", JSON.stringify(data.products));
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Quick button to sync latest products into database
  async function handleRefreshProducts(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncingProducts(true);
    try {
      const res = await fetch("/api/products?sync=true");
      if (res.ok) {
        const data = await res.json();
        if (data?.products && Array.isArray(data.products)) {
          setDbProducts(data.products);
          localStorage.setItem("satmi_live_shopify_products", JSON.stringify(data.products));
        }
      }
    } catch {
      // ignore
    } finally {
      setSyncingProducts(false);
    }
  }

  // Active catalog: prefer dbProducts, fallback to props.products
  const activeCatalog = dbProducts.length > 0 ? dbProducts : products;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  // Keyboard accessibility (ESC to close)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Filter products based on search query
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeCatalog;
    return activeCatalog.filter((item) => item.toLowerCase().includes(q));
  }, [activeCatalog, searchQuery]);

  const hasSelection = selectedProducts.length > 0;

  function toggleProduct(productName: string) {
    if (selectedProducts.includes(productName)) {
      onChange(selectedProducts.filter((p) => p !== productName));
    } else {
      onChange([...selectedProducts, productName]);
    }
  }

  function selectAllVisible() {
    const combined = Array.from(new Set([...selectedProducts, ...filteredProducts]));
    onChange(combined);
  }

  function deselectAllVisible() {
    const toRemove = new Set(filteredProducts);
    onChange(selectedProducts.filter((p) => !toRemove.has(p)));
  }

  function clearAll() {
    onChange([]);
  }

  function removeProduct(productName: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selectedProducts.filter((p) => p !== productName));
  }

  const isExclude = productMode === "exclude";

  return (
    <div className="flex flex-col gap-1.5 md:col-span-2 relative" ref={containerRef}>
      {/* Label and top actions */}
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <Filter size={12} className={hasSelection ? (isExclude ? "text-amber-500" : "text-primary") : ""} />
          <span className="font-semibold text-foreground">Product filter</span>
          <button
            type="button"
            onClick={handleRefreshProducts}
            disabled={syncingProducts}
            title="Refresh products from database"
            className={`p-0.5 text-muted-foreground hover:text-foreground transition rounded cursor-pointer ${
              syncingProducts ? "animate-spin text-primary" : ""
            }`}
          >
            <RefreshCw size={11} />
          </button>
        </label>
        {hasSelection && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
          >
            Clear all ({selectedProducts.length})
          </button>
        )}
      </div>

      {/* Main Trigger Input Button */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`h-9 w-full rounded-lg border px-3 text-left text-xs outline-none transition flex items-center justify-between gap-2 cursor-pointer ${
            hasSelection
              ? isExclude
                ? "border-amber-500/70 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-medium ring-1 ring-amber-500/30"
                : "border-primary bg-primary/10 text-primary font-medium ring-1 ring-primary/30"
              : "border-input bg-card text-foreground hover:border-muted-foreground/40"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div className="flex items-center gap-2 truncate flex-1">
            {hasSelection ? (
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    isExclude
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      : "bg-primary/20 text-primary"
                  }`}
                >
                  {selectedProducts.length} selected
                </span>
                <span className="truncate text-xs">
                  {selectedProducts.length === 1
                    ? selectedProducts[0]
                    : `${selectedProducts[0]} +${selectedProducts.length - 1} more`}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Select products...</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasSelection && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition text-muted-foreground hover:text-foreground cursor-pointer"
                title="Clear all selected products"
              >
                <X size={13} />
              </span>
            )}
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 text-muted-foreground ${isOpen ? "rotate-180" : ""}`}
            />
          </div>
        </button>

        {/* Dropdown Popover */}
        {isOpen && (
          <div
            className="absolute left-0 top-full mt-1.5 w-full min-w-[320px] sm:min-w-[420px] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-2xl z-50 p-2.5 space-y-2.5 animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ maxHeight: "420px" }}
          >
            {/* Search Bar inside this filter only */}
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products..."
                className="h-8.5 w-full rounded-lg border border-input bg-background/80 pl-9 pr-8 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 p-0.5 text-muted-foreground hover:text-foreground rounded cursor-pointer"
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Quick Actions & Status Header */}
            <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground border-b border-border/50 pb-1.5">
              <span>
                Showing {filteredProducts.length} of {activeCatalog.length} products
              </span>
              <div className="flex items-center gap-2">
                {filteredProducts.length > 0 && (
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    Select visible
                  </button>
                )}
                {hasSelection && (
                  <button
                    type="button"
                    onClick={deselectAllVisible}
                    className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    Deselect visible
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Products List */}
            <div className="overflow-y-auto max-h-[220px] space-y-0.5 pr-1 divide-y divide-border/20">
              {filteredProducts.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground space-y-1">
                  <p>No products match &ldquo;{searchQuery}&rdquo;</p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-primary hover:underline text-[11px] font-medium"
                  >
                    Clear search filter
                  </button>
                </div>
              ) : (
                filteredProducts.map((item) => {
                  const isChecked = selectedProducts.includes(item);
                  return (
                    <div
                      key={item}
                      onClick={() => toggleProduct(item)}
                      className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition select-none text-xs ${
                        isChecked
                          ? isExclude
                            ? "bg-amber-500/15 text-foreground font-medium"
                            : "bg-primary/10 text-foreground font-medium"
                          : "hover:bg-accent/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="shrink-0">
                        {isChecked ? (
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center text-white ${
                              isExclude ? "bg-amber-600" : "bg-primary"
                            }`}
                          >
                            <Check size={11} strokeWidth={3} />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border border-muted-foreground/40 hover:border-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate leading-tight text-foreground font-medium" title={item}>
                          {item}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Popover Footer: Mode Info and Done Button */}
            <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
              <span className="text-[11px] text-muted-foreground">
                <strong className="text-foreground">{selectedProducts.length}</strong> product
                {selectedProducts.length === 1 ? "" : "s"} selected
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 rounded-md bg-primary text-primary-foreground font-medium text-xs hover:bg-primary/90 transition cursor-pointer shadow-xs"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Selected Products Chips (Horizontal wrap) */}
      {hasSelection && (
        <div className="flex flex-wrap gap-1 mt-1 max-h-20 overflow-y-auto pr-1">
          {selectedProducts.map((item) => (
            <span
              key={item}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                isExclude
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  : "border-primary/40 bg-primary/10 text-primary"
              }`}
              title={item}
            >
              <span className="max-w-[180px] truncate">{item}</span>
              <button
                type="button"
                onClick={(e) => removeProduct(item, e)}
                className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                title={`Remove ${item}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
