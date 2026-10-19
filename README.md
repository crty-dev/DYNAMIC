# DYNAMIC

Modern, gizlilik odaklı web analitiği ve gerçek kullanıcı performans ölçümü (RUM) platformu.

**Hedefler**

- %100 açık kaynak (MIT), tamamen ücretsiz katmanlarla çalışır
- Cloudflare Workers (Free plan) + Static Assets üzerinde dağıtılır
- Veri: Cloudflare D1 (SQLite), gerekli yerde R2
- NoSQL sunucu, PostgreSQL, ClickHouse, Redis, Kafka yok
- Zorunlu üçüncü taraf SaaS yok

**Bileşenler (planlanan mimari — see docs/ARCHITECTURE.md)**

| Parça     | Teknoloji                                                        |
| --------- | ---------------------------------------------------------------- |
| Web       | React 19 + TypeScript + Vite, Tailwind CSS + shadcn/ui           |
| Veri      | TanStack Query + React Router, Recharts + Lucide                 |
| API       | Hono + TypeScript, Cloudflare Workers                            |
| Depolama  | Cloudflare D1 (v1), R2 yalnız gerekli yerde                      |
| SDK       | `GoogleChrome/web-vitals` (Apache-2.0) tabanlı takip SDK si       |

**Belgeler**

- Mimari denetim ve teknoloji kararları: `docs/ARCHITECTURE.md`
- Görev listesi / yol haritası: `docs/ROADMAP.md`
- Marka varlıkları: `images/` (monogram ikonlar, logo, palette)

**Not:** `.opencode/` klasörü yerel MCP yapılandırması içerdiğinden (canlı
API anahtarları) repoya girmemesi için `.gitignore` kurallarına dahildir.
