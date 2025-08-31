# Dublaj Senkronizasyon Kılavuzu

Bu kılavuz, gerçek zamanlı dublaj için senkronize ses çıkarma yapısının temel kalıplarını ve entegrasyon adımlarını özetler. Örnek dosya referansları mevcut proje dosyalarına göre verilmiştir: `frontend/script.js`, `background.js`, `content_script.js`.

---

## 1) Zaman Damgası ve Senkronizasyon Sistemi

- 50ms döngü ile video zamanını sürekli kontrol eder
- Seek algılama: Video atlama durumlarını yakalar (>0.5s fark)
- Hassas timing: ±50ms toleransla segmentleri eşleştirir
- Buffer yönetimi: 30s ileriye ses üretir, 10s geride temizler

Temel senkronizasyon kalıbı (örnek):
```js
// currentTime: oyuncudan gelen zaman (saniye)
const targetSegment = segments.find(seg =>
  currentTime >= (seg.baslangic - 0.05) &&
  currentTime <  (seg.bitis    + 0.05)
);
```

Uygulama yeri:
- `frontend/script.js` içinde `startDubbingSync()` fonksiyonu 100ms aralıkla kontrol ediyor. Döngü aralığını 50ms’e indirip toleransları ekleyin.
- Seek algılamayı YouTube `onStateChange` veya `onPlaybackRateChange`/`onSeek` benzeri işaretlerle ve zaman farkı ölçümüyle uygulayın.

---

## 2) Transkript İşleme Kalıbı (Segment Birleştirme)

- Cümle sonları algılanır (noktalama kontrolü)
- Maksimum 12 saniye süre ve 25 kelime limiti
- Ardışık segmentler uygun şartlarda birleştirilir
- Doğal konuşma akışı sağlanır

Birleştirme mantığı (örnek):
```js
if (!cumleSonuMu(mevcutCumle.metin) &&
    ardisikMi &&
    toplamSure   <= 12 &&
    toplamKelime <= 25) {
  // Birleştir
}
```

Uygulama yeri:
- `backend/app.py`’den gelen zaman damgalı altyazı listesi frontend’te işlenebilir.
- `frontend/script.js` içinde altyazıları dublaj öncesi preprocess ederek birleştirin.

---

## 3) Üçlü AI Sistemi

1. Google Translate: Kaynak → Hedef dil (örn. İng → Tr)
2. Gemini (opsiyonel): Metin anlamlandırma/düzeltme
3. Google TTS: Hedef dilde ses sentezi

Gemini prompt kalıbı örneği:
```text
Görev: Aşağıdaki segmenti doğal ve akıcı Türkçeye çevirip düzelt.
Kurallar: sayı okumalarını düzelt ("kare otuz dokuz" → "39"),
tekrarları temizle, süreye uygun şekilde kısalt.
Segment: {metin}
Zaman: {baslangic} - {bitis} (süre: {sure}s)
```

Uygulama yeri:
- `frontend/script.js` içinde `translateText()` sonrasına Gemini düzeltme adımını ekleyin (opsiyonel).
- API anahtarlarını asla frontend’e gömmeyin; Render ortam değişkeni veya backend proxy tavsiye edilir.

---

## 4) Dinamik Hız Ayarlama (Speaking Rate)

Konuşma hızı hesaplama:
```js
const normalKps = 140 / 60; // Normal okuma hızı (kelime/sn)
const gerekKps  = kelimeSayisi / sure;
const oran      = gerekKps / normalKps;

// Doğal hız aralığı: 0.95x - 1.25x
let speakingRate;
if (oran < 0.8)      speakingRate = 0.95;
else if (oran > 1.4) speakingRate = 1.25;
else                 speakingRate = Math.min(1.15, Math.max(0.95, oran));
```

Uygulama yeri:
- `frontend/script.js` içindeki `textToSpeech()` çağrısında `audioConfig.speakingRate` dinamik set edilmelidir.

---

## 5) Buffer Yönetimi Kalıbı

Akıllı önbellekleme:
- Geçici buffer: Aktif oynatma için (30s ileriye önceden üret)
- Kalıcı cache: Geri sarım için tut
- Hata retry: 3 deneme + artan backoff
- Bellek optimizasyonu: Eski ses URL’lerini temizle

Uygulama yeri:
- `frontend/script.js` içinde `translatedSubtitles` için iki katmanlı (aktif+cache) yapı.
- `URL.revokeObjectURL()` ile kullanılmayan blob URL’lerini serbest bırakın.

---

## 6) Ses Oynatma Senkronizasyonu

AudioPlayer sistemi:
- Video sesi ~%15’e düşürülür (veya tamamen mute)
- Dublaj sesi %100 seviyede
- Segment geçişlerinde kesintisiz oynatma
- URL temizleme ile bellek sızıntısı engellenir

Uygulama yeri:
- `frontend/script.js` → `playCurrentSubtitle()` içinde mevcut sesi durdur, yenisini başlat, ses seviyesini `volumeSlider` ile ayarla.

---

## 7) Seek/Atlama Yönetimi

Seek algılandığında yapılacaklar:
1. Mevcut sesi hemen durdur
2. Buffer’ı yeni zamana göre güncelle
3. 200ms sonra yeni segmenti bul ve oynat

Uygulama yeri:
- `onPlayerStateChange` ile `PAUSED`→`PLAYING` geçişleri ve zaman farkı kontrolü
- Gerekirse kısa debounce (200ms) kullanın.

---

## 8) Hata Yönetimi ve Retry

Sağlam API çağrıları:
- Kota/quota hatalarını yakala
- Rate limit için exponential backoff
- Maksimum 3 deneme
- Başarısız segmentleri işaretle ve UI’da göster

Örnek backoff:
```js
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const res = await fetch(url, opts);
    if (res.ok) return await res.json();
    if (res.status === 429) throw new Error('rate-limit');
  } catch (e) {
    await wait(300 * Math.pow(2, attempt - 1));
  }
}
```

---

## Ana Kalıplar Özeti

1. Zamana dayalı segment eşleme (±50ms tolerans)
2. Cümle bazlı akıllı birleştirme (12s/25 kelime limit)
3. Üçlü AI pipeline (Çeviri → Anlamlandırma → TTS)
4. Dinamik hız ayarlama (kelime/süre oranına göre)
5. Çift buffer sistemi (aktif + geri sarım)
6. Seek-aware senkronizasyon (atlama algılama)
7. Bellek optimizasyonlu ses oynatma

---

## Entegrasyon Notları (Bu Proje)

- `frontend/script.js` mevcut haliyle temel döngü, TTS ve oynatma mantığını içeriyor. Bu kılavuzdaki gelişmiş senkronizasyon için:
  - Döngü aralığını 50ms yapın ve tolerans ekleyin.
  - Ön-üretim: 30s ileriye TTS üretmek için kuyruğa alın.
  - Geri temizlik: 10s geride kalan sesleri ve URL’leri temizleyin.
  - Dinamik `speakingRate` uygulayın.
  - Seek algılandığında 200ms’lik yeniden eşleme yapın.
- API anahtarları: Güvenlik için backend proxy veya Render env vars önerilir. Frontend’den direkt çağrı kotaları ve CORS’a takılabilir.
