import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  type GeoFeature,
} from "react-simple-maps";
import { geoCentroid, geoBounds } from "d3-geo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getHeatmapStates,
  getHeatmapDistricts,
  type HeatmapFilter,
  type HeatmapStateItem,
  type HeatmapDistrictItem,
} from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { MapPin, ArrowLeft, Info, TrendingUp } from "lucide-react";

const STATES_URL = "/india-states.json";
const DISTRICTS_URL = "/india-districts.json";

const STATE_CODE_TO_GEO: Record<string, string> = {
  AN: "Andaman and Nicobar",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CH: "Chandigarh",
  CG: "Chhattisgarh",
  DN: "Dadra and Nagar Haveli",
  DD: "Daman and Diu", // present in official post-2019 file
  DL: "Delhi",
  GA: "Goa",
  GJ: "Gujarat",
  HR: "Haryana",
  HP: "Himachal Pradesh",
  JK: "Jammu and Kashmir",
  JH: "Jharkhand",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Jammu and Kashmir", // Ladakh merged into J&K in GeoJSON
  LD: "Lakshadweep",
  MP: "Madhya Pradesh",
  MH: "Maharashtra",
  MN: "Manipur",
  ML: "Meghalaya",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Orissa",
  PY: "Puducherry",
  PB: "Punjab",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TN: "Tamil Nadu",
  TS: "Telangana",
  TR: "Tripura",
  UP: "Uttar Pradesh",
  UK: "Uttaranchal",
  WB: "West Bengal",
};

// Build reverse map; when multiple codes share a geo name (e.g. JK + LA → "Jammu and Kashmir"),
// prefer the primary code by skipping duplicates after the first.
const GEO_TO_STATE_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(STATE_CODE_TO_GEO)) {
  if (!(name in GEO_TO_STATE_CODE)) GEO_TO_STATE_CODE[name] = code;
}

// Empty/no-data — neutral warm-gray
const COLOR_EMPTY = "hsl(20 8% 86%)";

// Warm single-family scale: pale peach → amber → burnt orange → deep crimson
// Hue gently shifts from 30 → 10 (orange to red), lightness does the heavy lifting
function interpolateColor(t: number): string {
  if (!isFinite(t) || t < 0.001) return COLOR_EMPTY;
  t = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [
    [30, 80, 94], // pale peach
    [28, 82, 82], // soft apricot
    [24, 86, 70], // warm amber
    [18, 88, 58], // orange
    [12, 86, 48], // deep orange
    [8, 82, 38], // burnt orange-red
    [4, 78, 28], // deep crimson
  ];
  const idx = t * (stops.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, stops.length - 1);
  const frac = idx - lo;
  const [h1, s1, l1] = stops[lo];
  const [h2, s2, l2] = stops[hi];
  return `hsl(${(h1 + (h2 - h1) * frac).toFixed(1)} ${(s1 + (s2 - s1) * frac).toFixed(1)}% ${(l1 + (l2 - l1) * frac).toFixed(1)}%)`;
}

interface TooltipState {
  x: number;
  y: number;
  name: string;
  complaints: number;
  pct: number;
}

function animateTo(
  fromZoom: number,
  toZoom: number,
  fromCenter: [number, number],
  toCenter: [number, number],
  duration: number,
  onUpdate: (zoom: number, center: [number, number]) => void,
  onDone?: () => void,
) {
  const start = performance.now();
  // expo ease-out — fast start, glides to stop
  const ease = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
  function step(now: number) {
    const t = ease(Math.min((now - start) / duration, 1));
    onUpdate(fromZoom + (toZoom - fromZoom) * t, [
      fromCenter[0] + (toCenter[0] - fromCenter[0]) * t,
      fromCenter[1] + (toCenter[1] - fromCenter[1]) * t,
    ]);
    if (t < 1) requestAnimationFrame(step);
    else onDone?.();
  }
  requestAnimationFrame(step);
}

export interface IndiaHeatmapProps {
  // Same filter shape the dashboard already passes to the summary / trend
  // endpoints. Omit to render a lifetime aggregate.
  filter?: HeatmapFilter;
}

export function IndiaHeatmap({ filter }: IndiaHeatmapProps = {}) {
  // Memoise into a stable identity per filter contents so dependent useEffects
  // don't re-fire when the parent re-renders with a fresh object literal.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        f: filter?.created_at_from ?? "",
        t: filter?.created_at_to ?? "",
        c: (filter?.category ?? []).slice().sort(),
      }),
    [filter?.created_at_from, filter?.created_at_to, filter?.category],
  );
  const fetchFilter: HeatmapFilter = useMemo(
    () => ({
      created_at_from: filter?.created_at_from,
      created_at_to: filter?.created_at_to,
      category: filter?.category,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey],
  );

  const [stateData, setStateData] = useState<HeatmapStateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [districts, setDistricts] = useState<HeatmapDistrictItem[]>([]);
  const [districtTotal, setDistrictTotal] = useState(0);
  const [drillLoading, setDrillLoading] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  // District GeoJSON loaded lazily
  const [districtGeoJson, setDistrictGeoJson] = useState<object | null>(null);
  const districtGeoLoading = useRef(false);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([83, 22]);
  const animating = useRef(false);
  // Cache state geo features by NAME_1 so right-panel clicks can zoom too
  const stateGeoCache = useRef<Record<string, GeoFeature>>({});

  // Refetch whenever the filter changes. If the user is currently drilled
  // into a state, also refresh that state's district counts so the right-side
  // panel stays consistent with the new filter.
  useEffect(() => {
    setLoading(true);
    setError(null);
    getHeatmapStates(fetchFilter)
      .then((res) => {
        setStateData(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    if (selectedCode) {
      setDrillLoading(true);
      getHeatmapDistricts(selectedCode, fetchFilter)
        .then((res) => {
          setDistricts(res.districts);
          setDistrictTotal(res.total_complaints);
        })
        .catch(() => setDistricts([]))
        .finally(() => setDrillLoading(false));
    }
    // selectedCode is intentionally excluded — we don't want a redundant
    // re-fetch when the user simply drills in/out (those code paths fetch
    // their own districts already).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFilter]);

  // Preload districts GeoJSON once
  const loadDistrictGeo = useCallback(() => {
    if (districtGeoJson || districtGeoLoading.current) return;
    districtGeoLoading.current = true;
    fetch(DISTRICTS_URL)
      .then((r) => r.json())
      .then((d) => setDistrictGeoJson(d))
      .catch(() => {});
  }, [districtGeoJson]);

  const countByCode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of stateData) {
      // Resolve to the primary code (e.g. LA → JK since Ladakh is merged into J&K geo)
      const primaryCode = GEO_TO_STATE_CODE[STATE_CODE_TO_GEO[s.state_code] ?? ""] ?? s.state_code;
      m[primaryCode] = (m[primaryCode] ?? 0) + (s.complaints ?? 0);
    }
    return m;
  }, [stateData]);
  const maxCount = useMemo(
    () => Math.max(1, ...(stateData ?? []).map((s) => s.complaints ?? 0)),
    [stateData],
  );

  // District complaint count by normalised district name
  // Also index by known GeoJSON aliases so mismatched names still colour correctly
  const districtCountByName = useMemo(() => {
    // GeoJSON name → API name (lowercase)
    const GEO_ALIAS: Record<string, string> = {
      "greater bombay": "mumbai city",
      mumbai: "mumbai city",
      ahmadabad: "ahmedabad", // Gujarat GeoJSON spelling
      raigarh: "raigad", // Maharashtra
      bid: "beed",
      garhchiroli: "gadchiroli",
      osmanabad: "dharashiv",
      aurangabad: "chhatrapati sambhajinagar",
      bangalore: "bengaluru",
      "bangalore rural": "bengaluru rural",
      "bangalore urban": "bengaluru urban",
      mysore: "mysuru",
      bellary: "ballari",
      shimoga: "shivamogga",
      gulbarga: "kalaburagi",
      bijapur: "vijayapura",
      bidar: "bidar",
      tumkur: "tumakuru",
      chitradurga: "chitradurga",
      "north 24 parganas": "north twenty four parganas",
      "south 24 parganas": "south twenty four parganas",
      "purba medinipur": "east midnapore",
      "paschim medinipur": "west midnapore",
      hooghly: "hugli",
    };

    const map: Record<string, number> = {};
    for (const d of districts) {
      const apiName = (d.district_name || d.district_code).toLowerCase().trim();
      map[apiName] = d.complaints;
    }
    // Add reverse aliases: GeoJSON name → count from API name
    for (const [geoName, apiName] of Object.entries(GEO_ALIAS)) {
      if (map[apiName] !== undefined && map[geoName] === undefined) {
        map[geoName] = map[apiName];
      }
    }
    return map;
  }, [districts]);

  const districtMax = useMemo(
    () => Math.max(1, ...(districts ?? []).map((d) => d.complaints ?? 0)),
    [districts],
  );

  const handleStateClick = useCallback(
    (geoName: string, geo: GeoFeature) => {
      const code = GEO_TO_STATE_CODE[geoName];
      if (!code) return;

      loadDistrictGeo();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const centroid = geoCentroid(geo as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bounds = geoBounds(geo as any);
      const lonSpan = bounds[1][0] - bounds[0][0];
      const latSpan = bounds[1][1] - bounds[0][1];
      const span = Math.max(lonSpan, latSpan);
      // zoom to fill ~80% of the viewport — gentler scale so full state is visible
      const targetZoom = Math.min(5, Math.max(2, 32 / span));
      const targetCenter: [number, number] = [centroid[0], centroid[1]];

      setPanelVisible(false);
      setSelectedCode(code);
      setSelectedName(geoName);
      setDrillLoading(true);
      setDistricts([]);

      getHeatmapDistricts(code, fetchFilter)
        .then((res) => {
          setDistricts(res.districts);
          setDistrictTotal(res.total_complaints);
        })
        .catch(() => setDistricts([]))
        .finally(() => {
          setDrillLoading(false);
          setTimeout(() => setPanelVisible(true), 100);
        });

      if (!animating.current) {
        animating.current = true;
        animateTo(
          zoom,
          targetZoom,
          center,
          targetCenter,
          750,
          (z, c) => {
            setZoom(z);
            setCenter(c);
          },
          () => {
            animating.current = false;
          },
        );
      }
    },
    [zoom, center, loadDistrictGeo, fetchFilter],
  );

  const handleBack = () => {
    setPanelVisible(false);
    setTimeout(() => {
      setSelectedCode(null);
      setSelectedName(null);
      setDistricts([]);
    }, 280);
    animateTo(zoom, 1, center, [83, 22], 600, (z, c) => {
      setZoom(z);
      setCenter(c);
    });
  };

  const topStates = useMemo(
    () => [...stateData].sort((a, b) => b.complaints - a.complaints).slice(0, 8),
    [stateData],
  );
  const legendStops = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  // ── Map layer depending on drill-down state ──
  const mapContent = useMemo(() => {
    if (selectedCode && districtGeoJson) {
      // Render district polygons for selected state
      const selectedGeoName = STATE_CODE_TO_GEO[selectedCode];
      return (
        <Geographies geography={districtGeoJson}>
          {({ geographies }: { geographies: GeoFeature[] }) =>
            geographies
              .filter((geo) => geo.properties.NAME_1 === selectedGeoName)
              .map((geo) => {
                const distName = (geo.properties.NAME_2 as string) || "";
                const count = districtCountByName[distName.toLowerCase().trim()] ?? 0;
                const fill = interpolateColor(count / districtMax);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth={0.3}
                    className="[transition:fill_0.4s_ease,opacity_0.3s_ease]"
                    style={{
                      default: { outline: "none" },
                      hover: {
                        outline: "none",
                        filter: "brightness(1.2) saturate(1.1)",
                        cursor: "default",
                      },
                      pressed: { outline: "none" },
                    }}
                    onMouseEnter={(e: React.MouseEvent<SVGPathElement>) => {
                      const rect = (e.target as SVGElement)
                        .closest("svg")
                        ?.parentElement?.getBoundingClientRect();
                      // Use alias-aware map so "Greater Bombay" → Mumbai City count
                      const count = districtCountByName[distName.toLowerCase().trim()] ?? 0;
                      const pct = districtTotal > 0 ? (count / districtTotal) * 100 : 0;
                      setTooltip({
                        x: rect ? e.clientX - rect.left : e.clientX,
                        y: rect ? e.clientY - rect.top : e.clientY,
                        name: distName,
                        complaints: count,
                        pct,
                      });
                    }}
                    onMouseMove={(e: React.MouseEvent<SVGPathElement>) => {
                      const rect = (e.target as SVGElement)
                        .closest("svg")
                        ?.parentElement?.getBoundingClientRect();
                      if (rect)
                        setTooltip((t) =>
                          t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
                        );
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
          }
        </Geographies>
      );
    }

    // Default: state-level heatmap
    return (
      <Geographies geography={STATES_URL}>
        {({ geographies }: { geographies: GeoFeature[] }) =>
          geographies.map((geo: GeoFeature) => {
            const geoName = geo.properties.NAME_1 as string;
            const code = GEO_TO_STATE_CODE[geoName];
            // Populate cache so right-panel clicks can zoom.
            // Also cache under all codes that share this geo name (e.g. LA shares JK's geo).
            if (code) {
              for (const [c, n] of Object.entries(STATE_CODE_TO_GEO)) {
                if (n === geoName && !stateGeoCache.current[c]) stateGeoCache.current[c] = geo;
              }
            }
            const count = countByCode[code] ?? 0;
            const fill = interpolateColor(count / maxCount);
            const isSelected = code === selectedCode;
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={fill}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={0.6}
                className="[transition:opacity_0.35s_ease,filter_0.35s_ease,fill_0.5s_ease]"
                style={{
                  default: {
                    outline: "none",
                    opacity: selectedCode && !isSelected ? 0.18 : 1,
                    filter: isSelected
                      ? "drop-shadow(0 0 10px rgba(0,0,0,0.5)) brightness(1.12) saturate(1.2)"
                      : undefined,
                  },
                  hover: {
                    outline: "none",
                    opacity: 1,
                    cursor: "pointer",
                    filter: "brightness(1.18) saturate(1.15) drop-shadow(0 0 4px rgba(0,0,0,0.25))",
                  },
                  pressed: { outline: "none" },
                }}
                onMouseEnter={(e: React.MouseEvent<SVGPathElement>) => {
                  const rect = (e.target as SVGElement)
                    .closest("svg")
                    ?.parentElement?.getBoundingClientRect();
                  setTooltip({
                    x: rect ? e.clientX - rect.left : e.clientX,
                    y: rect ? e.clientY - rect.top : e.clientY,
                    name: geoName,
                    complaints: count,
                    pct: total > 0 ? (count / total) * 100 : 0,
                  });
                }}
                onMouseMove={(e: React.MouseEvent<SVGPathElement>) => {
                  const rect = (e.target as SVGElement)
                    .closest("svg")
                    ?.parentElement?.getBoundingClientRect();
                  if (rect)
                    setTooltip((t) =>
                      t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
                    );
                }}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => handleStateClick(geoName, geo)}
              />
            );
          })
        }
      </Geographies>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCode,
    districtGeoJson,
    districtCountByName,
    districtMax,
    countByCode,
    maxCount,
    total,
    handleStateClick,
    districts,
    districtTotal,
  ]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/60">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div>
              <CardTitle className="text-[13px] font-semibold">
                {selectedCode ? (
                  <span className="flex items-center gap-1.5">
                    Geographic Distribution
                    <span className="text-muted-foreground font-normal">›</span>
                    <span>{selectedName}</span>
                  </span>
                ) : (
                  "Geographic Distribution"
                )}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {selectedCode
                  ? `${fmtNumber(districtTotal)} complaints · district breakdown`
                  : `${fmtNumber(total)} total · click a state to drill down`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedCode && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
                All States
              </button>
            )}
            <Badge variant="outline" className="text-[10px] font-medium gap-1">
              <TrendingUp className="h-2.5 w-2.5" strokeWidth={1.5} />
              Live
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex h-[740px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
              <span className="text-xs text-muted-foreground">Loading map data…</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-[740px] items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center max-w-xs">
              <Info className="h-8 w-8 text-muted-foreground/40" strokeWidth={1} />
              <p className="text-sm font-medium">Could not load heatmap</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 lg:grid-cols-[1fr_280px] divide-y lg:divide-y-0 lg:divide-x divide-border"
            style={{ height: 740 }}
          >
            {/* ── Map panel ── */}
            <div className="relative select-none flex flex-col h-full">
              {/* Zoom controls */}
              <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
                {[
                  { label: "+", fn: () => setZoom((z) => Math.min(z * 1.5, 14)) },
                  { label: "−", fn: () => setZoom((z) => Math.max(z / 1.5, 1)) },
                ].map(({ label, fn }) => (
                  <button
                    key={label}
                    onClick={fn}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/90 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {label}
                  </button>
                ))}
                {zoom > 1.05 && (
                  <button
                    onClick={() => {
                      setZoom(1);
                      setCenter([83, 22]);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/90 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground transition-colors"
                  >
                    ⌂
                  </button>
                )}
              </div>

              {/* Legend */}
              <div className="absolute bottom-3 left-3 z-10 rounded-xl border border-border/60 bg-card/95 px-3 py-2.5 backdrop-blur-sm shadow-md">
                <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {selectedCode ? "District Complaints" : "Complaint Density"}
                </div>
                {/* gradient bar */}
                <div
                  className="relative h-2 w-36 rounded-full overflow-hidden"
                  style={{
                    background: `linear-gradient(to right, ${legendStops.map((t) => interpolateColor(Math.max(t, 0.001))).join(", ")})`,
                  }}
                ></div>
                {/* tick labels */}
                <div className="mt-1.5 flex justify-between text-[9px] font-medium text-muted-foreground/70">
                  <span>Low</span>
                  <span>Mid</span>
                  <span>High</span>
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground/60">
                  <span>0</span>
                  <span>{fmtNumber(Math.round((selectedCode ? districtMax : maxCount) / 2))}</span>
                  <span>{fmtNumber(selectedCode ? districtMax : maxCount)}</span>
                </div>
              </div>

              {/* Tooltip */}
              {tooltip && (
                <div
                  className="pointer-events-none absolute z-20 rounded-xl border border-border/70 bg-card/95 backdrop-blur-sm shadow-xl px-3 py-2.5 min-w-[130px]"
                  style={{
                    left: tooltip.x + 14,
                    top: tooltip.y - 12,
                    transform: "translateY(-100%)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-white/20"
                      style={{
                        background: interpolateColor(
                          tooltip.complaints / (selectedCode ? districtMax : maxCount),
                        ),
                      }}
                    />
                    <div className="text-[11px] font-semibold leading-tight truncate">
                      {tooltip.name}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[15px] font-bold tabular-nums"
                      style={{
                        color: interpolateColor(
                          tooltip.complaints / (selectedCode ? districtMax : maxCount),
                        ),
                      }}
                    >
                      {fmtNumber(tooltip.complaints)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">complaints</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {tooltip.pct.toFixed(1)}% of {selectedCode ? "state" : "India"}
                  </div>
                  {!selectedCode && (
                    <div className="text-[9px] text-muted-foreground/60 mt-1.5 border-t border-border/50 pt-1">
                      Click to explore districts
                    </div>
                  )}
                </div>
              )}

              {/* Loading overlay for district geo */}
              {selectedCode && !districtGeoJson && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-sm">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                </div>
              )}

              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ center: [83, 22], scale: 955 }}
                width={640}
                height={560}
                style={{ width: "100%", flex: 1, minHeight: 0 }}
              >
                <ZoomableGroup
                  zoom={zoom}
                  center={center}
                  onMoveEnd={({
                    zoom: z,
                    coordinates,
                  }: {
                    zoom: number;
                    coordinates: [number, number];
                  }) => {
                    if (!animating.current) {
                      setZoom(z);
                      setCenter(coordinates);
                    }
                  }}
                >
                  {mapContent}
                </ZoomableGroup>
              </ComposableMap>
            </div>

            {/* ── Right panel ── */}
            <div className="flex flex-col h-full overflow-hidden">
              {selectedCode ? (
                <div
                  className="flex flex-col h-full"
                  style={{
                    opacity: panelVisible ? 1 : 0,
                    transform: panelVisible ? "translateX(0)" : "translateX(16px)",
                    transition: "opacity 0.35s ease, transform 0.35s ease",
                  }}
                >
                  <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
                    <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-1">
                      {selectedName}
                    </div>
                    <div className="text-[22px] font-semibold tracking-tight">
                      {fmtNumber(districtTotal)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">total complaints</div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
                    {drillLoading ? (
                      Array.from({ length: 7 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-[68px] rounded-lg bg-muted/40 animate-pulse"
                          style={{ animationDelay: `${i * 60}ms` }}
                        />
                      ))
                    ) : districts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Info className="h-6 w-6 text-muted-foreground/40" strokeWidth={1} />
                        <p className="text-xs text-muted-foreground">No district data available</p>
                      </div>
                    ) : (
                      districts
                        .sort((a, b) => b.complaints - a.complaints)
                        .map((d, i) => {
                          const pct = districtTotal > 0 ? (d.complaints / districtTotal) * 100 : 0;
                          const barColor = interpolateColor(d.complaints / districtMax);
                          return (
                            <div
                              key={d.district_code}
                              className="rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-muted/30 transition-colors"
                              style={{
                                opacity: panelVisible ? 1 : 0,
                                transform: panelVisible ? "translateY(0)" : "translateY(8px)",
                                transition: `opacity 0.3s ease ${i * 35}ms, transform 0.3s ease ${i * 35}ms`,
                              }}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                                    style={{ background: barColor }}
                                  >
                                    {i + 1}
                                  </span>
                                  <span className="text-[12px] font-medium truncate">
                                    {d.district_name || d.district_code}
                                    {d.ambiguous && (
                                      <span className="ml-1 text-[9px] text-muted-foreground/60 border border-border rounded px-1 py-0.5">
                                        ~
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[12px] font-semibold">
                                  {fmtNumber(d.complaints)}
                                </span>
                              </div>
                              <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className="absolute left-0 top-0 h-full rounded-full"
                                  style={{
                                    width: panelVisible ? `${pct}%` : "0%",
                                    background: barColor,
                                    transition: `width 0.6s cubic-bezier(0.16,1,0.3,1) ${120 + i * 35}ms`,
                                  }}
                                />
                              </div>
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                {pct.toFixed(1)}% of state total
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
                    <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-1">
                      Top States
                    </div>
                    <div className="text-[22px] font-semibold tracking-tight">
                      {fmtNumber(total)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      total complaints across India
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
                    {topStates.map((s, i) => {
                      const pct = total > 0 ? (s.complaints / total) * 100 : 0;
                      const barColor = interpolateColor(s.complaints / maxCount);
                      return (
                        <button
                          key={s.state_code}
                          className="w-full text-left rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-muted/30 transition-colors group"
                          onClick={() => {
                            loadDistrictGeo();
                            setSelectedCode(s.state_code);
                            setSelectedName(STATE_CODE_TO_GEO[s.state_code] ?? s.state_name);
                            setPanelVisible(false);
                            setDrillLoading(true);
                            setDistricts([]);
                            getHeatmapDistricts(s.state_code, fetchFilter)
                              .then((res) => {
                                setDistricts(res.districts);
                                setDistrictTotal(res.total_complaints);
                              })
                              .catch(() => setDistricts([]))
                              .finally(() => {
                                setDrillLoading(false);
                                setTimeout(() => setPanelVisible(true), 100);
                              });
                            // Zoom to state using cached geo feature
                            const geo = stateGeoCache.current[s.state_code];
                            if (geo && !animating.current) {
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const centroid = geoCentroid(geo as any);
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const bounds = geoBounds(geo as any);
                              const span = Math.max(
                                bounds[1][0] - bounds[0][0],
                                bounds[1][1] - bounds[0][1],
                              );
                              const targetZoom = Math.min(5, Math.max(2, 32 / span));
                              animating.current = true;
                              animateTo(
                                zoom,
                                targetZoom,
                                center,
                                [centroid[0], centroid[1]],
                                750,
                                (z, c) => {
                                  setZoom(z);
                                  setCenter(c);
                                },
                                () => {
                                  animating.current = false;
                                },
                              );
                            }
                          }}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                                style={{ background: barColor }}
                              >
                                {i + 1}
                              </span>
                              <span className="text-[12px] font-medium truncate">
                                {s.state_name}
                              </span>
                            </div>
                            <span className="shrink-0 text-[12px] font-semibold">
                              {fmtNumber(s.complaints)}
                            </span>
                          </div>
                          <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, background: barColor }}
                            />
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {pct.toFixed(1)}% of total
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
