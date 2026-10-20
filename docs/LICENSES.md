# Bağımlılık Lisansları

Bu tablo `npm run license:audit` komutuyla üretilir ve elle güncellenmez.
Amaç: MIT lisansıyla dağıtılan projede **hiçbir uyumsuz lisansın** girmesini
engellemek.

```
npm run license:audit
```

## Özet

28 doğrudan bağımlılık · 0 uyumsuz · 1 zayıf copyleft (MPL-2.0, yalnızca
build-time, değiştirilmeden kullanılıyor).

| Paket | Sürüm | Lisans |
| --- | --- | --- |
| @cloudflare/workers-types | 5.20261019.1 | MIT OR Apache-2.0 |
| @cloudinary/react | 1.14.4 | MIT |
| @cloudinary/url-gen | 1.22.0 | MIT |
| @resvg/resvg-js | 2.6.2 | MPL-2.0 (build-time) |
| @tailwindcss/vite | 4.3.3 | MIT |
| @tanstack/react-query | 5.104.4 | MIT |
| @types/node | 26.6.5 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| fontkit | 2.0.4 | MIT |
| hono | 4.13.1 | MIT |
| lucide-react | 1.59.0 | ISC |
| oxlint | 1.89.0 | MIT |
| png-to-ico | 3.0.2 | MIT |
| react / react-dom | 19.3.1 | MIT |
| react-router | 8.5.0 | MIT |
| recharts | 3.10.1 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| tailwindcss | 4.3.3 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vite | 8.3.4 | MIT |
| web-vitals | 6.2.3 | Apache-2.0 |
| wrangler | 4.151.2 | MIT OR Apache-2.0 |
| zod | 4.6.7 | MIT |

## Uyumluluk notları

- **MIT / ISC / BSD / Apache-2.0** → projenin MIT lisansıyla uyumludur.
  Apache-2.0 ayrıca patent lisansı verir; uyarı ve lisans metni zorunludur
  (paketler kendi metinlerini taşır).
- **MPL-2.0 (`@resvg/resvg-js`)** → dosya seviyesinde copyleft. Bu paket
  yalnızca `npm run brand` (marka raster üretimi) sırasında, **değiştirilmeden**
  çalışır; üretilen site paketine girmez ve dağıtılan çıktıyı etkilemez.
  MPL-2.0'ın "Mozilla Public License" metni paketin kendi deposunda durur.
- **Çift lisans ("MIT OR Apache-2.0")** → dilerseniz MIT, dilerseniz Apache-2.0
  şartlarını seçebilirsiniz; ikisi de uyumludur.
- **Fontlar** (Montserrat, JetBrains Mono) → SIL Open Font License 1.1.
  Lisans metinleri `public/fonts/` ve `assets/brand/fonts/` altında dağıtılır.

## Üçüncü taraf kod

Proje içinde kopyalanan/uyarlanan üçüncü taraf kod için [NOTICE](../NOTICE)
dosyasına bakın:

- **Flatlogic "react-dashboard"** (MIT) — konsol düzeni ve referans landing.
- **Google web-vitals** (Apache-2.0) — SDK içine paketlenmiş.
