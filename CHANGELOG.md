# Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini ve
[Semantic Versioning](https://semver.org/lang/tr/) sürümlemesini kullanır.

## [Unreleased]

### Eklendi
- `GET /api/analytics/*` rapor uçları: özet, zaman serisi, sayfa, referrer/UTM,
  cihaz, özel event, goal ve oturum kırılımları ile gerçek zamanlı görünüm.
- `GET /api/rum/*` uçları: LCP/INP/CLS/FCP/TTFB için ortalama, p50, p75 ve
  rating dağılımı (p75 yalnızca ≥20 örnek varsa).
- `/api/admin/*` yönetim API'si: site yönetimi, goal tanımları, saklama ve kota
  ayarları, veri dışa aktarma (`export`) ve silme (`DELETE`) uçları.
- DYNAMIC SDK (`/js/dynamic.js`, 6.3 KB gzip): async, SPA destekli, toplu
  gönderimli, izin/opt-out destekli, çerezsiz.
- Sınırlı hız limitleri (`429 rate_limited`) ve günlük event kotası
  (`429 quota_exceeded`).
- `tests/` altında 24 test (SDK, API, üretim build'i).
- Açık kaynak paketi: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `CHANGELOG.md`, `NOTICE`, `docs/PRIVACY.md`, `docs/DEPLOYMENT.md`.

### Değiştirildi
- Landing, yeni paletle (ink `#0b1d2f`, blue `#1d70fd`, cyan `#20a9de`,
  teal `#23d8ca`) ve neon efektler olmadan yeniden tasarlandı.
- Marka varlıkları Cloudinary CDN'den (WebP, `f_auto`/`q_auto`) servis edilir;
  yerel WebP yedek korunur.
- Fontlar Latin alt kümeli woff2 olarak kendi sunucumuzdan yüklenir
  (üçüncü taraf isteği yok).

### Düzeltildi
- Zaman serisi bugünün kısmi kovasını düşürüyordu; kova sayısı "pencere + mevcut
  kova" olarak düzeltildi.
- Cloudinary upload preset `context` alanı string olmalıydı; upload imzası
  alfabetik sıralı parametrelerle hesaplanmalıydı.

## [0.1.0] — 2026-10-19

### Eklendi
- Cloudflare Workers + Hono + D1 altyapısı, `POST /api/collect` ingest ucu
  (zod doğrulama, batch insert, origin/CORS doğrulaması).
- Landing sayfası ve marka varlık üretim hattı (`npm run brand`).
- Cloudinary entegrasyonu (medya teslimi + korumalı yükleme uçları).
- DYNAMIC Console (`/dashboard`) — Flatlogic "react-dashboard" düzeni
  canlı D1 verisiyle yeniden yazıldı.

[Unreleased]: https://github.com/crty-dev/DYNAMIC/compare/main...HEAD
[0.1.0]: https://github.com/crty-dev/DYNAMIC/releases/tag/v0.1.0
