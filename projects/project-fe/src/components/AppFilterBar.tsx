import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { Search01Icon, FilterIcon, Cancel01Icon, Building03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface FilterOption {
  id: string;
  label: string;
}

export interface FilterField {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

export interface TypeaheadFilterField {
  id: string;
  label: string;
  placeholder?: string;
  selectedId: string | null;
  selectedLabel: string | null;
  onSelect: (id: string | null, label: string | null) => void;
  fetchOptions: (q: string) => Promise<FilterOption[]>;
}

export interface AppFilterBarProps {
  title: string;
  description?: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  fetchSearchSuggestions?: (q: string) => Promise<FilterOption[]>;
  onSearchSuggestionSelect?: (id: string, label: string) => void;
  filters?: FilterField[];
  typeaheadFilters?: TypeaheadFilterField[];
  headerActions?: ReactNode;
  actions?: ReactNode;
}

function FilterSubMenu({ filter, onClose }: { filter: FilterField; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = query
    ? filter.options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : filter.options;

  return (
    <DropdownMenuSub key={filter.id}>
      <DropdownMenuSubTrigger className="rounded-lg px-2 py-2 text-xs">
        <span className="flex-1 truncate">{filter.label}</span>
        {filter.value !== "all" && (
          <span className="ml-auto mr-2 max-w-[80px] truncate text-[11px] text-muted-foreground">
            {filter.options.find((o) => o.id === filter.value)?.label}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 rounded-xl p-1">
        {/* Header: label + search icon, or search input */}
        <div className="flex items-center justify-between px-2 py-1.5">
          {searching ? (
            <div className="relative flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none"
                strokeWidth={1.5}
              />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search…"
                className="h-6 w-full rounded-md border border-border bg-muted/50 pl-6 pr-2 text-xs outline-none focus:border-ring focus:bg-background"
              />
            </div>
          ) : (
            <>
              <span className="text-xs font-medium text-muted-foreground">{filter.label}</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearching(true);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-60 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={filter.value}
            onValueChange={(v) => {
              filter.onChange(v);
              setQuery("");
              setSearching(false);
              onClose();
            }}
          >
            {!query && (
              <DropdownMenuRadioItem value="all" className="rounded-lg py-2 pl-8 text-xs">
                All
              </DropdownMenuRadioItem>
            )}
            {visible.map((opt) => (
              <DropdownMenuRadioItem
                key={opt.id}
                value={opt.id}
                className="rounded-lg py-2 pl-8 text-xs"
              >
                {opt.label}
              </DropdownMenuRadioItem>
            ))}
            {visible.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
            )}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function TypeaheadFilter({ field }: { field: TypeaheadFilterField }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOptions = useCallback(
    (q: string) => {
      setLoading(true);
      field
        .fetchOptions(q)
        .then((results) => {
          setOptions(results);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    },
    [field.fetchOptions],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || !query) {
      setOptions([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchOptions(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, fetchOptions]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSelect(opt: FilterOption) {
    field.onSelect(opt.id, opt.label);
    setQuery("");
    setOpen(false);
  }

  function handleClear() {
    field.onSelect(null, null);
    setQuery("");
    setOpen(false);
  }

  if (field.selectedId) {
    return (
      <div className={pillClass()}>
        <HugeiconsIcon
          icon={Building03Icon}
          className="h-3 w-3 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="text-muted-foreground">{field.label}</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="max-w-[140px] truncate">{field.selectedLabel}</span>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "inline-flex h-8 cursor-text items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all",
          open
            ? "w-56 border-ring bg-background text-foreground"
            : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
        )}
        onClick={handleOpen}
      >
        <HugeiconsIcon icon={Building03Icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                e.stopPropagation();
              }
              if (e.key === "Enter" && options.length === 1) handleSelect(options[0]);
            }}
            placeholder={field.placeholder ?? `Search ${field.label}…`}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <span>{field.label}</span>
        )}
      </div>

      {open && query && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-xl border border-border bg-popover p-1 shadow-md max-h-64 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
          {!loading && options.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
          )}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-foreground hover:bg-accent"
            >
              <HugeiconsIcon
                icon={Building03Icon}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="flex-1 truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function pillClass() {
  return "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground";
}

export function AppFilterBar({
  title,
  description,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search…",
  fetchSearchSuggestions,
  onSearchSuggestionSelect,
  filters = [],
  typeaheadFilters = [],
  headerActions,
  actions,
}: AppFilterBarProps) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<FilterOption[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    if (!fetchSearchSuggestions || !searchQuery) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    suggestDebounceRef.current = setTimeout(() => {
      fetchSearchSuggestions(searchQuery)
        .then((r) => {
          setSuggestions(r);
          setSuggestionsOpen(r.length > 0);
        })
        .catch(() => {});
    }, 200);
    return () => {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    };
  }, [searchQuery, fetchSearchSuggestions]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const activeFilters = filters.filter((f) => f.value !== "all");
  const activeTypeaheads = typeaheadFilters.filter((f) => f.selectedId !== null);
  const filterCount = activeFilters.length;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* ── Header row ── */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-normal text-foreground">{title}</h3>
          {description && (
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {headerActions && (
          <div className="flex shrink-0 items-center justify-start sm:justify-end">
            {headerActions}
          </div>
        )}
      </div>

      {/* ── Search + filter button row ── */}
      <div className="rounded-lg border border-border bg-muted/40 p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Search */}
          <div ref={searchContainerRef} className="relative min-w-0 flex-1 sm:max-w-sm">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none"
              strokeWidth={1.5}
            />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setSuggestionsOpen(true);
              }}
              placeholder={searchPlaceholder}
              className="h-9 rounded-md border-border bg-background pl-9 pr-8 text-sm shadow-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  setSuggestionsOpen(false);
                  setSuggestions([]);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
            {suggestionsOpen && suggestions.length > 0 && (
              <div className="absolute left-0 top-10 z-50 w-full rounded-xl border border-border bg-popover p-1 shadow-md max-h-64 overflow-y-auto">
                {suggestions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSearchSuggestionSelect?.(opt.id, opt.label);
                      setSuggestionsOpen(false);
                      setSuggestions([]);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-foreground hover:bg-accent"
                  >
                    <HugeiconsIcon
                      icon={Building03Icon}
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {typeaheadFilters.map((tf) => (
              <TypeaheadFilter key={tf.id} field={tf} />
            ))}
            {filters.length > 0 && (
              <DropdownMenu open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                      filterCount > 0
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <HugeiconsIcon icon={FilterIcon} className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Filter</span>
                    {filterCount > 0 && (
                      <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                        {filterCount}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 rounded-xl p-1">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Add filter
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {filters.map((filter) => (
                    <FilterSubMenu
                      key={filter.id}
                      filter={filter}
                      onClose={() => setFilterMenuOpen(false)}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {actions}
          </div>
        </div>

        {/* ── Active filter pills ── */}
        {activeFilters.length > 0 && (
          <>
            <Separator className="my-2" />
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters.map((filter, i) => {
                const selectedLabel =
                  filter.options.find((o) => o.id === filter.value)?.label ?? filter.value;
                return (
                  <div key={filter.id} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        and
                      </span>
                    )}
                    <div className={pillClass()}>
                      <span className="text-muted-foreground">{filter.label}</span>
                      <span className="text-muted-foreground/50">|</span>
                      <span>{selectedLabel}</span>
                      <button
                        type="button"
                        onClick={() => filter.onChange("all")}
                        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {activeFilters.length > 1 && (
                <button
                  type="button"
                  onClick={() => activeFilters.forEach((f) => f.onChange("all"))}
                  className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
