# Gizlilik ve KVKK Değerlendirmesi — DYNAMIC

Bu belge, DYNAMIC'ın hangi verileri işlediğini, neden işlediğini, ne kadar
sakladığını ve veri sahibinin haklarını tanımlar. 6698 sayılı **KVKK** ve
**GDPR** açısından bir değerlendirme notu niteliğindedir; hukuki görüş yerine
geçmez. Deploy eden hesap sahibi, kendi veri sorumlusu kimliğini ve aydınlatma
metnini bu temel üzerine hazırlamalıdır.

## 1. Özet

DYNAMIC, **çerez kullanmayan**, IP saklamayan, kişisel veri toplamayan bir
web analitiği ve RUM aracıdır. Varsayılan olarak topladığı tek şey şudur:

| Veri | Neden | Saklama |
| --- | --- | --- |
| Sayfa yolu (`/pricing`) | Hangi sayfalar görüntülendi | 30 gün (varsayılan) |
| Zaman damgası | Zaman aralığı raporları | 30 gün |
| Anonim oturum id (rastgele, `sessionStorage`) | Ziyaretçi/oturum sayımı | 30 gün |
| Referrer **yalnızca host** (`news.ycombinator.com`) | Trafik kaynağı | 30 gün |
| UTM `source` / `medium` / `campaign` | Kampanya performansı | 30 gün |
| Cihaz / tarayıcı / işletim sistemi (User-Agent'ten) | Cihaz kırılımı | 30 gün |
| Ülke kodu (`cf-ipcountry`, edge'den) | Coğrafi dağılım | 30 gün |
| Web Vitals (LCP/INP/CLS/FCP/TTFB) ve rating | Performans izleme | 30 gün |
| Özel event adı ve (filtrelenmiş) proplar | Ürün analitiği / dönüşüm | 30 gün |

**Toplanmayanlar:** IP adresi, çerez, `localStorage` kimliği, kullanıcı adı,
e-posta, telefon, adres, ödeme bilgisi, form içeriği, tuş vuruşu, ekran görüntüsü,
kesin konum, cihaz parmak izi, çapraz site kimliği.

## 2. Veri minimizasyonu ve filtreleme

- **IP:** hiçbir zaman yazılmaz. Edge'den yalnızca iki harfli ülke kodu alınır.
- **Referrer:** yalnızca host saklanır (`https://news.site.com/a/b?x=1` →
  `news.site.com`).
- **Yol:** query string ve fragment atılır, yalnızca pathname saklanır.
- **Özel event propları:** anahtar listesindeki kişisel veri alanları (e-posta,
  şifre, telefon, ad, adres, token, kart, IP, koordinat, doğum tarihi vb.)
  **istemcide ve sunucuda** elenir; en fazla 8 prop, prop değeri en fazla 200
  karakter.
- **Oturum id:** rastgele üretilir, çerez değildir, `sessionStorage`'da 30
  dakika hareketsizlik sonrası yenilenir ve sayfayla birlikte silinir.

## 3. Hukuki dayanak (KVKK 5/1)

Varsayılan işleme **meşru menfaat** (KVKK md. 5/1-e) ve **sözleşmenin
ifası** (md. 5/1-f) kapsamındadır:

| İşleme | Dayanak | Açıklama |
| --- | --- | --- |
| Çereksiz, kişisel verisiz ölçüm | Meşru menfaat | Site sahibinin kendi sitesini ölçmesi; kullanıcıya zarar vermeyen, düşük etkili işleme. |
| Web Vitals ölçümü | Meşru menfaat | Performans sorunlarını bulmak. |
| Kendi etkileşimlerinin kaydı (opt-out ile) | Açık rıza / meşru menfaat | Ziyaretçi `dynamic.optOut()` diyerek toplamayı durdurabilir. |
| Kampanya (UTM) ölçümü | Meşru menfaat | Pazarlama performansı. |

**Açık rıza gerektiren bir işleme yoktur** (sağlık, biyometrik, özel nitelikli
veri işlenmez; profilleme/otomatik karar yoktur).

## 4. Çerez ve benzeri teknolojiler

- DYNAMIC **çerez kullanmaz**; `Cookie` başlığı hiçbir zaman gönderilmez.
- Oturum id `sessionStorage`'da tutulur (klasik "daha az gizli" tanımı gerektiren
  çerez değildir, çünkü sunucuya otomatik gönderilmez ve tarayıcı kapanınca
  silinir). Yine de KVKK "benzeri teknoloji" hükümleri bakımından değerlendirme
  kapsamındadır.
- Analytics çerezleri yalnızca **kendi sitenizde** kullanıyorsanız gerekir;
  DYNAMIC'in kendisi hiçbirini kurmaz.
- **Pazarlama sitesindeki canlı destek (Crisp):** Masaüstünde üçüncü taraf
  sohbet betiği sayfa ile birlikte yüklenir ve sohbet kendiliğinden açılır;
  ziyaretçi kapatabilir. Bu yüzden masaüstü ziyaretçileri için Crisp kendi
  çerezlerini kurar ve sohbet içeriğini kendi sunucularında işler. Telefonda
  sohbet paneli ekranı kapattığı için betik yalnızca "Destek" düğmesine
  basıldığında yüklenir. Bu durum DYNAMIC'in çerezsiz analitiği için
  geçerli **değildir**; sohbet, ziyaretçi kendi isteğiyle başlattığı üçüncü
  taraf bir hizmettir (bkz. bölüm 7).

## 5. Saklama ve silme

- Varsayılan saklama: **30 gün** (`sites.retention_days`).
- Silme: günlük Cloudflare Cron (`0 3 * * *`) eski olayları ve oturumları
  siler; ayrıca `POST /api/admin/sites/:id/purge` ile elle de silinebilir.
- Hesap sahibi `retention_days` değerini site başına değiştirebilir.

## 6. Veri sahibinin hakları (KVKK md. 11, GDPR md. 15–20)

| Hak | Nasıl kullanılır |
| --- | --- |
| Erişim / taşınabilirlik | `GET /api/admin/sites/:id/export` → JSON (oturumlar, olaylar, goal'lar). |
| Silme / unutulma | `DELETE /api/admin/sites/:id?confirm=<public_id>` → site ve tüm verisi silinir. |
| İşleme kısıtlama / itiraz | `info@crty-dev.com` (deploy eden hesap sahibinin iletişim adresi). |
| Verilerin bir kopyasını talep etme | Aynı export ucu (paginateli). |

Her iki uç da yalnızca yönetici bearer token'ı ile çağrılabilir.

## 7. İşleyenler ve üçüncü taraflar

| Taraf | Rol | Veri |
| --- | --- | --- |
| Cloudflare (Workers, D1, R2) | Alt işleyen / barındırıcı | Olay ve oturum satırları; IP yalnızca ağ katmanında, uygulamaya yazılmaz. |
| Cloudinary (isteğe bağlı) | Medya barındırma | Yalnızca **medya** (görsel/OG görseli). Analitik verisi Cloudinary'ye **gitmez**. |
| Crisp (pazarlama sitesindeki canlı destek) | Sohbet sağlayıcısı | Yalnızca **sohbeti başlatan ziyaretçi**: sohbet içeriği, e-posta adresi (varsa) ve Crisp'in kendi çerezleri. Ziyaretçi tıklamazsa hiçbir veri toplanmaz. |
| Better Auth (Dash / Sentinel) | Kimlik doğrulama altyapısı | Oturum ve kullanıcı verisi Better Auth tarafından işlenir; Sentinel parmak izleri yalnızca bot koruması için, proje-scope KV adresinde tutulur. |
| Alan adı kayıt sağlayıcısı | DNS | Yalnızca DNS kayıtları. |

Üçüncü taraf izleme (analytics, reklam, sosyal medya pikseli) **yoktur**; tek
istisna, ziyaretçinin kendi isteğiyle açtığı canlı destek sohbetidir.

## 7b. Uygulama (Console) verileri

| Veri | Neden | Saklama |
| --- | --- | --- |
| E-posta adresi | Hesabın kimliği | Hesap ömrü + silme talebi |
| Parola hash'i (scrypt) | Kimlik doğrulama | Hesap ömrü |
| Oturum kaydı (token, IP, UA) | Oturum yönetimi | 7 gün |
| Doğrulama / sıfırlama token'ı | Tek kullanımlık işlem | 1 saat |

- E-posta adresi toplama (yönlendirme) veya üçüncü taraf ölçümleme yoktur.
- Parolalar hiçbir zaman düz metin saklanmaz; Better Auth'in scrypt uygulaması
  kullanılır.
- Oturum çerezleri `HttpOnly`, `Secure`, `SameSite=Lax`'tir.
- **Erişim talebi:** `GET /api/admin/sites/:id/export` (JSON: oturumlar, event'ler,
  goal'lar) ve `DELETE /api/admin/sites/:id?confirm=<id>` (site + tüm verisi).
- Parola değişiminde diğer oturumlar otomatik iptal edilir.

## 8. Veri güvenliği

- Uçtan uca HTTPS (TLS), HSTS önerilir.
- Yönetim uçları bearer token ile korunur; token Worker secret store'unda tutulur
  ve repoya girmez.
- Veritabanı erişimi yalnızca Worker üzerinden; D1 bağlantısı internet'e
  açık değildir.
- Erişim kayıtları: yalnızca hata sınıfları, site kimlikleri ve sayaçlar
  loglanır; gövde, IP veya event içeriği **loglanmaz**.

## 9. Veri ihlali

- Şüpheli bir ihlal **72 saat içinde** KVKK md. 12 uyarınca ilgili veri
  sorumlusuna bildirilir.
- Deploy eden hesap sahibi kendi veri sorumlusu kimliğiyle bu yükümlülüğü
  üstlenir; DYNAMIC bir **araçtır**, veri sorumlusu değildir.

## 10. Düzenleme

Bu belge `docs/PRIVACY.md` yolunda tutulur ve her özellik değişikliğinde
güncellenir. Kullanıcıya gösterilen aydınlatma metnini bu belge temelinde
hazırlayın ve sitenizde bir **Çerez Politikası** sayfası yayımlayın
(DYNAMIC çerez kullanmasa da üçüncü taraf medya/dağıtım için gerekebilir).
