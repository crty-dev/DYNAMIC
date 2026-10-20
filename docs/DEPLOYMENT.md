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

## DYNAMIC Console (uygulama) — dağıtım

Uygulama **ayrı bir origin** üzerinde çalışır ama aynı Worker'ı paylaşır
(tek deploy, tek D1 binding).

### 1) Origin

```
Cloudflare Dashboard → Workers & Pages → dynamic → Settings → Domains & Routes
  → Add Custom Domain → app.dynamic.crty-dev.com
```

Worker, `app.` ile başlayan host'larda uygulama kabuğunu (`/app/index.html`)
sunar; diğer host'larda pazarlama sitesini. DNS değişikliği zone
yöneticisinden yapılır; SSL modu **Full (strict)** olmalıdır.

### 2) Secret'lar

```bash
npx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -hex 32
npx wrangler secret put ADMIN_API_KEY       # openssl rand -hex 24
npx wrangler secret put MEDIA_UPLOAD_TOKEN  # openssl rand -hex 24
npx wrangler secret put CLOUDINARY_URL      # cloudinary://<key>:<secret>@<cloud>
```

`BETTER_AUTH_SECRET` olmadan Worker auth uçlarında hata verir (sessizce
güvensiz bir oturum üretmez).

### 3) Public değişkenler (`wrangler.jsonc` → `vars`)

| Değişken | Değer |
| --- | --- |
| `APP_URL` | `https://app.dynamic.crty-dev.com` |
| `MARKETING_URL` | `https://dynamic.crty-dev.com` |
| `MAIL_FROM` | `DYNAMIC <no-reply@mail.crty-dev.com>` |
| `MAX_SITES` | `500` (self-serve site sayısı sınırı) |
| `AUTH_IP_HEADERS` | `cf-connecting-ip` (auth hız sınırı istemci IP'si) |

### 4) E-posta gönderimi (ücretsiz seçenekler)

| Sağlayıcı | Ücretsiz limit | Not |
| --- | --- | --- |
| **Resend** | 3.000 e-posta/ay, 100/gün | `MAIL_PROVIDER_URL=https://api.resend.com/emails` |
| **Kendi SMTP'niz** | — | Sağlayıcı yoksa e-posta gönderilmez, istek başarısız olmaz. |
| **Geliştirme** | — | `DEV_MODE=1` → mailler `GET /api/dev/mailbox` outbox'ına düşer. |

Hiçbir sağlayıcı zorunlu değildir; projede ücretli bir servis zorunlu hâle
getirilmez ve otomatik olarak ücretli plana geçilmez.

### 5) Sosyal giriş (isteğe bağlı)

Console'da "GitHub / Google ile devam et" düğmeleri **yalnızca** o sağlayıcının
kimlik bilgileri tanımlıysa görünür (`GET /api/auth/providers` hangilerinin
aktif olduğunu döner). Sağlayıcı başına iki secret gerekir:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Callback adresleri (OAuth uygulamasında tam olarak bu yazılmalı):

| Sağlayıcı | Callback URL |
| --- | --- |
| GitHub | `https://dynamic.crty-dev.com/api/auth/callback/github` |
| Google | `https://dynamic.crty-dev.com/api/auth/callback/google` |

GitHub için *Settings → Developer settings → OAuth Apps → New OAuth App*,
Google için *Google Cloud Console → APIs & Services → Credentials → OAuth
client ID* kullanılır. GitHub'ın varsayılan kapsamı (`read:user`,
`user:email`) doğrulamalı e-posta adresini getirdiği için sosyal girişle
gelen hesaplar "doğrulanmamış" duruma düşmez.

### 6) DNS doğrulama kaydı

Kullanıcı, Console'da üretilen TXT kaydını alan adının DNS sağlayıcısına
ekler:

```
TXT   _dynamic-verification.<hostname>   dynamic-verification=<48 haneli token>
```

Doğrulama Worker tarafında, DNS-over-HTTPS (Cloudflare 1.1.1.1) ile yapılır.
`DNS_RESOLVER_URL` ile başka bir çözümleyici kullanılabilir.

## 3. Environment variable ve secret listesi

| Değişken | Nerede | Zorunlu | Açıklama |
| --- | --- | --- | --- |
| `CLOUDINARY_CLOUD_NAME` | `wrangler.jsonc` → `vars` | hayır | Cloud adı (public). |
| `CLOUDINARY_UPLOAD_KEY` | `wrangler.jsonc` → `vars` | hayır | Upload API key (public). |
| `CLOUDINARY_URL` | **secret** | hayır | `cloudinary://<key>:<secret>@<cloud>`. Medya teslimi/yükleme için. |
| `MEDIA_UPLOAD_TOKEN` | **secret** | hayır | `POST /api/media/upload` ve `/signature` uçlarının bearer token'ı. |
| `ADMIN_API_KEY` | **secret` | **evet** | `/api/admin/*` uçlarının bearer token'ı. Tanımlı değilse admin uçları `503` döner. |
| `MAX_SITES` | `wrangler.jsonc` → `vars` | hayır | Self-serve site sayısı sınırı (varsayılan 500); public ingestion ucu ile geçici site açılamaz. |
| `AUTH_IP_HEADERS` | `wrangler.jsonc` → `vars` | hayır | Kimlik doğrulama hız sınırının istemci IP'sini okuduğu başlık (varsayılan `cf-connecting-ip`). Nginx arkasında `x-real-ip` kullanın. |
| `AUTH_TRUSTED_PROXIES` | `wrangler.jsonc` → `vars` | hayır | Güvenilen reverse proxy IP/CIDR listesi (virgülle). Yalnızca IP başlığı bir zincir taşıyorsa gerekir. |
| `DATABASE_URL` | — | hayır | Kullanılmaz (D1 binding kullanılır). |

İstemci (build) tarafı değişkenleri — Vite `VITE_` ile ön eki olmadan gömülür:

| Değişken | Açıklama |
| --- | --- |
| `VITE_CLOUDINARY_DISABLED=1` | Görselleri Cloudinary'ye gitirmeden kendi origin'inden (yerel WebP) servis eder. **Fork'lar için önerilir.** |
| `VITE_CLOUDINARY_CLOUD` | Fork'un kendi Cloudinary cloud adı. |

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

### 10.1 Kimlik doğrulama (Better Auth) hız sınırı

Better Auth'ın kendi hız sınırı da **isolate başına** bellekte tutulur
(`rateLimit.storage: "memory"`); hard limit için WAF kuralı ya da
`storage: "database"` gerekir (D1'de her istekte yazma → kota maliyeti).

Kova anahtarı istemci IP'si + yol olduğu için **IP'nin doğru okunması**
sınırın çalışması için şarttır:

- Varsayılan başlık `x-forwarded-for`'dır ve **ziyaretçi tarafından
  etkilenebilir** (Cloudflare bu başlığa kendi IP'sini *ekler*). Zincir
  hâlinde bir `X-Forwarded-For` gönderen istek "güvenilmez" sayılır; IP
  çözülemez ve tüm çözülemeyen istekler **tek bir ortak kovada** birleşir.
- DYNAMIC bu yüzden `cf-connecting-ip` başlığını kullanır: Cloudflare bunu
  edge'de gerçek ziyaretçi IP'si ile **üzerine yazar**, ziyaretçi
  değiştiremez. Değer tek parçalı olduğu için Better Auth güvenilir kabul
  eder (IPv6 adresleri varsayılan olarak /64 maskesiyle sayılır).
- **Yedek başlık eklemeyin.** `ipAddressHeaders` içine `x-forwarded-for`
  konulursa, ziyaretçi kendi başlığıyla her isteğe farklı bir IP yazarak
  sınırı baypas edebilir.

| Ortam | `AUTH_IP_HEADERS` |
| --- | --- |
| Cloudflare Workers (önerilen) | `cf-connecting-ip` |
| Nginx (`proxy_set_header X-Real-IP $remote_addr;`) | `x-real-ip` |
| Doğrudan bağlantı (proxy yok) | `x-forwarded-for` (tek parça olmalı) |

Başlık bir **zincir** taşıyorsa (ör. `client, proxy1, proxy2`) ilk adres
ziyaretçiye ait olduğu için güvenilmez. Bu durumda güvendiğiniz proxy'leri
`AUTH_TRUSTED_PROXIES` ile bildirin; Better Auth zinciri sağdan sola yürür,
güvenilen hop'ları atlar ve ilk güvenilmeyen adresi istemci IP'si olarak
kullanır.

### 10.2 Veritabanı birleştirmeleri (joins)

`advanced.database.joins: true` açıktır: Better Auth ilişkili veriyi tek
sorguda çeker (`/get-session` artık session + user + account için üç yerine
bir sorgu yapar). D1'in SQLite lehçesi JOIN desteklediği için Drizzle/Prisma
ilişki tanımları gerekmez — bunlar yalnızca o ORM'lerin kendi şemaları
içindir.
