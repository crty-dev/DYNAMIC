# DYNAMIC

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](docs/DEPLOYMENT.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

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
- Dağıtım, self-hosting, Free limitleri ve geri alma: `docs/DEPLOYMENT.md`
- Gizlilik / KVKK değerlendirmesi: `docs/PRIVACY.md`
- Bağımlılık lisansları: `docs/LICENSES.md`
- Marka varlıkları: `assets/brand/` (aşağıya bakın)

## Kurulum

```bash
git clone https://github.com/crty-dev/DYNAMIC.git
cd DYNAMIC
npm install
cp .dev.vars.example .dev.vars     # secret'ları doldurun
npm run db:migrate:local            # yerel D1 şeması
npm run dev                         # http://localhost:5173
```

Ücretli bir Cloudflare hesabı gerekmez. Ayrıntılar ve üretim dağıtımı için
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu (SDK dahil). |
| `npm run build` | Üretim çıktısı (`dist/`). |
| `npm run typecheck` | `tsc --noEmit` (uygulama + Worker). |
| `npm run lint` | oxlint. |
| `npm test` | 24 test (SDK, API, build) — gerçek `wrangler dev` + yerel D1. |
| `npm run license:audit` | Bağımlılık lisans tablosu. |
| `npm run deploy` | Cloudflare'a yayınlar. |

## Cloudflare Free limitleri

| Kaynak | Free limit | DYNAMIC'in kullanımı |
| --- | --- | --- |
| Workers istekleri | 100.000 / gün | SDK sayfa başına 1 istek (5 sn'de bir toplu gönderim). |
| D1 satır okuma | 5M / gün | Her sorgu `site_id` + zaman aralığı ile sınırlı; p75 taraması 20.000 örnekle sınırlı; raporlar önbelleklenir. |
| D1 satır yazma | 100.000 / gün | 1 event = 1 satır; site başına günlük kota 25.000; toplam site sayısı `MAX_SITES` ile sınırlı. |
| D1 depolama | 5 GB | 30 günlük saklama. |
| Static Assets | ücretsiz | `dist/` ≈ 900 KB. |
| Cron | 5 | 1 (günlük retention temizliği). |
| R2 | 10 GB | **Kullanılmıyor** (medya Cloudinary'de). |

Tablo ve self-hosting adımları: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**Ortam değişkenleri**

| Değişken | Nerede | Açıklama |
| --- | --- | --- |
| `ADMIN_API_KEY` | Worker secret | `/api/admin/*` bearer token'ı (zorunlu). |
| `MEDIA_UPLOAD_TOKEN` | Worker secret | Medya yükleme uçlarının token'ı. |
| `CLOUDINARY_URL` | Worker secret | `cloudinary://<key>:<secret>@<cloud>`. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_UPLOAD_KEY` | `wrangler.jsonc` → `vars` | Public değerler. |
| `MAX_SITES` | `wrangler.jsonc` → `vars` | Self-serve site sayısı sınırı (varsayılan 500). |
| `VITE_CLOUDINARY_DISABLED` | build ortamı | `1` ise görseller kendi origin'inden (yerel WebP) servis edilir — **fork'lar için önerilir**. |
| `VITE_CLOUDINARY_CLOUD` | build ortamı | Fork'un kendi Cloudinary cloud adı. |

## DYNAMIC Console (uygulama)

İki ayrı deneyim, **tek Worker**:

| Deneyim | Adres | İçerik |
| --- | --- | --- |
| Pazarlama | `https://dynamic.crty-dev.com` | Landing, marka, açık konsol |
| Uygulama | `https://app.dynamic.crty-dev.com` | Giriş, projeler, DNS doğrulama, site özeti |

### Kimlik doğrulama (Better Auth + D1)

- E-posta + şifre ile kayıt ve giriş. Parola hash'leme ve oturum imzalama
  Better Auth'a bırakıldı — elle kriptografi yok.
- **Doğrulanmamış e-posta ile giriş engellenir** (`403 EMAIL_NOT_VERIFIED`).
- Doğrulama ve şifre sıfırlama bağlantıları 1 saat geçerli; sıfırlama
  token'ı **tek kullanımlık** (yeniden kullanımı reddedilir).
- Oturumlar `HttpOnly` + `Secure` + `SameSite=Lax` çerezle, 7 gün geçerli.
- Şifre sıfırlandığında diğer oturumlar iptal edilir.
- Turnstile **opsiyonel**: `TURNSTILE_SECRET_KEY` varsa kayıt/giriş/sıfırlama
  istekleri bot korumasından geçer.
- E-posta gönderimi adaptörle yapılır (`MAIL_PROVIDER_URL` +
  `MAIL_PROVIDER_TOKEN`). Sağlayıcı yoksa üretimde e-posta gönderilmez ve
  istek başarısız olmaz; geliştirmede mailler `/api/dev/mailbox` outbox'ına
  düşer (yalnızca `DEV_MODE=1`).

### Web sitesi projeleri ve DNS doğrulama

- Her kullanıcı kendi projelerini yönetir; **her sorgu `user_id` ile sınırlıdır**,
  istemci hiçbir zaman sahip id göndermez.
- Alan adı sunucuda normalize edilir (IDN → punycode); IP adresleri, tek
  etiketli alan adları ve geçersiz uzantılar reddedilir.
- Her proje için kriptografik rastgele 48 haneli doğrulama token'ı üretilir.
- Yayınlanacak kayıt: **TXT** `_dynamic-verification.<hostname>` →
  `dynamic-verification=<token>`.
- DNS **sunucu tarafında**, Workers'ta çalışan DoH (Cloudflare 1.1.1.1) ile
  sorgulanır; istemci "doğrulanmış" diyemez.
- Durum makinesi: `pending → verifying → verified`; hata durumları
  (kayıt yok, hatalı değer, DNS hatası) geri dönülebilir ve gerekçesi
  kullanıcıya gösterilir.
- Doğrulama denemeleri sınırlıdır: **10 saniye aralık, saatte 20 deneme**;
  istemci ~60 saniyelik bir pencereyle yoklar ve elle "tekrar dene" sunar.
- Bir alan adı yalnızca bir projeye bağlanabilir; doğrulanmış alan adı başka
  hesap tarafından alınamaz (`409 hostname_taken`).
- Silme açık onay ister (`?confirm=<id>`) ve o sitenin tüm event/oturum
  kayıtlarını da siler (KVKK unutma hakkı).

### Yerel geliştirme

```bash
npm run dev        # pazarlama sitesi  → http://localhost:5173
npm run dev:app    # uygulama          → http://localhost:5174
npx wrangler dev  # API + statik       → http://127.0.0.1:8787
```

Uygulama `VITE_API_ORIGIN` ile API adresini bilir (yerelde
`http://127.0.0.1:8787`), üretimde aynı origin olduğu için göreli yol yeter.

## Açık kaynak

- Lisans: [MIT](LICENSE) — ticari kullanım, değiştirme ve dağıtım serbest.
- Katkı: [CONTRIBUTING.md](CONTRIBUTING.md) · Güvenlik: [SECURITY.md](SECURITY.md) ·
  Davranış kuralları: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ·
  Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md)
- Üçüncü taraf bildirimler: [NOTICE](NOTICE) · lisans denetimi:
  `npm run license:audit` (28 bağımlılık, 0 uyumsuz).
- Gizlilik/KVKK: [docs/PRIVACY.md](docs/PRIVACY.md) — çerez yok, IP saklanmaz,
  kişisel veri toplanmaz; veri dışa aktarma ve silme uçları mevcuttur.

**Kredi ve atıf:** konsol düzeni Flatlogic "react-dashboard" (MIT) şablonundan
uyarlanmıştır; SDK Google `web-vitals` (Apache-2.0) paketini içerir; fontlar
SIL OFL'dir. Ayrıntılar [NOTICE](NOTICE) dosyasında.

## Collect API (v1)

`POST /api/collect` SDK event batch'ini doğrular ve D1'e yazar. CORS yalnızca
isteğin `Origin` değerini yansıtır. Site; `site` alanındaki public anahtar veya
hostname ile, yoksa isteğin Origin/Referer değeriyle çözülür. Yeni bir
origin'den gelen ilk geçerli yazma siteyi otomatik oluşturur
(`0002_site_origin_unique.sql`).

```json
{
  "site": "example.com",
  "events": [
    {
      "type": "pageview",
      "path": "/pricing?utm_source=newsletter",
      "ts": 1792500000000,
      "session": "s_anon"
    },
    {
      "type": "vital",
      "metric": "LCP",
      "value": 1234.5,
      "rating": "good",
      "id": "v1-1792500000000",
      "path": "/pricing"
    },
    {
      "type": "event",
      "name": "signup",
      "path": "/welcome",
      "props": { "plan": "free" }
    }
  ]
}
```

- `events` yerine doğrudan bir `Event[]` dizisi de gönderilebilir; bu durumda
  site Origin/Referer'dan çözülür.
- Limitler: 64 event, 128 KB gövde, 4 KB attribution. `path` yalnızca pathname
  olarak saklanır (query/fragment atılır). `ua` ve `country` istemciden değil,
  `User-Agent` ve `cf-ipcountry` başlıklarından alınır.
- Yanıtlar: `202 { ok, accepted, site, created? }`;
  `400 invalid_payload / site_required / invalid_json`;
  `403 origin_mismatch / invalid_origin`;
  `413 batch_too_large / payload_too_large / attribution_too_large`;
  `500 storage_error`.

```bash
curl -X POST http://localhost:8787/api/collect \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{"events":[{"type":"pageview","path":"/"}]}'
```

Yerel API için: `npm run db:migrate:local`, ardından `npm run build` ve
`npx wrangler dev --local`. `npm run dev` yalnızca Vite arayüzünü çalıştırır.
Admin/auth ve rate-limit koruması sıradaki adımlardır.

---

## SDK

`/js/dynamic.js` tek dosyalık, async ve bağımlılıksız bir snippet'tir
(Google `web-vitals` paketlenmiş olarak gelir, çalışma anında üçüncü taraf
isteği yok). Toplam **6.3 KB gzip**.

```html
<script
  async
  src="https://dynamic.crty-dev.com/js/dynamic.js"
  data-site="site_xxxxxxxxxxxxxxxx"
></script>
```

| API | Açıklama |
| --- | --- |
| `dynamic.track(name, props?, value?)` | Özel event (dönüşüm de olabilir). |
| `dynamic.page()` | Elle sayfa görüntüleme (SPA gezinmesi otomatik gelir). |
| `dynamic.flush()` | Kuyruğu hemen gönderir. |
| `dynamic.consent.grant()` / `.deny()` | Açık izin / opt-out. |
| `dynamic.optIn()` / `dynamic.optOut()` | `consent` için kısa yol. |
| `dynamic.consent.status()` | `granted` \| `denied` \| `unknown`. |

Davranış:

- **SPA desteği:** `pushState` / `replaceState` / `popstate` izlenir, her
  gezinmede yeni bir sayfa görüntülemesi gönderilir.
- **Toplu gönderim:** varsayılan 32 event / istek, 5 saniyede bir otomatik
  boşaltma; sayfa kapanırken `sendBeacon` kullanılır.
- **Sınırlı retry:** yalnızca ağ hatası/5xx'te, en fazla 2 deneme; 4xx'te
  batch düşürülür (sonsuz tekrar yok).
- **Boyut sınırı:** 64 event / istek, 128 KB gövde, event başına 8 prop.
- **Kişisel veri yok:** form/input değeri veya tuş vuruşu okunmaz; event
  propları kişisel veri anahtarlarına karşı filtrelenir (e-posta, şifre, telefon,
  adres, token, kart, IP, koordinat …).
- **Çerez yok:** oturum id `sessionStorage`'da tutulur ve 30 dakika hareketsizlik
  sonrası yenilenir. `Do Not Track` açıksa izin verilene kadar toplama yapılmaz.

Kaynak: `src/sdk/dynamic.ts` → `npm run build:sdk` → `public/js/dynamic.js`.

---

## Rapor API'leri

Analytics ve RUM uçları **okuma** içindir; ingest'ten tamamen ayrıdır ve hiçbiri
veri yazmaz. Tüm sorgular `site_id` + zaman aralığı ile sınırlıdır.

**İzolasyon:** bir site anahtarı yalnızca kendi origin'ini açar. Başka bir origin
(veya origin'siz bir istek) `?site=` ile başka bir sitenin verisini okumaya
çalışırsa `403 origin_mismatch` alır. Site anahtarı olmadan istekler kendi
origin'ine bağlıdır.

**Önbellek:** ağır raporlar (`/api/analytics/summary` 60 sn, `/api/rum/summary`
5 dk) Worker Cache API ile veri merkezi başına önbelleğe alınır — konsol her
dakika yoklasa bile D1 satır okuması patlamaz. Taze veri için `?fresh=1` ekleyin.

### Analytics

| Uç | Açıklama |
| --- | --- |
| `GET /api/analytics/summary?range=24h\|7d\|30d\|90d` | Toplamlar, zaman serisi, en çok ziyaret edilen sayfalar, referrer'lar, UTM kampanyaları, cihaz/tarayıcı dağılımı, dönüşümler, ülkeler ve 30 dakikalık gerçek zamanlı görünüm. |
| `GET /api/analytics/timeseries?range=` | Saatlik/günlük ziyaretçi + sayfa görüntüleme serisi. |
| `GET /api/analytics/pages?range=&limit=` | Sayfa kırılımı. |
| `GET /api/analytics/referrers?range=` | Referrer ve UTM kampanyası kırılımı. |
| `GET /api/analytics/devices?range=` | Cihaz / tarayıcı / işletim sistemi kırılımı. |
| `GET /api/analytics/events?range=&name=` | Özel event kırılımı. |
| `GET /api/analytics/goals?range=` | Dönüşüm (goal) kırılımı + tanımlar. |
| `GET /api/analytics/sessions?range=` | Oturum sayısı, sayfa/oturum, bounce oranı. |
| `GET /api/analytics/realtime` | Son 30 dakika (maliyeti sınırlı sorgu). |

### RUM

| Uç | Açıklama |
| --- | --- |
| `GET /api/rum/summary?range=` | LCP/INP/CLS/FCP/TTFB için örnek sayısı, ortalama, p50, **p75** ve rating dağılımı. |
| `GET /api/rum/timeseries?range=&metric=` | Günlük p75 serisi. |
| `GET /api/rum/pages?range=&metric=` | Metrik bazlı en yavaş sayfalar. |
| `GET /api/rum/devices?range=&metric=` | Metrik bazlı cihaz kırılımı. |

p75 **SQL window function** ile hesaplanır (satır transferi yok). Örneklem
sayısı 20'nin altındaysa p75 `null` döner ve kart "yeterli veri yok" der —
uydurma istatistik üretilmez. Tüm değerler **gerçek kullanıcı verisidir**;
lab (laboratuvar) verisi karıştırılmaz.

### Admin API

`/api/admin/*` uçları herkese açık ingest'ten ayrıdır ve
`Authorization: Bearer <ADMIN_API_KEY>` ile korunur.

| Uç | Açıklama |
| --- | --- |
| `GET /api/admin/sites` | Site listesi (olay/oturum sayılarıyla). |
| `POST /api/admin/sites` | Site oluşturur (site key döner). |
| `GET/PATCH /api/admin/sites/:id` | Site detayı; saklama süresi ve günlük kota ayarlanır. |
| `GET/POST /api/admin/sites/:id/goals` | Dönüşüm tanımı (event adı veya path). |
| `DELETE /api/admin/sites/:id/goals/:goal` | Dönüşüm siler. |
| `POST /api/admin/sites/:id/purge` | Saklama süresinden eski verileri siler. |

---

## Console (dashboard)

`/dashboard` artık gerçek bir konsoldur: Flatlogic "react-dashboard" şablonunun
m düzeni (sabit sidebar + sticky header + widget ızgarası) DYNAMIC paletiyle
ve **canlı D1 verisiyle** yeniden yazıldı. Eski CRA/Bootstrap/Express
çalıştırması, `sequelize` ve `sqlite` bağımlılıkları taşınmadı — proje
Vite + React 19 + TypeScript + Tailwind v4 + Cloudflare Workers üzerinde kalır.

| Rota | İçerik |
| --- | --- |
| `/dashboard` | KPI'lar (ziyaretçi, sayfa görüntüleme, event, dönüşüm), trafik grafiği, gerçek zamanlı görünüm, en çok ziyaret edilen sayfalar, cihaz dağılımı, referrer'lar, dönüşümler |
| `/dashboard/analytics` | Ziyaretçi + sayfa görüntüleme trendi, referrer/UTM kampanyası, ülke ve özel event kırılımları |
| `/dashboard/rum` | LCP/INP/CLS/FCP/TTFB için p50/p75/ortalama, rating dağılımı, en yavaş sayfalar (yetersiz veride p75 boş kalır) |
| `/dashboard/events` | Özel event kırılımı (ad ile arama) |
| `/dashboard/pages` | Sayfa ve ülke kırılımları |
| `/dashboard/settings` | Site bilgileri ve SDK kurulum snippet'i |

Veri kaynağı read-only uçlar: `GET /api/analytics/summary` ve
`GET /api/rum/summary` (`?range=24h|7d|30d|90d`, `?site=<public id|hostname>`
opsiyonel). Site, `/api/collect` ile aynı şekilde Origin/Referer'dan çözülür;
**GET hiçbir site kaydı oluşturmaz** — bilinmeyen origin boş bir payload
döner ve konsol boş durumu gösterir.

`src/console/` altındaki konsol, `recharts` içerdiği için landing'den
`React.lazy` ile ayrı chunk olarak yüklenir; ziyaretçi sayfa konsolun
paket maliyetini ödemez. Konsol her 30 saniyede kendini yeniler.

---

## Free plan koruması

- **Batch:** SDK varsayılan 32 event gönderir; Worker en fazla 64 event kabul
  eder. İstek başına D1 sorgu sayısı sabittir.
- **Günlük kota:** her sitenin `daily_event_limit` değeri vardır (varsayılan
  25.000). Kota dolduğunda ingest `429 quota_exceeded` döner ve **olay yazılmaz**;
  başarı gibi gösterilmez.
- **Sayaç:** günlük olay sayısı `sites` tablosunda tutulur, böylece kota
  kontrolü için ek bir sorgu yapılmaz.
- **Saklama:** `retention_days` (varsayılan 30 gün) ve günlük cron (`0 3 * * *`)
  eski verileri siler. Manuel silme: `POST /api/admin/sites/:id/purge`.
- **Satır okuma ekonomisi:** `sessions` tablosu oturum başına tek satır
  tutar; ziyaretçi/oturum sayıları `COUNT(DISTINCT)` taraması yerine bu küçük
  tablodan okunur. Zaman serisi ve kırılımlar `(site_id, ts)` ve
  `(site_id, metric, ts)` indekslerini kullanır; her sorgu site + zaman
  aralığı ile sınırlıdır.
- **Sınır hataları:** kota → `429`, geçersiz gövde → `400`, çok büyük gövde →
  `413`, yazma hatası → `500 { accepted: 0 }`. Hiçbir zaman "başarılı" denip
  yazılmayan olay gösterilmez.
- **Ücretli servise geçiş yok:** tüm altyapı Workers + D1 + statik varlıklar
  ile sınırlıdır.

---

## Testler

```bash
npm test     # build:sdk + node --test (24 test)
```

| Dosya | Kapsam |
| --- | --- |
| `tests/sdk.test.mjs` | SDK: sayfa görüntüleme, referrer/UTM, oturum id, prop filtresi (kişisel veri), geçersiz event adı, batch, opt-out, DNT izni, oturum yeniden kullanımı. |
| `tests/api.test.mjs` | Bozuk payload, geçersiz JSON, batch limiti, kayıt + kabul edilen sayısı, vital dedup, analytics raporu, site izolasyonu, origin uyuşmazlığı, boş veri, yetersiz veride p75'in boş kalması, admin koruması, goal/dönüşüm takibi, kota hatası, retention purge. |
| `tests/build.test.mjs` | Üretim build'i: HTML kabuğu, SDK'nın varlığı ve boyutu, giriş paketinin boyutu. |

API testleri gerçek `wrangler dev` + yerel D1 üzerinde çalışır (Miniflare),
yani mock değil gerçek HTTP + gerçek SQL yolu test edilir.

---

## Marka

DYNAMIC marka ailesi tek bir geometrik D sembolünden türetilir. Ana marka,
DYNAMIC Analytics, DYNAMIC RUM, DYNAMIC SDK ve DYNAMIC Console aynı çizgi
kalınlığını, boşluk kurallarını ve gradyanı kullanır. Ürün glifleri sembolün
içindeki boşlukta (counter) yer alır: Analytics = grafik/veri, RUM = performans
dalgası, SDK = kod/entegrasyon, Console = düz ana sembol.

### Renkler

| Token      | Hex       | Kullanım                                   |
| ---------- | --------- | ------------------------------------------ |
| Ink        | `#0B1D2F` | Ana zemin, koyu tema arka planı            |
| Blue       | `#1D70FD` | Gradyanın bitişi, birincil aksiyon         |
| Blue 2     | `#1E87F1` | Hover ve ikincil aksiyon                   |
| Blue 3     | `#1F97E8` | Grafik serileri                            |
| Cyan       | `#20A9DE` | Gradyanın ortası                           |
| Cyan 2     | `#22BAD6` | Açık vurgular, yardımcı veri               |
| Teal       | `#23D8CA` | Gradyanın başlangıcı, başarı/pozitif veri  |
| Deep       | `#0F515D` | Koyu teal gölgeler (destek rengi)          |
| Text       | `#EAF4FF` | Ana metin                                  |
| Muted      | `#A9BFD2` | İkincil metin                              |
| Faint      | `#7F99AD` | Etiket ve üçüncül metin                    |

Marka gradyanı sabittir: `#23D8CA → #20A9DE → #1D70FD` (soldan sağa).
Gradyan yönü değiştirilmez, logo yeniden renklendirilmez.

### Tipografi

| Rol             | Font                 | Ağırlıklar       | Lisans   |
| --------------- | -------------------- | ---------------- | -------- |
| Başlık / arayüz | Montserrat           | 500, 600, 700    | SIL OFL  |
| Kod / etiket    | JetBrains Mono       | 400              | SIL OFL  |

Font dosyaları ve OFL lisans metinleri `assets/brand/fonts/` altındadır. Web
sitesi, aynı TTF'lerden **Latin alt kümeli woff2** üretimini kullanır
(`public/fonts/*.woff2`, ≈13 KB each; OFL metinleri de `public/fonts/` içindedir)
ve `@font-face` + `font-display: swap` ile kendi sunucusundan yükler — üçüncü
taraf font isteği yoktur. Above-the-fold iki font `index.html` içinde
`preload` edilir. Raster üretimi de aynı yerel TTF dosyalarını kullanır.
Tipografik yedekler: `Helvetica Neue, Arial, sans-serif` ve
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

### Dosya yapısı

```
assets/brand/
├── fonts/                          Montserrat + JetBrains Mono TTF ve OFL metinleri
├── svg/                            Tek kaynak (master) SVG'ler
│   ├── dynamic-symbol*.svg         Sembol: renkli, koyu zemin, açık zemin
│   ├── dynamic-logo-horizontal-*   Yatay logo: koyu / açık zemin
│   ├── products/                   analytics|rum|sdk|console icon + yatay logo
│   └── banners/                    og-dynamic|analytics|rum|sdk, social-cover, announce
└── raster/                         SVG'lerden üretilen PNG türevleri
    ├── app/                        icon 192/512, maskable, apple-touch 180
    ├── banners/                    1200×630 OG'ler, 1500×500 kapak, 1600×900 duyuru
    ├── favicons/                   favicon 16/32/48 + tile SVG'leri
    ├── preview/                    logo ve sembol önizlemeleri
    └── *-icon-320.png              ürün ikonları (320 px)
```

Çalışma zamanında kullanılan kopyalar `public/` altındadır:
`favicon.ico`, `apple-touch-icon.png`, `og-dynamic.png`, `site.webmanifest`,
`brand/favicon-*.png` ve `brand/icon-192.png` / `icon-512.png`.

### Üretim

Tüm marka çıktıları tek komutla, SVG master'lardan üretilir:

```bash
npm run brand
```

`scripts/brand/build.mjs`; SVG'leri yazar, `@resvg/resvg-js` ile raster
türevlerini oluşturur, favicon'ları paketler ve `public/` kopyalarını
günceller. Metinler fontkit ile path'e çevrilir; bu yüzden raster banner'larda
font kurulu olmasına gerek yoktur. Üretilen dosyalar elle düzenlenmemelidir —
değişiklik yapılacaksa `scripts/brand/build.mjs` güncellenip komut yeniden
çalıştırılır.

Web fontları (Latin alt küme + woff2) `pyftsubset` ile üretilir:

```bash
pyftsubset assets/brand/fonts/Montserrat-Bold.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201F,U+2022,U+2026,U+2192" \
  --flavor=woff2 --output-file=public/fonts/Montserrat-Bold.woff2
```

OFL lisans metinleri `public/fonts/` altında da bulunur.

### Logo kullanım kuralları

- Koyu zeminlerde `*-on-dark`, açık zeminlerde `*-on-light` varyantı kullanılır.
- Logo çevresinde en az sembol yüksekliğinin yarısı kadar (dijitalde minimum
  24 px) boşluk bırakılır; hiçbir metin veya kenar bu alana girmez.
- Yatay logo için minimum genişlik 96 px, sembol için 24 px'tir. 24 px altında
  özel favicon/tile dosyaları kullanılır.
- Logo oranı korunarak ölçeklenir; gerilmez, döndürülmez, kırpılmaz, kontur
  eklenmez, gölge veya efektle yeniden renklendirilmez.
- Gradyan ve çizgi kalınlığı değiştirilmez. Logo desenli veya düşük kontrastlı
  bir görselin üzerine yerleştirilmez.
- Ürün logoları yalnızca kendi ürün adıyla (Analytics, RUM, SDK, Console)
  birlikte kullanılır; ürün ikonları ana DYNAMIC wordmark'ı ile birleştirilmez.
- Ana marka, ürün ailesinin şemsiye kimliğidir; ürünlerde ana sembolün
  değiştirilmiş kopyaları değil, `products/` altındaki kendi glifleri kullanılır.

### Sitede kullanım

Landing sayfası, `images/` altındaki yüksek çözünürlüklü şeffaf marka
görsellerini doğrudan içe aktarır (`src/landing/LandingPage.tsx`). Her görsel
`<picture>` ile yüklenir: birincil kaynak `.webp`, geri dönüş `.png`. DYNAMIC
sembolü navigasyonda metin wordmark'ıyla birlikte, Analytics / RUM / SDK /
Console ürün ikonları ise kartlarda kullanılır. Hero'daki Console görünümü
(`DashMock.tsx`) raster bir ekran görüntüsü değil, marka renkleriyle canlı
HTML/SVG olarak üretilir. Favicon, Apple touch icon, manifest ve Open Graph
görseli `index.html` üzerinden `public/` dosyalarına bağlanır; favicon
`images/favicon.ico` kaynağından 16/32/48 px PNG ve optimize ICO olarak
türetilmiştir.

Footer artık halftone wordmark bileşenidir
(`src/components/ui/halftone-wordmark-footer.tsx`): `dynamic` kelimesi devasa
olarak alt kenardan kırpılır ve nokta baskı (halftone) olarak basılır. Fare
noktaları itip ısıtır, tıklama şok halkası başlatır. Link sütunları, marka
satırı ve "back to top" kelimenin üstünde durur.

`src/components/ui/data-rain.tsx` ise akış alanı (flow field) parçacık
motorudur; "The signal" bandında metnin arkasında çalışır ve renklerini
`--dr-calm / --dr-mid / --dr-hot` değişkenlerinden (DYNAMIC paleti) alır.

`src/components/ui/tailwind-css-background-snippet.tsx` hero'nun gösterge
alanının arkasındaki radyal ışığı üretir (`radial-gradient`, marka mavisi →
turkuaz, düşük opaklık). Tailwind arbitrary background sınıfı olarak gelir;
hero görseli `.hero__stage` içinde `isolation: isolate` ile stack'lenir, bu
yüzden ışık dashboard mock'unun arkasında kalır ve sayfaya taşmaz.

### Performans notları (Lighthouse)

- **Statik dosyalar gerçek dosya olarak sunulur:** `robots.txt`, `llms.txt`,
  `ai-catalog.json`, `sitemap.xml` `public/` altındadır; SPA fallback onları
  HTML'e çevirmez.
- **Dokunma hedefleri ≥24 px:** footer linkleri, nav linkleri, kart linkleri ve
  konsol düğmeleri iç boşlukla büyütülür (görsel yerleşim değişmez).
- **Sadece composited animasyon:** hero grafiğinin çizimi `stroke-dashoffset`
  yerine ölçeklenen bir maske (`transform: scaleX`) ile yapılır; boyut/renk
  animasyonu yoktur.
- **Doğru boyutlu görseller:** Cloudinary teslimi ekrandaki gerçek boyuta göre
  istenir (42/76/58 px) ve `srcset` + `sizes` ile 1×/2× aday sunar; yerel
  WebP yedek yalnızca hata durumunda indirilir.
- **Font gecikmesi yok:** Latin alt kümeli woff2 (~13 KB) + `preload` +
  `font-display: swap`.
- **Kod bölme:** konsol (`/dashboard`) `React.lazy` ile ayrı chunk; landing
  sayfası grafik kütüphanesini indirmez.
- **Preconnect:** `res.cloudinary.com` için `<link rel="preconnect">` head'de.

### Animasyon

Hero grafiğinin çizilmesi ve fareyle gezilebilen tooltip, dashboard parallax'ı,
scroll reveal, sonsuz teknoloji şeridi, kart hover'ları, kod typewriter'ı ve CTA
reveal'ı CSS + React + IntersectionObserver ile yapılır. Framer Motion, GSAP
veya benzeri bir animasyon runtime'ı eklenmedi; bu, paket boyutunu ve Free plan
CPU bütçesini korur. Ağır görsel efektler (halftone footer, data rain) kendi
2D canvas'larını çizer ve `prefers-reduced-motion` ile durur.

## Cloudinary (medya)

Cloudinary hesabı: cloud `di9c12gg6`, API key adı **`dynamic-dev`**, key değeri
`657115753521274`. (Anahtarın *adı* sadece console etiketidir; kodda kullanılan
değer `657115753521274`'dir ve değişmez.) API secret **depoya girmez**; `.dev.vars`
(git-ignored) ve Worker secret store'unda tutulur.

### Bağlantı — tek komut

```bash
npm run cloudinary:link
```

Komut **sizi tek adımda** tamamlar:

1. Cloudinary API secret'ını sorar (görünmez giriş).
2. Credential'ı doğrular (yanlışsa durur, hiçbir şey yazılmaz).
3. `.dev.vars` dosyasını yazar: `CLOUDINARY_URL` + `MEDIA_UPLOAD_TOKEN`.
4. Worker secret store'una yazar: `npx wrangler secret put CLOUDINARY_URL` ve
   `npx wrangler secret put MEDIA_UPLOAD_TOKEN`.
5. Unsigned upload preset'ini oluşturur (`dynamic_uploads`, 10 MB, sadece görsel).
6. Beş marka varlığının medya kütüphanesinde olduğunu kontrol eder; eksikse
   `images/png-to-webp/` içinden yükler.

Script'i script'siz çalıştırmak isterseniz:

```bash
npm run cloudinary:link -- --secret <API_SECRET>
```

Doğrulama:

```bash
curl https://dynamic.crty-dev.com/api/media/config   # → enabled: true
```

### Manuel kurulum (link komutunu kullanmak istemezseniz)

```bash
# 1) .dev.vars içine gerçek secret'ı yazın
#    CLOUDINARY_URL=cloudinary://657115753521274:<API_SECRET>@di9c12gg6
cp .dev.vars.example .dev.vars
# 2) hesabı doğrula + unsigned upload preset'ini oluştur
npm run cloudinary:setup

# 3) marka görsellerini Cloudinary'ye yükle (isteğe bağlı)
npm run cloudinary:upload

# 4) Worker secret'larını yaz
npx wrangler secret put CLOUDINARY_URL
npx wrangler secret put MEDIA_UPLOAD_TOKEN
```

`MEDIA_UPLOAD_TOKEN` rastgele bir bearer token'dır ve yükleme uçlarını korur
(`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
Secret girilene kadar `/api/media/config` `enabled: false` döner ve yükleme
uçları `503 media_not_configured` verir — açık yükleme ucu oluşmaz.

| Uç | Yetki | Açıklama |
| --- | --- | --- |
| `GET /api/media/config` | herkese açık | Cloud adı, upload key, teslim tabanı. Secret asla dönmez. |
| `POST /api/media/signature` | `Authorization: Bearer <MEDIA_UPLOAD_TOKEN>` | İmzalı yükleme parametreleri (doğrudan tarayıcı yüklemesi). |
| `POST /api/media/upload` | `Authorization: Bearer <MEDIA_UPLOAD_TOKEN>` | Sunucu üzerinden proxy yükleme; gövde 10 MB sınırında, yalnızca `image/*`. |

İstemci yardımcıları `src/lib/cloudinary.ts` içindedir
(`cloudinaryUrl()`, `fetchMediaConfig()`, `requestUploadSignature()`).
Klasörler: `dynamic/brand`, `dynamic/uploads`, `dynamic/social`.

### Marka görselleri Cloudinary'den

Sitedeki marka işaretleri resmi Cloudinary React SDK'si ile servis edilir:

```bash
npm i @cloudinary/url-gen @cloudinary/react
```

`src/components/ui/cloudinary-image.tsx` SDK'nın `Cloudinary` (url-gen) ve
`AdvancedImage` bileşenlerini sarar: teslim `f_auto` / `q_auto` ile gelir,
istediğimiz kutuya `c_fit` ile ölçeklenir. Public id'ler
`CLOUDINARY_ASSETS` sabitinde (`src/lib/cloudinary.ts`):

| Varlık | Public id |
| --- | --- |
| Logo | `logo-removebg-preview_dnbcty` |
| Analytics | `DYNAMIC_Analytics-removebg-preview_jiuqiw` |
| RUM | `DYNAMIC_RUM-removebg-preview_xmrfrg` |
| SDK | `DYNAMIC_SDK-removebg-preview_mriaab` |
| Console | `DYNAMIC_Console-removebg-preview_machdd` |

Her görselin **yerel yedeği** de vardır: CDN'e ulaşılamazsa `onError` ile
paket içindeki PNG'ye düşer, marka işareti hiçbir koşulda kaybolmaz.

**Not:** `.opencode/` klasörü yerel MCP yapılandırması içerdiğinden (canlı
API anahtarları) repoya girmemesi için `.gitignore` kurallarına dahildir.
