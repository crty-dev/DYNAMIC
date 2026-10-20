# Dağıtım ve Self-Hosting — Cloudflare Free

DYNAMIC, **Cloudflare Free plan** üzerinde çalışacak şekilde tasarlandı. Bu
belge: hesap sahibinin yapması gerekenleri, ücretsiz limitleri, geri alma
(adım) adımlarını ve sorun giderme notlarını içerir.

## 0. Hızlı başlangıç (hesap sahibi için)

```bash
# 1) Depoyu klonlayın
git clone https://github.com/crty-dev/DYNAMIC.git
cd DYNAMIC
npm install

# 2) D1 veritabanını oluşturun (ücretsiz)
npx wrangler d1 create dynamic
#    Çıktıdaki database_id'yi wrangler.jsonc içindeki "database_id" alanına yazın.

# 3) Migration'ları uygulayın
npx wrangler d1 migrations apply dynamic --remote

# 4) Secret'ları tanımlayın (repodaki hiçbir değer gerçek değildir)
npx wrangler secret put ADMIN_API_KEY        # openssl rand -hex 24
npx wrangler secret put MEDIA_UPLOAD_TOKEN   # openssl rand -hex 24
#   Cloudinary kullanacaksanız:
npx wrangler secret put CLOUDINARY_URL       # cloudinary://<key>:<secret>@<cloud>

# 5) Yayınlayın
npm run deploy
```

`npm run deploy` → `dist/`'i üretir ve Worker'ı yayınlar. `wrangler.jsonc`
içindeki `assets.directory` zaten `./dist` olarak ayarlıdır.

## 1. Cloudflare Free limitleri (2026 itibarıyla)

| Kaynak | Free limit | DYNAMIC'in kullanımı |
| --- | --- | --- |
| Workers istekleri | 100.000 / gün | SDK her sayfa görüntülemesinde 1 istek; 5 sn'de bir toplu gönderim. |
| Worker CPU süresi | 10 ms / istek (yeni limitler) | Worker yalnızca doğrulama + tek batch yazar; raporlar 30 sn'de bir yoklanır. |
| D1 satır okuma | 5 milyon / gün | Her sorgu `site_id` + zaman aralığı ile sınırlı; `sessions` tablosu ziyaretçi sayısını ucuz tutar. |
| D1 satır yazma | 100.000 / gün | 1 event = 1 satır + 1 oturum upsert'i. Site başına günlük kota `daily_event_limit` (varsayılan 25.000). |
| D1 depolama | 5 GB | ~30 günlük veri. Saklama `retention_days` ile ayarlanır. |
| D1 veritabanı sayısı | 10 | 1 yeterli. |
| D1 tablo sayısı | 100 | 5 (sites, sessions, events, goals, session_cache). |
| Static Assets | ücretsiz, Worker isteği üzerinden | `dist/` (≈900 KB). |
| Cron tetikleyicileri | 5 | 1 (günlük retention temizliği). |
| R2 | 10 GB ücretsiz | **Kullanılmıyor**; medya Cloudinary'de. İhtiyaç olursa aşağıya bakın. |

> Limitler Cloudflare tarafından zaman içinde değişebilir; dağıtımdan önce
> [Cloudflare Free limitleri](https://developers.cloudflare.com/workers/platform/limits/)
> sayfasını kontrol edin.

## 2. R2 ne zaman gerekir?

Şu an **gerekmez** — statik dosyalar Worker'ın static asset binding'i ile,
medya ise Cloudinary ile servis edilir. R2'yi yalnızca şu durumlarda ekleyin:

- kullanıcı yüklemeleri (R2 + bir upload uç noktası),
- büyük video/rapor dosyaları,
- D1'de saklanamayacak arşivler.

R2 eklemek için `wrangler.jsonc`'ye:

```jsonc
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "dynamic-media" }]
```

ve `npx wrangler r2 bucket create dynamic-media` komutu.

## 3. Environment variable ve secret listesi

| Değişken | Nerede | Zorunlu | Açıklama |
| --- | --- | --- | --- |
| `CLOUDINARY_CLOUD_NAME` | `wrangler.jsonc` → `vars` | hayır | Cloud adı (public). |
| `CLOUDINARY_UPLOAD_KEY` | `wrangler.jsonc` → `vars` | hayır | Upload API key (public). |
| `CLOUDINARY_URL` | **secret** | hayır | `cloudinary://<key>:<secret>@<cloud>`. Medya teslimi/yükleme için. |
| `MEDIA_UPLOAD_TOKEN` | **secret** | hayır | `POST /api/media/upload` ve `/signature` uçlarının bearer token'ı. |
| `ADMIN_API_KEY` | **secret` | **evet** | `/api/admin/*` uçlarının bearer token'ı. Tanımlı değilse admin uçları `503` döner. |
| `DATABASE_URL` | — | hayır | Kullanılmaz (D1 binding kullanılır). |

Örnek dosya: [`.dev.vars.example`](../.dev.vars.example) (yerel) ve
`wrangler.jsonc` → `vars` (public değerler). **Gerçek secret'ları repoya
koymayın.**

## 4. Yerel geliştirme

```bash
npm install
cp .dev.vars.example .dev.vars     # secret'ları doldurun (yerel)
npm run db:migrate:local           # .wrangler/state içindeki yerel D1
npm run dev                        # Vite: http://localhost:5173
```

Worker'ı de yerelde çalıştırmak için:

```bash
npm run build
npx wrangler dev --local --port 8787
# → http://127.0.0.1:8787 (statik varlıklar + API birlikte)
```

Testler gerçek `wrangler dev` + yerel D1 kullanır:

```bash
npm test
```

## 5. Preview (PR başına)

```bash
npx wrangler versions upload --preview-alias staging   # sürüm yükle
npx wrangler versions deploy <VERSION_ID>               # alias'i yayınla
```

`wrangler.jsonc` `env.preview` bloğu ile ayrı bir preview environment
tanımlayabilirsiniz (ayrı D1 binding + ayrı secret'lar).

## 6. Özel alan adı (dynamic.crty-dev.com)

İki yol var:

### a) Worker üzerinden custom domain (önerilen)

1. Cloudflare Dashboard → **Workers & Pages** → `dynamic` → **Settings** →
   **Domains & Routes** → **Add Custom Domain** → `dynamic.crty-dev.com`.
2. Cloudflare zone'u yönetiyorsanız DNS otomatik oluşturulur (CNAME eklenir).
3. SSL/TLS modu **Full (strict)** olsun; sertifika otomatik yenilenir.

### b) Workers.dev altında

`https://<worker-adı>.<subdomain>.workers.dev` adresi otomatik olarak
verilir; ek işlem gerekmez.

> DNS yetkiniz yoksa (ya da zone başka bir hesaptaysa) yalnızca Workers.dev
> adresini kullanın; özel alan adı için zone yöneticisinden işlem isteyin.

## 7. Dağıtım ve geri alma

```bash
npm run deploy                                  # yeni sürüm yayınlar
npx wrangler deployments list                   # sürüm geçmişi
npx wrangler rollback <VERSION_ID>              # bir önceki sürüme dön
npx wrangler versions view <VERSION_ID>          # sürüm detayı
```

**D1 rollback notu:** D1 migration'ları geri alınmaz (Cloudflare'ta down
migration yoktur). Şema değişikliği yaptıysanız:

1. Yeni sürümü deploy edin.
2. Hata varsa `npx wrangler rollback <VERSION_ID>` ile Worker'ı geri alın.
3. Şemayı geri almak için `migrations/` altına yeni bir dosya yazın (ör.
   `000N_rollback_columns.sql`) ve uygulayın.

**Secret rotasyonu:**

```bash
npx wrangler secret put ADMIN_API_KEY   # yeni değer
npx wrangler secret delete ADMIN_API_KEY # (silme gerekmez, put üzerine yazar)
```

## 8. İzleme

- `wrangler.jsonc` → `observability.enabled: true` (Worker logları).
- `npx wrangler tail` → canlı istek/yanıt logları.
- D1 quota kullanımı: Dashboard → Workers & Pages → `dynamic` → **D1** →
  "Rows read/written" grafiği.

## 9. Sık karşılaşılan sorunlar

| Belirti | Sebep / Çözüm |
| --- | --- |
| `503 media_not_configured` | `CLOUDINARY_URL` secret'ı yok. Medya kullanmıyorsanız sorun değil. |
| `401 unauthorized` (admin) | `ADMIN_API_KEY` secret'ı yok ya da `Bearer` token'ı eşleşmiyor. |
| `429 quota_exceeded` | Sitenin günlük event limiti doldu. `PATCH /api/admin/sites/:id` ile limiti yükseltin ya da `daily_event_limit`'ı düşürün. |
| `429 rate_limited` | İstek hızı yüksek. Sınır IP başına 120/dk'dir (rapor uçları 60/dk). |
| `403 origin_mismatch` | Başka bir origin'in site anahtarı gönderilmiş. |
| Tablolar yok hatası | Migration uygulanmamış: `npx wrangler d1 migrations apply dynamic --remote`. |
| `dist/` boş sayfa | `npm run build` çalıştırılmamış; `npm run deploy` build'i kendisi yapar. |

## 10. Sınır (rate limit) kuralları

Worker içi sınırlar **isolate başına** çalışır (en iyi gayret). Küresel bir
sınır istiyorsanız Cloudflare Dashboard → **Security → WAF → Rate limiting
rules** bölümünden `https://<alan-adı>/api/collect` için bir kural ekleyin
(Free planda sınırlı sayıda kural hakkınız vardır).
