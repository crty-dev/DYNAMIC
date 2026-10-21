# Dağıtım ve Self-Hosting — Cloudflare Free

DYNAMIC, **Cloudflare Free plan** üzerinde çalışacak şekilde tasarlandı. Bu
belge eksiksiz bir operasyon kılavuzudur: hesap sahibinin yapması gerekenler,
ücretsiz limitler, secret yönetimi, süper admin paneli, canlı sohbet, yedekleme,
izleme ve sorun giderme.

---

## İçindekiler

0. [Hızlı başlangıç](#0-hızlı-başlangıç)
1. [Mimari](#1-mimari)
2. [Cloudflare Free limitleri](#2-cloudflare-free-limitleri)
3. [R2 ne zaman gerekir?](#3-r2-ne-zaman-gerekir)
4. [DYNAMIC Console (uygulama) dağıtımı](#4-dynamic-console-uygulama-dağıtımı)
4.1. [Yerel geliştirme](#41-yerel-geliştirme)
5. [Süper admin paneli](#5-süper-admin-paneli)
5b. [İmza özellikler (Change Radar, Privacy Gate, Fix-to-Proof)](#5b-imza-özellikler-change-radar-privacy-gate-fix-to-proof)
6. [Environment variable ve secret listesi](#6-environment-variable-ve-secret-listesi)
7. [Alan adı ve DNS kurulumu](#7-alan-adı-ve-dns-kurulumu)
8. [Migration ve veritabanı işlemleri](#8-migration-ve-veritabanı-işlemleri)
9. [Canlı sohbet (Crisp)](#9-canlı-sohbet-crisp)
10. [Medya (Cloudinary)](#10-medya-cloudinary)
11. [Free plan koruması](#11-free-plan-koruması)
12. [Hız sınırı (rate limit) kuralları](#12-hız-sınırı-rate-limit-kuralları)
13. [İzleme ve loglar](#13-izleme-ve-loglar)
14. [Yedekleme ve geri alma](#14-yedekleme-ve-geri-alma)
15. [Sorun giderme](#15-sorun-giderme)
16. [Yayına çıkma kontrol listesi](#16-yayına-çıkma-kontrol-listesi)
17. [Güncelleme (update.bat)](#17-güncelleme-updatebat)

---

## 0. Hızlı başlangıç

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
npx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -hex 32
npx wrangler secret put ADMIN_API_KEY        # openssl rand -hex 24
npx wrangler secret put MEDIA_UPLOAD_TOKEN   # openssl rand -hex 24
npx wrangler secret put ADMIN_EMAILS         # info@alan-adiniz.com
#   Cloudinary kullanacaksanız:
npx wrangler secret put CLOUDINARY_URL       # cloudinary://<key>:<secret>@<cloud>

# 5) Yayınlayın
npm run deploy
```

`npm run deploy` → `dist/`'i üretir ve Worker'ı yayınlar. `wrangler.jsonc`
içindeki `assets.directory` zaten `./dist` olarak ayarlıdır.

Windows'ta tüm bu adımlar tek komutta: **`update.bat`** (§17).

---

## 1. Mimari

Tek Worker, iki SPA, tek D1:

```
https://dynamic.crty-dev.com        → dist/        (pazarlama sitesi)
https://dynamic.crty-dev.com/demo   → dist/app/    (konsol önizlemesi, demo veri)
https://dynamic.crty-dev.com/dashboard → dist/     (süper admin paneli)
https://dynamic.crty-dev.com/app/*  → dist/app/    (gerçek Console uygulaması)
https://app.dynamic.crty-dev.com/*  → dist/app/    (Console, kendi origin'inde)
```

| Parça | Nerede | Not |
| --- | --- | --- |
| Worker (API) | `worker/` | Hono + Better Auth + D1. Tüm uçlar aynı Worker'da. |
| Pazarlama | `src/landing/` | Vite + React, `dist/` |
| Console | `src/app/` | Vite + React, `dist/app/` |
| Konsol önizlemesi | `src/console/` | Demo veri, `dist/` içinde `/demo` rotasında. |
| Süper admin | `src/admin/` | `dist/` içinde `/dashboard` rotasında. |
| SDK | `src/sdk/dynamic.ts` → `public/js/dynamic.js` | Tek dosya, harici bağımlılıksız. |

---

## 2. Cloudflare Free limitleri

| Kaynak | Free limit | DYNAMIC'in kullanımı |
| --- | --- | --- |
| Workers istekleri | 100.000 / gün | SDK her sayfa görüntülemesinde 1 istek; 5 sn'de bir toplu gönderim. |
| Worker CPU süresi | 10 ms / istek | Worker yalnızca doğrulama + tek batch yazar; raporlar önbelleklenir. |
| D1 satır okuma | 5 milyon / gün | Her sorgu `site_id` + zaman aralığı ile sınırlı; `sessions` tablosu ziyaretçi sayısını ucuz tutar. |
| D1 satır yazma | 100.000 / gün | 1 event = 1 satır + 1 oturum upsert'i. Site başına günlük kota `daily_event_limit` (varsayılan 25.000). |
| D1 depolama | 5 GB | ~30 günlük veri. Saklama `retention_days` ile ayarlanır. |
| D1 veritabanı sayısı | 10 | 1 yeterli. |
| D1 tablo sayısı | 100 | 7 (user, session, account, verification, sites, sessions, events, goals, projects). |
| Static Assets | ücretsiz | `dist/` (≈1 MB). |
| Cron tetikleyicileri | 5 | 1 (günlük retention temizliği). |
| R2 | 10 GB ücretsiz | **Kullanılmıyor**; medya Cloudinary'de. |

> Limitler Cloudflare tarafından değişebilir; dağıtımdan önce
> [Cloudflare Free limitleri](https://developers.cloudflare.com/workers/platform/limits/)
> sayfasını kontrol edin.

---

## 3. R2 ne zaman gerekir?

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

---

## 4. DYNAMIC Console (uygulama) dağıtımı

Uygulama **ayrı bir origin** üzerinde çalışır ama aynı Worker'ı paylaşır
(tek deploy, tek D1 binding). Origin eklenene kadar uygulama
`https://dynamic.crty-dev.com/app` altında da çalışır (Router `basename`
değeri `/app` olduğu için derin linkler de çalışır).

### 4.1 Origin

```
Cloudflare Dashboard → Workers & Pages → dynamic → Settings → Domains & Routes
  → Add Custom Domain → app.dynamic.crty-dev.com
```

Worker, `app.` ile başlayan host'larda uygulama kabuğunu (`/app/index.html`)
sunar; diğer host'larda pazarlama sitesini. DNS değişikliği zone
yöneticisinden yapılır; SSL modu **Full (strict)** olmalıdır.

> **Origin taşındığında:** oturum çerezi `dynamic.crty-dev.com` için
> host-only'dır. Uygulama `app.` origin'ine taşınırsa ya çerezi
> paylaşılır hale getirin (`crossSubDomainCookies`) ya da API çağrılarını
> pazarlama origin'i üzerinden yapın.

### 4.2 Secret'lar

```bash
npx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -hex 32
npx wrangler secret put ADMIN_API_KEY        # openssl rand -hex 24
npx wrangler secret put MEDIA_UPLOAD_TOKEN   # openssl rand -hex 24
npx wrangler secret put CLOUDINARY_URL       # cloudinary://<key>:<secret>@<cloud>
```

`BETTER_AUTH_SECRET` olmadan Worker auth uçlarında hata verir (sessizce
güvensiz bir oturum üretmez).

### 4.3 Public değişkenler (`wrangler.jsonc` → `vars`)

| Değişken | Değer |
| --- | --- |
| `APP_URL` | `https://app.dynamic.crty-dev.com` |
| `MARKETING_URL` | `https://dynamic.crty-dev.com` |
| `MAIL_FROM` | `DYNAMIC <no-reply@mail.crty-dev.com>` |
| `MAX_SITES` | `500` (self-serve site sayısı sınırı) |
| `AUTH_IP_HEADERS` | `cf-connecting-ip` (auth hız sınırı istemci IP'si) |

### 4.4 E-posta gönderimi (ücretsiz seçenekler)

| Sağlayıcı | Ücretsiz limit | Not |
| --- | --- | --- |
| **Resend** | 3.000 e-posta/ay, 100/gün | `MAIL_PROVIDER_URL=https://api.resend.com/emails` + `MAIL_PROVIDER_TOKEN` |
| **Kendi SMTP'niz** | — | Sağlayıcı yoksa e-posta gönderilmez, istek başarısız olmaz. |
| **Geliştirme** | — | `DEV_MODE=1` → mailler `GET /api/dev/mailbox` outbox'ına düşer. |

Hiçbir sağlayıcı zorunlu değildir; projede ücretli bir servis zorunlu hâle
getirilmez ve otomatik olarak ücretli plana geçilmez.

> **Dikkat:** Doğrulama e-postası **sağlayıcıya bağlıdır.** Sağlayıcı yoksa
> hiçbir e-posta gönderilemez; bu durumda e-posta doğrulaması da zorunlu
> olmaktan çıkar (aksi halde kimse kendi konsoluna giremezdi). Sağlayıcıyı
> tanımladığınız anda doğrulama tekrar zorunlu hâle gelir. Durumu
> `GET /api/auth/mail-status` ucu bildirir, konsol da kullanıcıya uyarı
> gösterir. **Üretime çıkmadan bir sağlayıcı tanımlayın.**
>
> Doğrulama zorunluyken bir giriş denemesi e-postayı **otomatik yeniden
> gönderir** (`sendOnSignIn`), "Tekrar gönder" düğmesine gerek kalmaz.

**Resend ile (ücretsiz 3.000 e-posta/ay, 100/gün):**

```bash
# 1) Resend'de API key oluşturun (https://resend.com/api-keys)
# 2) Alan adını doğrulayın (https://resend.com/domains) — MAIL_FROM bu
#    alan adına ait olmalı, aksi halde e-postalar spam'e düşer
# 3) Worker secret'ları:
npx wrangler secret put MAIL_PROVIDER_URL     # https://api.resend.com/emails
npx wrangler secret put MAIL_PROVIDER_TOKEN   # re_xxxxxxxxx
```

Adaptör sağlayıcıdan bağımsızdır (Resend, Postmark, kendi SMTP geçidi…):
`POST {MAIL_PROVIDER_URL}` gövdesi `{ from, to[], subject, text, html }`,
başlık `Authorization: Bearer {MAIL_PROVIDER_TOKEN}`.

> **Güvenlik notu:** Prod'da e-posta gönderimi `waitUntil` ile **arka planda**
> yapılır; yanıt süresi, adresin bir hesaba ait olup olmadığını ele vermez.
> Geliştirmede outbox'a yazılır ve istek yanıtlanmadan önce hazır olur.

### 4.5 Sosyal giriş (isteğe bağlı)

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

---

## 4.1 Yerel geliştirme

Üç süreç gerekir: Worker (API + statik dosyalar), pazarlama sitesi ve Console.
**Vite her ikisinde de `/api` isteklerini Worker'a proxy'ler** — bu sayede her şey
tek origin'de kalır: oturum çerezi first-party olur, SDK olayları yerel D1'e
düşer, `localhost` ile `127.0.0.1` arasındaki "cross-site" farkı çerezi
düşürmez.

```bash
# 0) Yerel şema
npm run db:migrate:local

# 1) Worker: API + üretim varlıkları (http://127.0.0.1:8787)
npx wrangler dev --port 8787

# 2) Pazarlama sitesi (http://localhost:5173) — /api proxy'si 8787'ye gider
npm run dev

# 3) Console (http://localhost:5174/app) — /api proxy'si 8787'ye gider
npm run dev:app
```

| Değişken | Ne zaman |
| --- | --- |
| `DYNAMIC_API_ORIGIN` | Worker farklı bir portta çalışıyorsa (varsayılan `http://127.0.0.1:8787`). |
| `VITE_API_ORIGIN` | Yalnızca proxy'yi atlamak istiyorsanız (API doğrudan adrese gider; **oturum çerezi düşer**, geliştirme için önerilmez). |

Doğrulama e-postaları `DEV_MODE=1` ile `GET /api/dev/mailbox` outbox'ına düşer
(yalnızca yerelde; üretimde bu uç yoktur).

---

## 5. Süper admin paneli

**`https://dynamic.crty-dev.com/dashboard`** yalnızca `role = "admin"` olan
hesapları açılır. Koruma **sunucudadır**: `/api/super/*` uçları oturumdaki
rolü kontrol eder, arayüzde gizlemek güvenlik sınırı değildir.

| Yetki | Davranış |
| --- | --- |
| Oturumsuz istek | `401` |
| Giriş yapmış ama admin olmayan hesap | `403` |
| Admin hesap | panel + API açık |

### 5.1 İlk admin nasıl atanır?

**Yöntem A — Worker secret (önerilen):**

```bash
npx wrangler secret put ADMIN_EMAILS
# info@alan-adiniz.com,ops@alan-adiniz.com
```

Listelenen adresler **oturum açtığında** otomatik olarak admin olur (Better Auth
`databaseHooks.session.create.after` → D1 güncellemesi).

**Yöntem B — doğrudan D1:**

```bash
npx wrangler d1 execute dynamic --remote \
  --command "UPDATE user SET role = 'admin' WHERE email = 'info@alan-adiniz.com'"
```

> Rol, Better Auth tarafında `input: false` olarak tanımlıdır: kayıt olurken
> istemci rolü **gönderemez**, yani ziyaretçi kendini admin yapamaz.

### 5.2 Panel ne yapar?

- **Genel bakış:** hesap, admin, site, event ve oturum sayıları; son kayıtlar.
- **Hesaplar:** e-posta, proje sayısı, doğrulama durumu, rol atama/geri alma.
  Son adminin rolü düşürülemez (`last_admin` hatası).
- **Siteler:** tüm hesapların siteleri, sahibi, bugünkü event sayısı; tek
  tıkla **site + tüm verisini silme** (KVKK md. 7 / GDPR 17).

### 5.3 Super admin API'si (oturum tabanlı)

| Uç | Metot | Açıklama |
| --- | --- | --- |
| `/api/super/overview` | GET | sayaçlar, son kullanıcılar, son siteler |
| `/api/super/users` | GET | hesap listesi (`?limit=`, `?offset=`) |
| `/api/super/users/:id/role` | POST | `{"role":"user"\|"admin"}` |
| `/api/super/sites` | GET | tüm siteler (`?limit=`) |
| `/api/super/sites/:publicId` | DELETE | site + verilerini siler |
| `/api/auth/mail-status` | GET | e-posta gönderimi yapılandırılmış mı (public) |

Ayrıca otomasyon için bearer token'lı klasik admin API'si duruyor:
`/api/admin/*` (`Authorization: Bearer <ADMIN_API_KEY>`) — site oluşturma,
olay limiti, goal, export, purge, erasure.

---

## 5b. İmza özellikler (Change Radar, Privacy Gate, Fix-to-Proof)

Üç özellik tek bir veri modeli üzerine kuruludur ve konsolda proje sayfasının
altındaki üç panelde görünür: **Değişim Radarı**, **Fix-to-Proof** ve
**Gizlilik Kapısı**.

### Veri modeli (migration `0006_signature_features.sql`)

| Tablo | İçerik |
| --- | --- |
| `releases` | Sürüm işaretleri (`version`, `deployed_at`). Kaynak kodu veya commit mesajı **tutmaz**. |
| `events.release` | Ölçümün ait olduğu sürüm. |
| `insights` | Bulunan sorunlar ve durumları (`open` / `investigating` / `fixed` / `dismissed`). |
| `privacy_counters` | Engellenen payload sayıları — **yalnızca sayı**, değer yok. |

### Uçlar (hepsi proje-scoped, oturum doğrulamalı)

| Uç | Metot | Açıklama |
| --- | --- | --- |
| `/api/projects/:id/releases` | GET / POST | Sürüm işaretlerini listeler / işaretler. |
| `/api/projects/:id/radar` | GET | Sürümün öncesi ve sonrası karşılaştırması + zaman çizelgesi. |
| `/api/projects/:id/insights` | GET | Öneriler (ölçülmüş kanıtla). |
| `/api/projects/:id/insights/:fingerprint` | PATCH | Durum değiştirir, düzeltmeyi bir sürüme bağlar. |
| `/api/projects/:id/privacy` | GET | Etkin kurallar, engellenen kategoriler, güvenli sayaçlar. |
| `/api/projects/:id/privacy/test` | POST | Sentezik (uydurma) testi — tarayıcıda çalışır, hiçbir değer sunucuya gitmez. |

### SDK

```js
dynamic.release("2026.10.4");             // sürüm işareti
dynamic.release("2026.10.4", deployTs);   // dağıtım zamanı belli
dynamic.error(err, "unhandledrejection");  // JS hatası (redakte edilmiş)
dynamic.privacy.selfTest();               // tarayıcıda sentetik test
```

### Bilinçli sınırlar

- **Eşzamanlılık nedensellik değildir**: radar ölçüm değişimini gösterir, "sürüm
  neden oldu" iddiasında bulunmaz.
- **Az örnekte karar verilmez**: her iki pencerede de en az 20 ölçüm yoksa sonuç
  "yeterli veri yok"tur.
- **Privacy Gate mutlak PII tespiti vaat etmez**: kalıbı benzemeyen bir değer
  geçebilir. Varsayılan ayar muhafazakardır; sunucu gelen paketi yine de
  bağımsız olarak doğrular.
- **Düzeltenme bir tuşe basmakla doğrulanmaz**: "düzeltildi" denebilmesi için
  sürüm işareti öncesi/sonrası ölçümleri yeterli örnekle karşılaştırılmalıdır.

---

## 6. Environment variable ve secret listesi

### 6.1 Secret'lar (Worker secret store — repoya yazılmaz)

| Değişken | Zorunlu | Açıklama |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | **evet** | Oturum imzalama anahtarı (≥32 karakter). Yoksa Worker hata verir. |
| `ADMIN_API_KEY` | **evet** | `/api/admin/*` uçlarının bearer token'ı. |
| `ADMIN_EMAILS` | hayır | Virgülle ayrılmış admin adresleri (ilk admin bootstrap). |
| `MEDIA_UPLOAD_TOKEN` | hayır | `POST /api/media/upload` ve `/signature` token'ı. |
| `CLOUDINARY_URL` | hayır | `cloudinary://<key>:<secret>@<cloud>`. |
| `MAIL_PROVIDER_TOKEN` | hayır | E-posta sağlayıcı bearer token'ı. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | hayır | GitHub sosyal girişi. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | hayır | Google sosyal girişi. |
| `BETTER_AUTH_API_KEY` | hayır | Better Auth Dash paneli (sahiplik doğrulaması). |

### 6.2 Public değişkenler (`wrangler.jsonc` → `vars`)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `APP_URL` | `https://app.dynamic.crty-dev.com` | Uygulamanın public adresi. |
| `MARKETING_URL` | `https://dynamic.crty-dev.com` | Pazarlama sitesi. |
| `AUTH_BASE_URL` | `MARKETING_URL` | Better Auth `baseURL` (doğrulama/reset linkleri buraya gider). |
| `MAIL_FROM` | `DYNAMIC <no-reply@mail.crty-dev.com>` | Gönderen adres. |
| `MAIL_PROVIDER_URL` | — | E-posta sağlayıcı uç noktası. |
| `MAX_SITES` | `500` | Self-serve site sayısı sınırı. |
| `AUTH_IP_HEADERS` | `cf-connecting-ip` | Auth hız sınırının IP başlığı. |
| `AUTH_TRUSTED_PROXIES` | — | Güvenilen proxy IP/CIDR listesi. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | — | `1` doğrulamayı zorlar, `0` kapatır. Varsayılan: mail sağlayıcısı varsa zorunlu, yoksa kapalı. |
| `AUTH_RATE_LIMIT_MAX` | — | Test/self-host için path limitlerini yükseltir. |
| `CLOUDINARY_CLOUD_NAME` | `di9c12gg6` | Medya teslimi için public cloud adı. |
| `CLOUDINARY_UPLOAD_KEY` | — | Public upload API key. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | Bot koruması (Turnstile). |
| `DNS_RESOLVER_URL` | `https://cloudflare-dns.com/dns-query` | DNS-over-HTTPS çözümleyici. |
| `PROJECT_VERIFY_INTERVAL_MS` | `10000` | İki doğrulama denemesi arası minimum süre. |
| `DEV_MODE` | — | **Üretimde asla `1` yapmayın.** Yerel outbox + gevşek davranış. |

### 6.3 İstemci (build) değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `VITE_CLOUDINARY_DISABLED=1` | Görselleri Cloudinary'ye gitirmeden kendi origin'inden servis eder. **Fork'lar için önerilir.** |
| `VITE_CLOUDINARY_CLOUD` | Fork'un kendi Cloudinary cloud adı. |
| `VITE_API_ORIGIN` | Konsolun API adresi (yerel geliştirmede `http://127.0.0.1:8787`). |
| `VITE_APP_URL` | Uygulamanın adresi (yerelde `http://localhost:5174`). |
| `VITE_CRISP_EAGER=1` | Canlı sohbeti sayfa yüklenirken yükler (§9). |

Örnek dosya: [`.dev.vars.example`](../.dev.vars.example) (yerel) ve
`wrangler.jsonc` → `vars` (public değerler). **Gerçek secret'ları repoya
koymayın.**

---

## 7. Alan adı ve DNS kurulumu

İki yol var.

### a) Worker üzerinden custom domain (önerilen)

```
Cloudflare Dashboard → Workers & Pages → dynamic → Settings → Domains & Routes
  → Add Custom Domain → dynamic.crty-dev.com   (ve app.dynamic.crty-dev.com)
```

SSL otomatik olarak **Full (strict)** olur; sertifika yenilemesi Cloudflare'da
kalır.

### b) Workers.dev altında

`npx wrangler deploy` sonrası `*.workers.dev` adresi otomatik çalışır. DNS
eklenmez ama adres `workers.dev` olur; üretim için custom domain önerilir.

### DNS kayıtları

| Tip | Ad | Değer |
| --- | --- | --- |
| CNAME | `app` | `<worker>.<subdomain>.workers.dev` |
| TXT (site doğrulama) | `_dynamic-verification.<site-alan-adı>` | `dynamic-verification=<48 haneli token>` |

---

## 8. Migration ve veritabanı işlemleri

```bash
# Yerel (geliştirme) D1
npm run db:migrate:local

# Uzak (üretim) D1
npm run db:migrate:remote
# ya da: update.bat --migrate
```

Mevcut migration'lar:

| # | Dosya | İçerik |
| --- | --- | --- |
| 0001 | `0001_init.sql` | sites, events, sessions, goals, session_cache |
| 0002 | `0002_site_origin_unique.sql` | origin benzersizliği |
| 0003 | `0003_analytics_rum.sql` | RUM/attribution alanları |
| 0004 | `0004_auth_projects.sql` | Better Auth tabloları + projects |
| 0005 | `0005_user_role.sql` | `user.role` (super admin) |

> **Migration sırası önemlidir.** Yeni migration eklediyseniz önce
> `--remote` uygulayın, sonra deploy edin. `update.bat --migrate` ikisini de
> yapar.

---

## 9. Canlı sohbet (Crisp)

Pazarlama sitesinde, sağ alt köşedeki **Destek** düğmesi canlı sohbeti açar.
Crisp'in website id'si `4280acc8-3c15-4051-a42b-dfb5842104d4` (public, kod
içinde `src/lib/crisp.ts`).

**Masaüstü / telefon davranışı:**

| Cihaz | Davranış |
| --- | --- |
| Masaüstü (≥768 px) | Crisp betiği sayfa ile birlikte yüklenir, sohbet **kendiliğinden açılır** (ziyaretçi kapatabilir, baloncuk köşede kalır). |
| Telefon | Sohbet paneli ekranı kapattığı için betik yalnızca "Destek" düğmesine basıldığında yüklenir. |

`VITE_CRISP_EAGER=0` ile masaüstündeki otomatik açma kapatılır (sohbet yalnızca
düğmeyle açılır).

> **Gizlilik notu:** Masaüstünde üçüncü taraf betiği her ziyaretçiye gider ve
> Crisp kendi çerezlerini kurar. Bu, DYNAMIC'in **analitiğinin** çerezsiz
> olmasıyla çelişmez ama sayfanın kendisi için bir istisnadır; açıkça
> `docs/PRIVACY.md` bölüm 4'te belgelenmiştir.

| Davranış | Nasıl |
| --- | --- |
| Masaüstünde sayfa ile yüklenir ve kendiliğinden açılır (varsayılan) | `src/lib/crisp.ts` → `autoStartSupportChat()` |
| Sadece düğmeyle açılsın (masaüstü de) | `VITE_CRISP_EAGER=0` |
| Sadece footer bağlantısı | `openSupportChat()` doğrudan çağrılır |

Crisp panelinde yapılabilecekler: renk teması (`teal`), dil (`tr`), karşılama
mesajı, hazır cevaplar (shortcut), tatil modu, çevrimiçi durumu.

---

## 10. Medya (Cloudinary)

Statik varlıklar Worker'ın asset binding'i ile servis edilir; **medya
Cloudinary'de** durur (görseller `images/png-to-webp/` klasöründen WebP olarak
build edilir, `VITE_CLOUDINARY_DISABLED=1` ile Cloudinary tamamen devre dışı
kalır).

```bash
npm run cloudinary:setup     # medya klasörünü yükler
npm run cloudinary:link      # API secret'ını .dev.vars'a yazar
```

Upload uçları `MEDIA_UPLOAD_TOKEN` ile korunur; yoksa `503` döner.

---

## 11. Free plan koruması

| Koruma | Nerede |
| --- | --- |
| Site başına günlük event limiti (25.000) | `sites.daily_event_limit` — kota dolunca `429 quota_exceeded`. |
| Self-serve site sayısı (500) | `MAX_SITES` — geçici site açılamaz. |
| Gövde/olay limitleri | 64 olay, 128 KB gövde, 4 KB attribution. |
| Rapor önbelleği | Workers Cache API, 60 sn. `?fresh=1` önbelleği atlar. |
| Hız sınırı | Admin API 30 istek/dk, rapor uçları 60/dk, ingest IP başına 120/dk. |
| Değişim Radarı'nın maliyeti | Metrik başına pencere başına en fazla **5.000** örnek taranır (`RADAR_SCAN_LIMIT`), cevap 5 dk önbelleklenir, kullanıcı başına 20 istek/dk. Kesilen tarama cevapta `sampled` ile bildirilir. |
| WAF kuralları | Cloudflare Dashboard → Security → WAF → Rate limiting (aşağıda). |

**Önerilen WAF kuralı (Cloudflare Free):**

```
Cloudflare Dashboard → Security → WAF → Rate limiting rules
  Expression:  http.request.uri.path eq "/api/collect"
  Requests:    60 / 1 min per IP
```

---

## 12. Hız sınırı (rate limit) kuralları

Worker içi sınırlar **isolate başına** çalışır (en iyi gayret). Küresel bir
sınır istiyorsanız WAF kuralı ya da `storage: "database"` gerekir (D1'de her
istekte yazma → kota maliyeti).

### 12.1 Kimlik doğrulama (Better Auth) hız sınırı

Better Auth'ın kendi hız sınırı da **isolate başına** bellekte tutulur
(`rateLimit.storage: "memory"`). Kova anahtarı istemci IP'si + yol olduğu için
**IP'nin doğru okunması** sınırın çalışması için şarttır:

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

### 12.2 Veritabanı birleştirmeleri (joins)

`advanced.database.joins: true` açıktır: Better Auth ilişkili veriyi tek
sorguda çeker (`/get-session` artık session + user + account için üç yerine
bir sorgu yapar). D1'in SQLite lehçesi JOIN desteklediği için Drizzle/Prisma
ilişki tanımları gerekmez — bunlar yalnızca o ORM'lerin kendi şemaları
içindir.

---

## 13. İzleme ve loglar

- **Canlı loglar:** `npx wrangler tail --format json`
- **Worker gözlemlenebilirliği:** `wrangler.jsonc` → `observability.enabled: true`
  (Cloudflare Dashboard → Workers → Logs).
- **Sağlık ucu:** `GET /api/health` → servis + D1 durumu.
- **Kritik olaylar:** Better Auth hız sınırı uyarıları, mail gönderim
  hataları, D1 hataları loglanır.

---

## 14. Yedekleme ve geri alma

D1 veritabanı Cloudflare'da tutulur; yedek almak için:

```bash
# D1 dökümü (SQL)
npx wrangler d1 export dynamic --remote --output backup.sql

# Geri yükleme
npx wrangler d1 execute dynamic --remote --file backup.sql
```

Sihirli numara: üretimde `ADMIN_API_KEY` ile
`GET /api/admin/sites/:id/export` (JSON) ve `DELETE /api/admin/sites/:id`
(veri silme) uçları da veri taşınabilirliği (KVKK md. 11 / GDPR 20) ve
unutulma hakkı (KVKK md. 7 / GDPR 17) için hazırdır.

---

## 15. Sorun giderme

| Belirti | Sebep / Çözüm |
| --- | --- |
| `503 media_not_configured` | `CLOUDINARY_URL` secret'ı yok. Medya kullanmıyorsanız sorun değil. |
| `401 unauthorized` (admin) | `ADMIN_API_KEY` secret'ı yok ya da `Bearer` token'ı eşleşmiyor. |
| `401 unauthorized` (super admin) | Oturum yok. `403` ise rol `admin` değil → `ADMIN_EMAILS` secret'ını kontrol edin. |
| `429 quota_exceeded` | Sitenin günlük event limiti doldu. `PATCH /api/admin/sites/:id` ile limiti yükseltin ya da `daily_event_limit`'ı düşürün. |
| `429 rate_limited` | İstek hızı yüksek. Sınır IP başına 120/dk'dir (rapor uçları 60/dk). |
| `403 origin_mismatch` | Başka bir origin'in site anahtarı gönderilmiş. |
| `403 EMAIL_NOT_VERIFIED` | E-posta doğrulanmamış. `MAIL_PROVIDER_URL`/`MAIL_PROVIDER_TOKEN` tanımlı mı? |
| Tablolar yok hatası | Migration uygulanmamış: `npx wrangler d1 migrations apply dynamic --remote`. |
| `no such column: emailVerified` | `0005_user_role.sql` uygulanmamış → migration'ları uygulayın. |
| Uygulama `/app` altında açılmıyor | Worker `dist/app`'i servis ediyor; `npm run build` sonrası `dist/app` var mı kontrol edin (`npm test` `dist/`'i temizler, sonra build alın). |
| `dist/` boş sayfa | `npm run build` çalıştırılmamış; `npm run deploy` build'i kendisi yapar. |
| Canlı sohbet açılmıyor | Reklam engelleyici betiği engelliyor olabilir; `VITE_CRISP_EAGER=1` ile test edin. |

---

## 16. Yayına çıkma kontrol listesi

- [ ] `npm run typecheck`, `npm run lint`, `npm test` temiz (46+ test).
- [ ] `npx wrangler d1 migrations apply dynamic --remote` çalıştı.
- [ ] `BETTER_AUTH_SECRET` (32+ karakter) tanımlı.
- [ ] `ADMIN_API_KEY` tanımlı ve `ADMIN_EMAILS` ilk admin'i içeriyor.
- [ ] E-posta sağlayıcı tanımlı (kullanıcı doğrulaması çalışıyor).
- [ ] `APP_URL` / `MARKETING_URL` / `MAIL_FROM` doğru.
- [ ] `app.dynamic.crty-dev.com` origin'i eklendi (ya da `/app` yolu bilinçli).
- [ ] `GET /api/health` 200 dönüyor.
- [ ] `/dashboard` yalnızca admin'e açık (normal hesapla 403).
- [ ] WAF hız sınırı kuralı eklendi.
- [ ] D1 yedeği alındı.
- [ ] Cloudinary API secret'ı rotate edildi (repoda paylaşıldıysa).

---

## 17. Güncelleme (update.bat)

Depoda tek tıkla güncelleme betiği var: kontrol → test → build → deploy →
canlı doğrulama → (isteğe bağlı) commit ve push.

```bat
update.bat                                  :: tam döngü
update.bat --skip-tests --no-deploy        :: sadece kontrol + build
update.bat --migrate --commit "mesaj" --push :: migration + commit + push
update.bat --from build                     :: sadece build ve sonrası
update.bat --help                           :: tüm seçenekler
```

Adımlar: `deps → check → test → build → migrate → deploy → verify → commit →
push`. `--migrate` uzak D1 migration'larını uygular (varsayılan: uygulanmaz,
çünkü üretim şemasını değiştirir). Betik, deploy sonrası `/api/health`,
`/api/auth/providers` ve `/app/login` uçlarını kontrol eder ve hata varsa
durur.
