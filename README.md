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
- Marka varlıkları: `assets/brand/` (aşağıya bakın)

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

## Console (dashboard)

`/dashboard` artık gerçek bir konsoldur: Flatlogic "react-dashboard" şablonunun
m düzeni (sabit sidebar + sticky header + widget ızgarası) DYNAMIC paletiyle
ve **canlı D1 verisiyle** yeniden yazıldı. Eski CRA/Bootstrap/Express
çalıştırması, `sequelize` ve `sqlite` bağımlılıkları taşınmadı — proje
Vite + React 19 + TypeScript + Tailwind v4 + Cloudflare Workers üzerinde kalır.

| Rota | İçerik |
| --- | --- |
| `/dashboard` | KPI'lar (ziyaretçi, sayfa görüntüleme, event, ort. LCP), trafik grafiği, Web Vitals dağılımı, en çok ziyaret edilen sayfalar/ülkeler, canlı event akışı |
| `/dashboard/analytics` | Ziyaretçi + sayfa görüntüleme trendi, sayfa ve ülke tabloları |
| `/dashboard/rum` | LCP/INP/CLS/FCP/TTFB skorları, rating dağılımı, en yavaş sayfalar |
| `/dashboard/events` | Ham event akışı (yol, metrik ve ülkeye göre arama) |

Veri kaynağı yeni read-only uç: `GET /api/stats?range=24h|7d|30d`
(`?site=<public id|hostname>` opsiyonel). Site, `/api/collect` ile aynı şekilde
Origin/Referer'dan çözülür; **GET hiçbir site kaydı oluşturmaz** — bilinmeyen
origin boş bir payload döner ve konsol boş durumu gösterir.

`src/console/` altındaki konsol, `recharts` içerdiği için landing'den
`React.lazy` ile ayrı chunk olarak yüklenir; ziyaretçi sayfa konsolun
paket maliyetini ödemez. Konsol her 30 saniyede kendini yeniler.

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
sitesi fontları kendi sunucusundan `@font-face` ile yükler (`src/index.css`);
üçüncü taraf font isteği yoktur. Raster üretimi de aynı yerel TTF dosyalarını
kullanır. Tipografik yedekler: `Helvetica Neue, Arial, sans-serif` ve
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

### Animasyon

Hero grafiğinin çizilmesi ve fareyle gezilebilen tooltip, dashboard parallax'ı,
scroll reveal, sonsuz teknoloji şeridi, kart hover'ları, kod typewriter'ı ve CTA
reveal'ı CSS + React + IntersectionObserver ile yapılır. Framer Motion, GSAP
veya benzeri bir animasyon runtime'ı eklenmedi; bu, paket boyutunu ve Free plan
CPU bütçesini korur. Ağır görsel efektler (halftone footer, data rain) kendi
2D canvas'larını çizer ve `prefers-reduced-motion` ile durur.

## Cloudinary (medya)

Cloudinary hesabı: cloud `di9c12gg6`, upload key `657115753521274`. API secret
**depoya girmez**; `.dev.vars` (git-ignored) ve Worker secret store'unda tutulur.

```bash
# 1) .dev.vars içine gerçek secret'ı yazın
#    CLOUDINARY_URL=cloudinary://657115753521274:<API_SECRET>@di9c12gg6
cp .dev.vars.example .dev.vars

# 2) hesabı doğrula + unsigned upload preset'ini oluştur
npm run cloudinary:setup

# 3) marka görsellerini Cloudinary'ye yükle (isteğe bağlı)
npm run cloudinary:upload
```

Üretimde secret'lar Worker'a yazılır:

```bash
npx wrangler secret put CLOUDINARY_URL
npx wrangler secret put MEDIA_UPLOAD_TOKEN
```

`MEDIA_UPLOAD_TOKEN` rastgele bir bearer token'dır ve yükleme uçlarını korur
(`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).

| Uç | Yetki | Açıklama |
| --- | --- | --- |
| `GET /api/media/config` | herkese açık | Cloud adı, upload key, teslim tabanı. Secret asla dönmez. |
| `POST /api/media/signature` | `Authorization: Bearer <MEDIA_UPLOAD_TOKEN>` | İmzalı yükleme parametreleri (doğrudan tarayıcı yüklemesi). |
| `POST /api/media/upload` | `Authorization: Bearer <MEDIA_UPLOAD_TOKEN>` | Sunucu üzerinden proxy yükleme; gövde 10 MB sınırında, yalnızca `image/*`. |

İstemci yardımcıları `src/lib/cloudinary.ts` içindedir
(`cloudinaryUrl()`, `fetchMediaConfig()`, `requestUploadSignature()`).
Klasörler: `dynamic/brand`, `dynamic/uploads`, `dynamic/social`.

**Not:** `.opencode/` klasörü yerel MCP yapılandırması içerdiğinden (canlı
API anahtarları) repoya girmemesi için `.gitignore` kurallarına dahildir.
