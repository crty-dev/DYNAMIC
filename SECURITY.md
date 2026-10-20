# Güvenlik Politikası — DYNAMIC

DYNAMIC'ı açık kaynak olarak yayımlıyoruz ve güvenlik açıklarını ciddiye
alıyoruz. Bu politika, hangi sürümlerin desteklendiğini, bir açığı nasıl
bildireceğinizi ve ne bekleyeceğinizi anlatır.

## Desteklenen sürümler

| Sürüm | Destek |
| --- | --- |
| `main` | ✅ |
| Son sürüm (tag) | ✅ |
| Daha eski sürümler | ❌ |

## Açık bildirme

**Lütfen güvenlik açıklarını public issue veya PR olarak açmayın.**

- E-posta: `security@crty-dev.com` (yoksa proje sahibiyle iletişime geçin)
- Alternatif: GitHub Security Advisories → "Report a vulnerability"

Bildiriminizi mümkün olduğunca şunları içerecek şekilde gönderin:

- etkilenen sürüm / commit,
- nasıl yeniden üretileceği (PoC),
- etkisi (veri sızıntısı, yetki yükseltme, DoS, …),
- önerilen düzeltme (varsa).

## Yanıt süreleri

| Aşama | Hedef |
| --- | --- |
| Onay (alındı) | 3 iş günü |
| İlk değerlendirme | 10 iş günü |
| Düzeltme (kritikse) | 30 gün, kritikse 7 gün |
| Kamuya duyuru | Düzeltme yayınlandıktan sonra |

Bulgu doğrulanırsa, düzeltme `main` üzerine eklenir, sürüm çıkarılır ve
(CHANGELOG.md) kaydedilir. Katkıda bulunanlara teşekkür edilir.

## Mevcut güvenlik önlemleri

| Alan | Önlem |
| --- | --- |
| Yönetim API | `/api/admin/*` yolları `Authorization: Bearer <ADMIN_API_KEY>` ile korunur; anahtar yoksa uçlar `503` döner. |
| Veri izolasyonu | Her sorgu `site_id` ile sınırlıdır; başka bir origin'in site anahtarı gönderilirse `403 origin_mismatch`. |
| Girdi doğrulama | Tüm ingest gövdeleri zod şemalarıyla doğrulanır; bilinmeyen alanlar reddedilir. |
| Boyut sınırları | 64 event / istek, 128 KB gövde, 4 KB attribution, 8 prop, 200 karakter/prop değer. |
| Hız sınırı | `/api/collect` 120 istek/dk (IP başına), rapor uçları 60 istek/dk; ayrıca sitenin günlük event kotası vardır (`429 quota_exceeded`). |
| Sıfır gün | Toplama sırasında hiçbir kişisel veri yazılmaz: IP saklanmaz, çerez kullanılmaz, referrer yalnızca host olarak tutulur, özel event propları PII anahtarlarından arındırılır. |
| Oturum yönetimi | Parola yoktur. Yönetici erişimi tek bir bearer token ile sağlanır; token'ı `wrangler secret put ADMIN_API_KEY` ile tutun ve düzenli olarak değiştirin. |
| Günlük veri | Web vitals raporlarında p75 yalnızca ≥20 örnek varsa hesaplanır; aksi halde `null` döner ve istatistik uydurulmaz. |
| Loglar | Log satırları yalnızca hata sınıflarını ve site kimliklerini içerir; gövde, IP veya event içeriği yazılmaz. |
| Saklama | Varsayılan 30 gün; günlük cron eski verileri siler. |
| Veri hakları | `GET /api/admin/sites/:id/export` (veri taşınabilirliği) ve `DELETE /api/admin/sites/:id` (silme hakkı) uçları mevcuttur. |

## Kapsam dışı (kabul edilmez)

- "Siteyi kendi hesabıma yükledim, kendimi hackledim" bulguları.
- Rate limit'i kasıtlı olarak aşmak için yapılan testler.
- Cloudflare veya Cloudinary'nin kendi altyapısındaki sorunlar.
- Gizli bilgi olmayan, yalnızca teorik olan bulgular (DoS'un yalnızca kendi
  sitenizi etkilediği durumlar dahil).

## Sorumlu taraf

Bu bir topluluk projesidir. Bildirimi 3 iş günü içinde onaylamak, düzeltmeyi
koordine etmek ve duyurmak proje sahibinin sorumluluğundadır.
