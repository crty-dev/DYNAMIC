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
| Ink        | `#010C18` | Ana zemin, koyu tema arka planı            |
| Navy       | `#0A3261` | Derin vurgular, grafik zeminleri           |
| Azure      | `#1F92EB` | Ara vurgu                                  |
| Blue       | `#1D72FC` | Gradyanın bitişi, birincil aksiyon         |
| Blue 2     | `#1E82F4` | Yardımcı mavi                              |
| Cyan       | `#20A7DF` | Gradyanın ortası                           |
| Sky        | `#23BCD5` | Açık vurgular                              |
| Teal       | `#24D2CD` | Gradyanın başlangıcı, başarı/pozitif veri  |
| Deep       | `#0F515D` | Koyu teal gölgeler                         |
| Text       | `#EAF4FF` | Ana metin                                  |
| Muted      | `rgba(212,228,244,.63)` | İkincil metin               |

Marka gradyanı sabittir: `#24D2CD → #20A7DF → #1D72FC` (soldan sağa).
Gradyan yönü değiştirilmez, logo yeniden renklendirilmez.

### Tipografi

| Rol             | Font                 | Ağırlıklar       | Lisans   |
| --------------- | -------------------- | ---------------- | -------- |
| Başlık / arayüz | Montserrat           | 400–800          | SIL OFL  |
| Kod / etiket    | JetBrains Mono       | 400, 500         | SIL OFL  |

Font dosyaları ve OFL lisans metinleri `assets/brand/fonts/` altındadır. Web
sitesi Montserrat ve JetBrains Mono'yu Google Fonts üzerinden yükler
(`index.html`); raster üretimi ise yerel TTF dosyalarını kullanır. Tipografik
yedekler: `Helvetica Neue, Arial, sans-serif` ve
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

Landing sayfası marka dosyalarını doğrudan içe aktarır
(`src/landing/LandingPage.tsx`): yatay logo navigasyon ve footer'da, ürün
ikonları kartlarda ve SDK bölümünde kullanılır. Hero'daki Console görünümü
(`DashMock.tsx`) raster bir ekran görüntüsü değil, marka renkleriyle canlı
HTML/SVG olarak üretilir. Favicon, Apple touch icon, manifest ve Open Graph
görseli `index.html` üzerinden `public/` dosyalarına bağlanır.

**Not:** `.opencode/` klasörü yerel MCP yapılandırması içerdiğinden (canlı
API anahtarları) repoya girmemesi için `.gitignore` kurallarına dahildir.
