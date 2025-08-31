# YouTube Videolarını Gerçek Zamanlı Dublajlama (Render + GitHub)

Bu rehber, bir YouTube videosunu sağlanan altyazıları kullanarak farklı dillere gerçek zamanlı olarak dublaj yapabilen bir web uygulamasını sıfırdan kurman ve Render üzerinde herkese açık şekilde yayınlaman için uçtan uca adımları içerir. Hedef kitle başlangıç seviyesidir; her adım uygulanabilir ve örnek kodlarla desteklenmiştir.

Genel akış:
- Frontend: Kullanıcıdan YouTube linki alır, videoyu YouTube IFrame Player API ile oynatır ve dublajı senkron çalar.
- Backend (Render): Frontend’ten aldığı video linki için yt-dlp ile zaman damgalı altyazıları çeker ve JSON olarak döner. Opsiyonel olarak Translate/TTS çağrılarını proxy’ler ve Gemini ile metni cilalar.
- Frontend (İşlem): Altyazı cümlelerini hedef dile çevirir, metinden sese dönüştürür ve doğru zamanda oynatır. (Opsiyonel) Gemini ile akıcılık düzenleme.

---

## Bölüm 1: Yerel Geliştirme Ortamının Kurulumu

- Proje Klasörü:
  - Bu repo masaüstünde `Render` klasörü altında çalışır. Yapı:
    - `backend/`: Flask API ve Render servis ayarları
    - `frontend/`: HTML+CSS+JS ile arayüz
    - `.gitignore`, `README.md`, `Senkronizasyon-Kilavuzu.md`, `deployment-guide.md`

- Git Başlatma (Render klasöründe):
  - `git init`
  - `.gitignore` zaten eklidir ve sanal ortam, log, IDE dosyalarını ignorlar.

- Python Sanal Ortam ve Bağımlılıklar (backend klasöründe):
  - `python -m venv venv`
  - Windows: `venv\Scripts\activate`  |  macOS/Linux: `source venv/bin/activate`
  - `pip install -r requirements.txt`

Not: Yerel geliştirmede backend `http://127.0.0.1:5000`, frontend dosyaları ise doğrudan dosya sistemi veya bir statik server üzerinden servis edilebilir. Backend, lokal kolaylık için `../frontend` dizininden dosya sunmayı da dener.

---

## Bölüm 2: Backend Geliştirme (Python & Flask)

- Kurulu paketler: `Flask`, `flask-cors`, `yt-dlp`, `gunicorn`, `requests`, `google-generativeai` (Gemini için)

- API Dosyası: `backend/app.py`
  - `POST /get-subtitles` — Body `{ "video_url": "..." }`
    - yt-dlp ile videonun manuel veya otomatik altyazılarını (TR/EN öncelikli) bulur.
    - VTT altyazıyı indirir, her satırı zaman damgalarıyla parse eder.
    - Dönüş: `{ success, video_title, video_duration, subtitle_language, subtitles_count, subtitles:[{start_time,end_time,text}] }`
  - `POST /translate` (opsiyonel proxy) — Body `{ text, target_lang, source_lang? }`
    - Sunucuda `GOOGLE_TRANSLATE_API_KEY` ile Google Translate REST API çağrısı yapar.
    - Dönüş: `{ translatedText }`
  - `POST /synthesize` (opsiyonel proxy) — Body `{ text, language_code, voice_name?, speaking_rate?, pitch? }`
    - Sunucuda `GOOGLE_TTS_API_KEY` ile Google Text-to-Speech REST API çağrısı yapar ve base64 MP3 döner.
    - Dönüş: `{ audioContent, encoding: 'MP3' }`
  - `POST /gemini-polish` (opsiyonel) — Body `{ text, language? }`
    - `GEMINI_API_KEY` ile Google Generative AI (Gemini) kullanarak çeviri metnini TTS’e uygun, doğal ve kısa hale getirir.
    - Dönüş: `{ polished }`
  - `GET /health` — Sağlık kontrolü.

- Hata yönetimi:
  - Geçersiz/eksik URL, altyazı bulunamadı, VTT parse edilemedi vb. durumlarda uygun HTTP 4xx/5xx döner.

- Dağıtım Hazırlığı:
  - `backend/requirements.txt` hazırdır.
  - Render başlangıç komutu: `gunicorn app:app`
  - Örnek servis dosyası: `backend/render.yaml`

---

## Bölüm 3: Frontend Geliştirme (HTML, CSS, JavaScript)

- HTML İskeleti: `frontend/index.html`
  - Girdi alanı (YouTube URL), hedef dil seçimi ve durum göstergeleri.
  - YouTube IFrame Player API entegre: `<script src="https://www.youtube.com/iframe_api"></script>`
  - API Yapılandırma alanı:
    - Backend URL (Render’daki backend adresiniz)
    - (İsteğe bağlı) Translate/TTS API anahtarları (yalnızca doğrudan Google çağrısı yapılacaksa)

- JavaScript Mantığı: `frontend/script.js`
  - Backend’den `/get-subtitles` ile altyazı çekimi.
  - Her altyazı için sırasıyla:
    - Çeviri: Önce backend `/translate`; olmazsa doğrudan Google Translate.
    - (Opsiyonel) Gemini: `/gemini-polish` ile metin cilalama (backend varsa).
    - TTS: Önce backend `/synthesize`; olmazsa doğrudan Google TTS.
  - Senkronizasyon:
    - YouTube oynatıcıdan `currentTime` alınır, ilgili altyazı segmenti tespit edilir ve üretilen ses oynatılır.
    - Basit bir `setInterval` döngüsü ile 100 ms aralıklarla eşleme yapılır.

- Güvenlik Notu:
  - Anahtarları frontend’de saklamak güvenli değildir; üretimde backend proxy kullanılmalıdır.
  - Render’da backend’e ekleyin: `GOOGLE_TRANSLATE_API_KEY`, `GOOGLE_TTS_API_KEY`, `GEMINI_API_KEY` (opsiyonel).

---

## Bölüm 4: GitHub ve Render Üzerinden Dağıtım

- GitHub’a Yükleme (Render klasöründe):
  - `git init`
  - `git add .`
  - `git commit -m "YouTube dublaj başlangıç"`
  - GitHub’da boş bir repo oluşturun (ör: `youtube-dublaj`)
  - `git remote add origin https://github.com/KULLANICI_ADINIZ/youtube-dublaj.git`
  - `git branch -M main`
  - `git push -u origin main`

- Render’da Backend (Web Service):
  - Render → New → Web Service → GitHub repo’yu seçin.
  - Root Directory: `backend`
  - Build Command: `pip install -r requirements.txt`
  - Start Command: `gunicorn app:app`
  - Environment → Add Environment Variable:
    - `PYTHON_VERSION` = `3.11.0`
    - (Önerilir) `GOOGLE_TRANSLATE_API_KEY` = `...`
    - (Önerilir) `GOOGLE_TTS_API_KEY` = `...`
    - (Opsiyonel) `GEMINI_API_KEY` = `...`
  - Deploy → `https://<service-adı>.onrender.com/health` ile kontrol edin.

- Render’da Frontend (Static Site) — En Basit Yöntem:
  - New → Static Site → Aynı repo’yu seçin.
  - Root Directory: `frontend`
  - Build Command: boş
  - Publish Directory: `.`
  - Deploy → `https://<site-adı>.onrender.com` açıldığında “API Yapılandırması” bölümünden “Backend URL” alanına backend servis adresinizi yazın ve kaydedin.

- Alternatif (tek servis):
  - Flask ile frontend’i de servis etmek mümkündür ancak Render’da “Static Site + Web Service” ayrımı daha basit ve ölçeklenebilir.

---

## Sık Karşılaşılan Sorunlar

- Altyazı bulunamadı: Her videoda manuel/otomatik altyazı olmayabilir. Farklı bir video deneyin.
- Çeviri/TTS çalışmıyor: Backend env değişkenlerini eklediğinizden emin olun. Frontend’de Backend URL doğru mu?
- CORS: `flask-cors` aktif; yine de domain’lerinizin doğru olduğundan emin olun.
- Performans: Örnek uygulama hızlı başlangıç için ilk 10 altyazıyı hazırlar. `frontend/script.js` içinde artırabilirsiniz.

---

## Dosya Referansları

- `backend/app.py:1` — Flask API ve endpoint’ler (get-subtitles, translate, synthesize, gemini-polish)
- `backend/requirements.txt:1` — Gerekli paketler (Gemini dahil)
- `backend/render.yaml:1` — Render servis örnek yapılandırması
- `frontend/index.html:1` — HTML arayüz ve API yapılandırma alanı
- `frontend/script.js:1` — İş mantığı, çeviri/TTS/Gemini ve senkronizasyon
- `frontend/style.css:1` — Temel stiller
\n\n---\n\n## Senkronizasyon Özeti\n- Zamanlama: 50ms döngü, ±50ms tolerans, >0.5s seek algılama\n- Segment Birleştirme: Cümle sonu kontrolü, <=12s süre ve <=25 kelime limiti\n- AI Pipeline: Translate → (opsiyonel) Gemini → TTS\n- Dinamik Hız: Normal 140 WPM baz alınarak konuşma hızı 0.95x–1.25x\n- Buffer: 30s ileriye ses üretimi, 10s geride URL temizleme\n- Retry: Hatalı segmentlerde 3 deneme + artan backoff\n
