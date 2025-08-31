# GitHub ve Render Dağıtım Kılavuzu

## 1. GitHub'a Yükleme

### Adım 1: GitHub'da Yeni Repo Oluşturun
1. GitHub.com'a gidin ve giriş yapın
2. Sağ üst köşedeki "+" butonuna tıklayın
3. "New repository" seçin
4. Repository adı: `youtube-dublaj-app`
5. "Public" olarak ayarlayın
6. "Create repository" butonuna tıklayın

### Adım 2: Yerel Projeyi GitHub'a Bağlayın
Proje klasöründe terminal açın ve şu komutları çalıştırın:

```bash
# Git deposu başlat (zaten yapıldı)
git init

# Dosyaları staging area'ya ekle
git add .

# İlk commit
git commit -m "İlk commit: YouTube dublaj uygulaması"

# GitHub repo'sunu remote olarak ekle (YOUR_USERNAME yerine kendi kullanıcı adınızı yazın)
git remote add origin https://github.com/YOUR_USERNAME/youtube-dublaj-app.git

# Ana branch'i main olarak ayarla
git branch -M main

# GitHub'a push et
git push -u origin main
```

## 2. Render'da Dağıtım

### Adım 1: Render'a Giriş Yapın
1. render.com adresine gidin
2. GitHub hesabınızla giriş yapın

### Adım 2: Yeni Web Service Oluşturun
1. Dashboard'da "New +" butonuna tıklayın
2. "Web Service" seçin
3. GitHub repository'nizi seçin: `youtube-dublaj-app`
4. "Connect" butonuna tıklayın

### Adım 3: Yapılandırma Ayarları
Aşağıdaki ayarları yapın:

- **Name**: `youtube-dublaj-app`
- **Environment**: `Python 3`
- **Region**: `Frankfurt (EU Central)` (Türkiye'ye en yakın)
- **Branch**: `main`
- **Root Directory**: `backend`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `gunicorn app:app`

### Adım 4: Environment Variables (Ortam Değişkenleri)
"Environment" sekmesinde aşağıdaki değişkenleri ekleyin:

1. **GOOGLE_TRANSLATE_API_KEY**
   - Value: Google Translate API anahtarınız

2. **GOOGLE_TTS_API_KEY**
   - Value: Google Text-to-Speech API anahtarınız

3. **PORT**
   - Value: `10000` (Render otomatik ayarlar)

### Adım 5: Dağıtımı Başlatın
"Create Web Service" butonuna tıklayın. Render otomatik olarak:
1. Kodu GitHub'dan çeker
2. Bağımlılıkları yükler
3. Uygulamayı başlatır

## 3. API Anahtarları Nasıl Alınır

### Google Cloud Console Kurulumu
1. Google Cloud Console'a gidin: console.cloud.google.com
2. Yeni proje oluşturun veya mevcut projeyi seçin
3. "APIs & Services" > "Library" bölümüne gidin

### Google Translate API
1. "Cloud Translation API" arayın ve etkinleştirin
2. "Credentials" bölümüne gidin
3. "Create Credentials" > "API Key" seçin
4. Oluşturulan anahtarı kopyalayın

### Google Text-to-Speech API
1. "Cloud Text-to-Speech API" arayın ve etkinleştirin
2. Aynı API anahtarını kullanabilirsiniz
3. Veya yeni bir anahtar oluşturabilirsiniz

## 4. Güvenlik Notları

⚠️ **ÖNEMLİ GÜVENLİK UYARILARI:**

1. **API anahtarlarını asla kodda saklamayın**
2. **GitHub'a API anahtarlarını push etmeyin**
3. **Render'da Environment Variables kullanın**
4. **API anahtarlarını düzenli olarak yenileyin**
5. **API kullanım limitlerini kontrol edin**

## 5. Test ve Doğrulama

Dağıtım tamamlandıktan sonra:

1. Render'dan verilen URL'yi açın
2. YouTube video linki girin
3. Altyazıların yüklendiğini kontrol edin
4. Dublaj özelliğini test edin

## 6. Sorun Giderme

### Yaygın Hatalar:

1. **Build Hatası**: `requirements.txt` dosyasını kontrol edin
2. **API Hatası**: Environment variables'ları kontrol edin
3. **CORS Hatası**: Flask-CORS kurulu olduğundan emin olun
4. **YouTube API Hatası**: Video URL formatını kontrol edin

### Log Kontrolü:
Render dashboard'da "Logs" sekmesinden hata mesajlarını kontrol edebilirsiniz.

## 7. Güncellemeler

Kod değişikliği yaptığınızda:

```bash
git add .
git commit -m "Güncelleme açıklaması"
git push origin main
```

Render otomatik olarak yeni kodu dağıtacaktır.
