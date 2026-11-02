function inject(id: string, src: string): boolean {
  if (document.getElementById(id)) return false;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
  return true;
}

// Called only after the visitor accepts analytics cookies (PRD 18.3).
export function loadAnalytics({ ga4, gtm }: { ga4?: string; gtm?: string }) {
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  if (ga4 && inject("ga4", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`)) {
    w.gtag = (...a: unknown[]) => w.dataLayer.push(a);
    w.gtag("js", new Date());
    w.gtag("config", ga4, { anonymize_ip: true });
  }
  if (gtm && inject("gtm", `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtm)}`)) {
    w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  }
}
