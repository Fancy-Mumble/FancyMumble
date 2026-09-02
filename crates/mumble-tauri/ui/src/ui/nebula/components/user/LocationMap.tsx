import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { divIcon, type GridLayer } from "leaflet";
import {
  leafletLayer,
  LineSymbolizer,
  PolygonSymbolizer,
  type Feature,
  type PaintRule,
} from "protomaps-leaflet";
import { MapContainer, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Where the map opens: a city and its surroundings. An address places someone
 * in a city, not on a street, and a closer first view would claim more than
 * the lookup knows - but the map can be taken anywhere from there, since an
 * admin who does not know the area needs to zoom out to learn where it is.
 */
const ZOOM = 11;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;

/**
 * OpenStreetMap, as vector tiles from OpenFreeMap's public instance - keyless,
 * and the same OSM data every raster server draws.
 *
 * The mock's map is roads and water on a flat ground and nothing else: no
 * place names, no terrain, no forest fills. A raster tile carries all of
 * those and cannot shed them; drawn dark it reads as an aerial photograph.
 * Vector tiles are painted here, by the rules below, so the map is drawn in
 * the sheet's own colours and never writes a word.
 */
const TILEJSON = "https://tiles.openfreemap.org/planet";

/** Deepest tile the source has; the rest is scaled from it. */
const MAX_DATA_ZOOM = 14;

/** What the data's terms ask for, wherever it is shown - the project names
 *  stay as they are, and only the word around them is translated. */
const CREDIT_KEY = "map.attribution";

/** The mock's faint graph-paper grid over the map. */
const GRID = (line: string) =>
  `repeating-linear-gradient(0deg,${line} 0 1px,transparent 1px 28px),` +
  `repeating-linear-gradient(90deg,${line} 0 1px,transparent 1px 28px)`;

let tileUrl: Promise<string> | null = null;

/** The versioned tile template, fetched once per session from the tilejson. */
function resolveTileUrl(): Promise<string> {
  tileUrl ??= fetch(TILEJSON)
    .then((response) => response.json() as Promise<{ tiles?: string[] }>)
    .then((json) => {
      const url = json.tiles?.[0];
      if (!url) throw new Error("tilejson names no tiles");
      return url;
    })
    .catch((error: unknown) => {
      // Let the next map try again rather than remembering the failure.
      tileUrl = null;
      throw error;
    });
  return tileUrl;
}

/** The sheet's two schemes, in the map's own terms. */
interface MapInk {
  ground: string;
  water: string;
  green: string;
  built: string;
  road: string;
  grid: string;
}

const INK: Record<"dark" | "light", MapInk> = {
  dark: {
    ground: "#1a2340",
    water: "#131a30",
    green: "#1d2948",
    built: "#1e2845",
    road: "135,180,255",
    grid: "rgba(135,180,255,.07)",
  },
  light: {
    ground: "#f1f3f8",
    water: "#dbe3f2",
    green: "#e6ebf2",
    built: "#e9ecf3",
    road: "40,48,80",
    grid: "rgba(40,48,80,.06)",
  },
};

const roadClass = (feature: Feature): string => String(feature.props.class ?? "");

const MAJOR = new Set(["motorway", "trunk", "primary"]);
const MIDDLE = new Set(["secondary", "tertiary"]);
const MINOR = new Set(["minor", "service", "track", "path", "cycleway", "footway"]);

/**
 * How the OpenMapTiles layers are drawn - fills first, then water lines, then
 * the roads by importance, so a motorway is never under a lane.
 */
function paintRules(ink: MapInk): PaintRule[] {
  const rgba = (alpha: number) => `rgba(${ink.road},${alpha})`;
  return [
    { dataLayer: "landcover", symbolizer: new PolygonSymbolizer({ fill: ink.green }) },
    { dataLayer: "park", symbolizer: new PolygonSymbolizer({ fill: ink.green }) },
    {
      dataLayer: "landuse",
      symbolizer: new PolygonSymbolizer({ fill: ink.built }),
      filter: (_zoom, feature) =>
        ["residential", "commercial", "industrial", "retail"].includes(roadClass(feature)),
    },
    { dataLayer: "water", symbolizer: new PolygonSymbolizer({ fill: ink.water }) },
    {
      dataLayer: "waterway",
      symbolizer: new LineSymbolizer({ color: ink.water, width: (z) => (z >= 12 ? 1.4 : 0.9) }),
    },
    {
      dataLayer: "transportation",
      symbolizer: new LineSymbolizer({ color: rgba(0.16), width: (z) => (z >= 13 ? 0.9 : 0.6) }),
      filter: (zoom, feature) => zoom >= 12 && MINOR.has(roadClass(feature)),
    },
    {
      dataLayer: "transportation",
      symbolizer: new LineSymbolizer({
        color: rgba(0.22),
        width: 0.8,
        dash: [3, 3],
      }),
      filter: (_zoom, feature) => roadClass(feature) === "rail",
    },
    {
      dataLayer: "transportation",
      symbolizer: new LineSymbolizer({ color: rgba(0.34), width: (z) => (z >= 13 ? 1.6 : 1) }),
      filter: (_zoom, feature) => MIDDLE.has(roadClass(feature)),
    },
    {
      dataLayer: "transportation",
      symbolizer: new LineSymbolizer({
        color: rgba(0.58),
        width: (z) => (z >= 13 ? 2.4 : z >= 11 ? 1.7 : 1.2),
      }),
      filter: (_zoom, feature) => MAJOR.has(roadClass(feature)),
    },
  ];
}

/** The mock's teardrop pin, in the accent, with a white eye. */
function pinIcon(accent: string) {
  return divIcon({
    className: "",
    iconSize: [18, 24],
    iconAnchor: [9, 24],
    html:
      `<svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">` +
      `<path d="M9 23.2S17 14.8 17 9A8 8 0 0 0 1 9c0 5.8 8 14.2 8 14.2Z" fill="${accent}" stroke="#fff" stroke-width="1.5"/>` +
      `<circle cx="9" cy="9" r="3" fill="#fff"/></svg>`,
  });
}

/** The painted tiles, added to the map once the source has said where it is. */
function VectorTiles({ ink, onLoad }: Readonly<{ ink: MapInk; onLoad: () => void }>) {
  const map = useMap();
  useEffect(() => {
    let cancelled = false;
    let layer: GridLayer | null = null;
    resolveTileUrl()
      .then((url) => {
        if (cancelled) return;
        layer = leafletLayer({
          url,
          paintRules: paintRules(ink),
          labelRules: [],
          backgroundColor: ink.ground,
          maxDataZoom: MAX_DATA_ZOOM,
        }) as unknown as GridLayer;
        layer.on("load", onLoad);
        layer.addTo(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [map, ink, onLoad]);
  return null;
}

interface LocationMapProps {
  lat: number;
  lng: number;
  /** Draw the dark scheme, for a dark surface. */
  dark: boolean;
  /** The colour the spot is marked in - the surface's accent. */
  accent: string;
}

/**
 * The map on the User Information sheet.
 *
 * A map to use, not a picture: it pans and zooms, with the wheel kept to
 * itself so zooming does not scroll the sheet it sits in. It stays invisible
 * until the tiles have been painted, so the frame's own placeholder shows
 * through rather than a blank ground - and keeps showing through if the
 * source cannot be reached.
 */
export default function LocationMap({ lat, lng, dark, accent }: Readonly<LocationMapProps>) {
  const { t } = useTranslation("nebulaUser");
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);
  const icon = useMemo(() => pinIcon(accent), [accent]);
  const ink = INK[dark ? "dark" : "light"];
  const frame = useRef<HTMLDivElement>(null);

  // The sheet scrolls on the wheel; over the map the wheel zooms instead, and
  // must not do both.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const keep = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener("wheel", keep, { passive: false });
    return () => element.removeEventListener("wheel", keep);
  }, []);

  return (
    <Box
      ref={frame}
      sx={{
        position: "absolute",
        inset: 0,
        opacity: loaded ? 1 : 0,
        transition: "opacity 320ms ease",
        // Leaflet stacks its panes at z-index 400; isolating the container
        // keeps that inside it, under the grid and the credit.
        "& .leaflet-container": {
          width: "100%",
          height: "100%",
          background: "transparent",
          font: "inherit",
          isolation: "isolate",
        },
        // Leaflet's zoom buttons, in the sheet's own chrome.
        "& .leaflet-control-zoom": { border: "none", boxShadow: "none", m: "8px" },
        "& .leaflet-control-zoom a": {
          width: 24,
          height: 24,
          lineHeight: "22px",
          fontSize: 15,
          color: dark ? "#fff" : "#252a3c",
          background: dark ? "rgba(10,14,26,.66)" : "rgba(255,255,255,.8)",
          border: "none",
          backdropFilter: "blur(6px)",
          "&:first-of-type": { borderRadius: "8px 8px 0 0" },
          "&:last-of-type": { borderRadius: "0 0 8px 8px" },
          "&:hover": { background: dark ? "rgba(30,40,70,.8)" : "rgba(255,255,255,.95)" },
        },
      }}
    >
      <MapContainer
        center={[lat, lng]}
        zoom={ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomControl
        attributionControl={false}
        scrollWheelZoom
        doubleClickZoom
        dragging
        touchZoom
        keyboard
      >
        <VectorTiles ink={ink} onLoad={onLoad} />
        <Marker position={[lat, lng]} icon={icon} interactive={false} />
      </MapContainer>
      <Box
        aria-hidden
        sx={{ position: "absolute", inset: 0, pointerEvents: "none", background: GRID(ink.grid) }}
      />
      <span
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          fontSize: 8.5,
          lineHeight: 1,
          color: dark ? "#fff" : "#252a3c",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      >
        {t(CREDIT_KEY)}
      </span>
    </Box>
  );
}
