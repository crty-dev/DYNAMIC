# DYNAMIC — Mimari Denetim Raporu ve Teknoloji Kararları

Tarih: 2026-10-19 · Denetimi yapan: OpenCode GLM-5.3 · Sürüm: v1

---

## 1. Mevcut Durum (oenumerative audit)

### 1.1 Workspace (`D:\Games\Projeler\DYNAMIC`)

| Bulgu | Durum |
| --- | --- |
| Git deposu | **YOK** (bu oturumda ilk kez `git init` yapıldı) |
| `package.json` / kaynak kod / wrangler yapılandırması | **YOK** — kod tabanı bu klasörde hiç yoktur |
| Mevcut içerik | `images/` (marka varlıkları) + `.opencode/opencode.json` |
| Marka varlıkları | D-monogram ikonlar (`DYNAMIC Console/Analytics/RUM/SDK.jpg`, removebg PNG'ler), `logo.svg`lar, `favicon.ico`, `wplz-icon-32x32.svg`, `renkler.txt` (palet), `Palette.svg`, WebP dönüşümleri (`jpg-to-webp/`, `png-to-webp/`) |
| `images/renkler.txt` paleti | `#1d72fc` → `#24d2cd` (mavi→turkuaz), koyu zemin `#010c18`, destek: `#0a3261`, `#20a7df`, `#1f92eb`, `#23bcd5`, `#0f515d`, `#1e82f4` |
| `.opencode/opencode.json` | MCP yapılandırması; içerinde **canlı API token'ları** (paddle, render, testsprite) → `.gitignore` koruması altına alındı; bu token'lar user-key seviyesinde olduklarından hiçbir repoya girmez |

### 1.2 Canlı site (`https://dynamic.crty-dev.com/`)

- `curl` → `Could not resolve host` (DNS kaynağı yok)
- Tarayıcı → `ERR_TUNNEL_CONNECTION_FAILED`
- **Durum: şu anda erişilemez.** Site ya DNS'ten düşürülmüş ya ana bilgisayar kayıtlı değil. Canlı kaynak kodu bu nedenle alınamadı.

### 1.3 Cloudflare hesabı (API üzerinden doğrulandı)

| Kaynak | İçerik | DYNAMIC ile ilişkisi |
| --- | --- | --- |
| Workers (6) | `eticaret-mcp-proxy`, `e-ticaret-proxy`, `odu`, `dijidavet-proxy`, `bothost`, `supportly` | **İlişki yok** — DYNAMIC Worker'ı yok |
| D1 (2) | `topluyo-ai`, `supportly-db` | **İlişki yok** — DYNAMIC veritabanı yok |
| KV (1) | `dijidavet_kv` | **İlişki yok** — DYNAMIC KV yok |

### 1.4 Referans projeler

- **GoogleChrome/web-vitals** — `Apache-2.0` (LICENSE dosyasından doğrulandı; GitHub repo README'si ve API gangway ile karşılıklı). ~3 KB (brotli'li) kütüphane; CLS/FCP/INP/LCP/TTFB + attribution build sağlar; `sendBeacon` ile batch gönderim önerir; html-metadata'da `sendToAnalytics` şablonunu dokümante eder. DYNAMIC SDK'nın çekirdeği tamamen bu.
- **umami-software/umami** — `MIT` (LICENSE dosyasından doğrulandı). Next.js + Node.js sunucu + PostgreSQL gerektirir. DYNAMIC'ın Workers/D1 mimarisiyle **başa çıkmaz** → **kod kopyalanmayacak**; sadece "sunuculanan tek satır JS + session-heuristics + no-cookie modeli" yaklaşımı fikir olarak alınmış, veritabanı ağır işleri D1'e uyarlanacak.

**Lisans kararı: DYNAMIC = MIT.** (Umami ile uyum; Apache-2.0 web-vitals bağımlılığıyla birlikte dağıtım sorunsuz.)

### 1.5 Figma tasarımı (`node-id=101-982`, topluluk dosyası ayrı)

Figma MCP (`figma-extras`) yalnızcKUB yorum araçları sunar → davetli node ağacını doğrudan okuyamadı;
bunun yerine tarayıcıyla dosya açılıp ekran görüntüleri alınarak **gerçekten incelendi**:
- Dosya: `SaaS, Futuristic App — Webflow Landing Page Design (Community)`
- İncelenen frame: **`Building SignalPage`** (720 × 1907 HB) + yan varyantlar `Building OrbitPage`, `Building Field…`
- Yapı: navbar + "Modern analytics for the modern world" hero (mor/koyu degrade arka plan + dashboard mockup), güven logoları marquee, "Features that work for your future" grid'i (Analytics Dashboard / Digital Credit Tokens / Code Collaboration), kod penceresi bileşeni, "Our powerful analytics provides invaluable insights" geniş CTA bandı, CONTACT/ADDRESS/SOCIAL footer.
- **Önemli:** referans temanın rengi **mor**; marka paleti (`renkler.txt`) ise **mavi→turkuaz**. Uygulama marka paletiyle, referans kulüp kompozisyonuyla yapılacak (mor rengine sadık kalınmayacak).

---

## 2. Kesin Teknoloji Kararları

| Katman | Karar | Gerekçe |
| --- | --- | --- |
| Çalışma zamanı | Cloudflare Workers + Static Assets | Statik istekler Free plan'da **limitsiz ve ücret istemiyor**; tek deployment birimi |
| Router/API | Hono + TypeScript | Workers yerli, edge-uyumlu,型和-uyumlu, hafif |
| Veri | **Cloudflare D1** (SQLite), gerekli yerde R2 | Ücretsiz kontenjanlar analytics v1 için yeterli; R2'ye yalnızca ~90+ gün istatistiği export'ta |
| UI | React 19 + TypeScript + Vite | Talep edildi |
| Bileşen/Düzen | Tailwind CSS + shadcn/ui | Talep edildi |
| Veri/getirim | TanStack Query + React Router | Talep edildi |
| Görselleştirme | Recharts + Lucide | Talep edildi |
| RUM SDK | `web-vitals` (attribution build) → `sendBeacon` batch | Apache-2.0; dokümante edilen `/analytics` endpoint modeli |
| Deploy CLI | Wrangler (npx ile) | Global kurulum configure edilmedi |
| YASAKLI | Node.js sunucusu, PostgreSQL, ClickHouse, Redis, Kafka, ücretli hosting, zorunlu SaaS | Kullanıcı zorunlu kuralı (rule) |

## 3. Cloudflare Free Plan Kota Doğrulaması

**Kaynak: resmi Cloudflare dokümanları** (2026-10-19 çekim):

- Workers Free: **100.000 istek/gün** (aşımında 1027 hatası; kota 00:00 UTC'de sıfırlanır) — *workers/platform/limits*
- CPU: **10 ms/HTTP isteği**; cron için 10 ms — *workers/platform/limits*
- Static assets istekleri: **ücretsiz ve limitsiz** — *workers/platform/pricing*
- Static assets kontenjanı: **20.000 dosya / versiyon; 25 MiB / dosya** — *workers/platform/limits*
- İstek gövdesi (CDN planına bağlı): Free **100 MB** — *workers/platform/limits*
- D1 Free: **5 milyon satır okuma/gün**, **100.000 satır yazma/gün**, **5 GB toplam depolama**, **hesap başına 10 DB**, **DB başına 500 MB**, günlük reset 00:00 UTC; **1 Eylül 2026'dan itibaren günlük limitler uygulanmaya başladı** (email uyarı + sorgu hatası) — *d1/platform/pricing + d1/platform/limits + changelog 2026-09-01*
- D1 DB dağılımı: DB başına tabloları **indeksli** tutmak tüm row-read'kelom değerini düşürür; `batch()` ile ilişkili insert birleştirme tavsiye eder — *d1/platform/pricing FAQ*
- R2 Free: **10 GB-ay depolama**, **1 M Class A/ay**, **10 M Class B/ay**, egress ücretsiz — *workers/platform/pricing (R2 bölümü)*

**Mimari sonuç:** Byte'la GASAIp büyük analytics'te Free plan rafiyonluğu:
- SDK verisi **batch + sendBeacon** ile düşük istek sayısı hedeflenmeli (100k/gün API çağrısı)
- Dashboard veri: TanStack Query önbellek + D1 satır okuma optimizasyonu (eskianalitik 15 dk cache, index'ler)
- R2'ye yalnızca 90 gün+ ham satırların NDJSON/CSV snapshot'ı export'u için (v2)

## 4. Sistem Mimarisi (önerilen v1)

```
                        ┌──────────────────────────┐
  Ziyaretçi sitesi ─▶  /sdk.js  (Statik dosya, cacheable, 4 KB~) ─▶ web-vitals  ─▶
                        │  batch queue + sendBeacon             │
                        ▼                                       ▼
              https://api.<zone>/collect  (Worker — Hono)
                          │  doğrulama + origin check + dedup
                          ▼
                     Cloudflare D1  (events, sessions, sites)
                          ▲
  Yönetici tarayyıcısı ─▶ https://app.<zone>/  (React SPA, TanStack Query)
                          ▲
  ──────────────  Landing + Docs (aynı SPA) ───────── Dungeons
```

**D1 şema taslağı (v1)**
```sql
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE NOT NULL,   -- SDK'da kullanılan site key
  name TEXT NOT NULL,
  origin TEXT NOT NULL,             -- CORS/origin doğrulaması
  created_at INTEGER NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  ts INTEGER NOT NULL,              -- epoch ms
  metric TEXT NOT NULL,             -- LCP|INP|CLS|FCP|TTFB|custom
  value REAL,
  rating TEXT,                       -- good|needs-improvement|poor
  path TEXT, country TEXT, ua TEXT,
  session_id TEXT, metric_id TEXT,  -- web-vitals "id" (dedup)
  attribution TEXT                  -- JSON (web-vitals attribution build)
);
CREATE INDEX idx_events_site_ts ON events(site_id, ts);
CREATE INDEX idx_events_metric ON events(site_id, metric, ts);
CREATE TABLE session_cache (      -- opsiyonel session-heuristik
  hash TEXT PRIMARY KEY, site_id INTEGER, ts INTEGER
);
```
> Not: row-write ekonomisi için gerçek shemada olası ayrışma (aylık tablo bölücü, event klasörüne R2 snapshot) v2'de kararlaştırılacak.

## 5. Riskler

1. Kaynak kod yeri belirsiz: canlı site erişilemez; bu workspace kodsunuz — **kullanıcı kararı bekleniyor**: kod başka yerde mi, yoksa buradan sıfırdan mı (sisre) mi başlıyor?
2. D1 Free 5M satır okuma / 100k yazma günlük tavanlar: gerçek trafik Büyümeyle v2 tasarımda alel分析方法 gerekir.
3. `.opencode/opencode.json` token'ları çalışır durumda — bu dosya commit'lenmemeli (yardımiodun .gitignore koruması yapıldı; GitHub'a push etmeden önce token'ları refresh/topluca rotation önerilir).
4. Figma referansı Webflow Community dosyası — azaltılmış güçleştirme değil, saf **vizyon/board** gibi değerlendirilmeli; tasarım sistem olarak `renkler.txt` paleti ile ekrana önce DYNAMIC kendisi oturmalı.
