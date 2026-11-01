import { api, type RequestOptions } from "~/lib/api";

import type { AdminBoat, AdminPort, AdminRoute, Partner, Translations } from "./types";

export function nameOf(tr: Translations<{ name: string }> | null | undefined): string {
  if (!tr) return "";
  return tr.en?.name || Object.values(tr)[0]?.name || "";
}

export interface BoatOption {
  value: string;
  label: string;
}

export async function loadBoatOptions(request?: Request): Promise<BoatOption[]> {
  const r = await api<AdminBoat[]>("/admin/boats", { request, query: { per_page: 100 } });
  return (r.data ?? [])
    .filter((b) => b.status !== "ARCHIVED")
    .map((b) => ({ value: b.id, label: `${nameOf(b.translations)} (${b.code})` }));
}

export async function loadRoutes(opts: RequestOptions = {}): Promise<AdminRoute[]> {
  return (await api<AdminRoute[]>("/admin/routes", opts)).data ?? [];
}

export async function loadPorts(opts: RequestOptions = {}): Promise<AdminPort[]> {
  return (await api<AdminPort[]>("/admin/ports", opts)).data ?? [];
}

export async function loadPartners(request?: Request): Promise<Partner[]> {
  return (await api<Partner[]>("/admin/partners", { request })).data ?? [];
}

export function portZone(ports: AdminPort[], portId: string | undefined): string | undefined {
  return ports.find((p) => p.id === portId)?.timezone;
}

export function routeZone(routes: AdminRoute[], ports: AdminPort[], routeId: string | undefined): string | undefined {
  return portZone(ports, routes.find((r) => r.id === routeId)?.departure_port_id);
}

export function areaName(a: { translations: Translations<{ name: string }>; deck_label: string }): string {
  const n = nameOf(a.translations);
  return a.deck_label ? `${n} · ${a.deck_label}` : n;
}
