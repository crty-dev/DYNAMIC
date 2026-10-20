# Katkıda Bulunma — DYNAMIC

DYNAMIC'a katkıda bulunmak için hoş geldiniz. Bu belge geliştirme ortamını,
kullanılan araçları ve pull request sürecini anlatır.

## Lisans

Katkılarınız **MIT lisansı** ile yayımlanır (bkz. [LICENSE](LICENSE)). Üçüncü
taraf kod kopyalıyorsanız:

1. Kaynak lisansın proje ile uyumlu olduğunu doğrulayın (`npm run license:audit`).
2. Upstream telif bildirimini koruyun ve [NOTICE](NOTICE) dosyasına ekleyin.
3. PR açıklamasında "kaynak: <proje> — <lisans>" satırını yazın.

## Gereksinimler

| Araç | Sürüm |
| --- | --- |
| Node.js | 22+ (22.12 / 24.x önerilir) |
| npm | 10+ |
| Wrangler | `npx wrangler` (projeye dahil) |

Ücretli bir Cloudflare hesabı **gerekmez**; Free plan yeterlidir.

## Kurulum

```bash
git clone <repo-url>
cd DYNAMIC
npm install
cp .dev.vars.example .dev.vars   # secret'larını doldurun
npm run db:migrate:local          # yerel D1 şeması
npm run dev                       # http://localhost:5173
```

`.dev.vars` **commit edilmez** (`.gitignore`'da). Depoya gerçek secret
koymayın.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | SDK'yı derler ve Vite geliştirme sunucusunu başlatır. |
| `npm run build` | SDK + site + Worker için üretim çıktısı (`dist/`). |
| `npm run build:sdk` | Yalnızca `public/js/dynamic.js` SDK paketini üretir. |
| `npm run preview` | Üretim çıktısını `wrangler dev` ile yerelde çalıştırır. |
| `npm run typecheck` | `tsc --noEmit` (uygulama + Worker). |
| `npm run lint` | oxlint (hızlı, TypeScript 7 uyumlu). |
| `npm test` | SDK + API + build testleri (24 test). |
| `npm run license:audit` | Bağımlılık lisans tablosu. |
| `npm run brand` | Marka varlıklarını yeniden üretir. |
| `npm run cloudinary:link` | Cloudinary secret'ını bağlar (tek komut). |
| `npm run db:migrate:local` / `:remote` | D1 migration'larını uygular. |
| `npm run deploy` | Worker'ı Cloudflare'a yayınlar. |

## Kod stili

- **TypeScript strict** — `any` kullanmayın; bilinmeyen bir tip gerekiyorsa
  `unknown` + daraltma kullanın.
- **Worker tarafında** Hono + zod şemaları; SQL **her zaman** parametreli
  (`?`/`$1`) ve `site_id` + zaman aralığı ile sınırlı.
- **İstemci tarafında** ölçülebilir değişiklikler: yeni bağımlılık eklemeden
  önce gerekçelendirin (paket boyutu Free plan için önemli).
- Değişken adları `camelCase`, dosyalar `kebab-case.ts` / `PascalCase.tsx`.
- Biçimlendirme: 2 boşluk, satır sonu 100 karakter, çift tırnak.

## Veritabanı değişiklikleri

- Yeni migration **her zaman** yeni bir dosya olarak eklenir
  (`migrations/000N_...sql`); uygulanmış migration'ı **düzenlemeyin**.
- Migration'da `CREATE INDEX` kullanırken hangi sorguyu hızlandırdığını yorum
  satırıyla belirtin.
- `sessions` tablosunu gerekçesiz silmeyin; ziyaretçi sayıları bu tablodan
  gelir.

## Test

PR göndermeden önce:

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` gerçek `wrangler dev` + yerel D1 üzerinde çalışır; API testleri
mock kullanmaz. Yeni bir uç ekliyorsanız `tests/api.test.mjs` içine karşılık
gelen bir kontrol ekleyin.

## Pull request süreci

1. **Issue önce**: büyük değişiklikler için kısa bir issue açın.
2. Bir dal açın: `feat/…`, `fix/…`, `docs/…`.
3. Küçük ve odaklı değişiklikler yapın (tek PR'da iki konu yok).
4. Testleri ve dokümantasyonu güncelleyin.
5. PR açıklamasında: **ne** değişti, **neden**, **nasıl doğrulandı**.
6. İki onay ve yeşil CI sonrası birleştirilir.

## Güvenlik bulguları

Güvenlik açıklarını **public issue olarak açmayın**. Süreç için
[SECURITY.md](SECURITY.md) dosyasına bakın.

## Davranış kuralları

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) uygulanır.
