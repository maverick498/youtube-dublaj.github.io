// ==== Senkronize Dublaj Mantığı (Gelişmiş) ====
// - 50ms zaman döngüsü + seek algılama
// - Segment birleştirme (<=12s ve <=25 kelime)
// - Üçlü AI pipeline: Translate -> (opsiyonel) Gemini -> TTS
// - Dinamik konuşma hızı (kelime/saniye oranına göre)
// - Çift buffer: 30s ileri üretim, 10s geride temizleme

// Global durum
let player;
let subtitles = [];
let mergedSubtitles = [];
let translatedSubtitles = []; // sadece UI gösterimi için
let currentSubtitleIndex = -1;
let isDubbingActive = false;
let dubbingInterval = null;
let currentAudio = null;
let audioContext = null;

// Konfig ve sabitler
const SYNC_INTERVAL_MS = 50;
const TOLERANCE = 0.05; // ±50ms tolerans
const SEEK_THRESHOLD = 0.5; // >0.5s fark seek kabul
const BUFFER_AHEAD_SEC = 30; // 30s ileriye üret
const CLEANUP_BEHIND_SEC = 10; // 10s geriyi temizle
const MAX_RETRIES = 3;
const NORMAL_WPM = 140; // normal okuma
const NORMAL_KPS = NORMAL_WPM / 60.0; // kelime/saniye

// API anahtarları (yalnızca fallback için)
let apiKeys = { translate: '', tts: '' };
let backendBaseUrl = '';
let geminiEnabled = true; // Backend varsa çeviri sonrası Gemini cilası dene

// Bellek/Cache
const audioCache = new Map(); // key: seg index -> { url, blob, translated, rate }
const inFlight = new Set(); // üretilmekte olan segment indeksleri
const retryCounts = new Map();

// DOM elemanları
const videoUrlInput = document.getElementById('videoUrl');
const loadVideoBtn = document.getElementById('loadVideo');
const targetLanguageSelect = document.getElementById('targetLanguage');
const loadingIndicator = document.getElementById('loadingIndicator');
const statusMessage = document.getElementById('statusMessage');
const videoContainer = document.getElementById('videoContainer');
const subtitleInfo = document.getElementById('subtitleInfo');
const currentSubtitleDiv = document.getElementById('currentSubtitle');
const startDubbingBtn = document.getElementById('startDubbing');
const stopDubbingBtn = document.getElementById('stopDubbing');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');

// YouTube IFrame hazır olduğunda çağrılır (global callback)
function onYouTubeIframeAPIReady() {
  console.log('YouTube IFrame API hazır');
}

// Olay bağlama
window.addEventListener('DOMContentLoaded', () => {
  loadVideoBtn.addEventListener('click', loadVideo);
  startDubbingBtn.addEventListener('click', startDubbing);
  stopDubbingBtn.addEventListener('click', stopDubbing);
  volumeSlider.addEventListener('input', updateVolume);
  videoUrlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadVideo(); });
  loadSavedConfig();
});

function loadSavedConfig() {
  apiKeys.translate = localStorage.getItem('translateApiKey') || '';
  apiKeys.tts = localStorage.getItem('ttsApiKey') || '';
  backendBaseUrl = (localStorage.getItem('backendBaseUrl') || '').replace(/\/$/, '');
  if (!backendBaseUrl || !apiKeys.translate || !apiKeys.tts) {
    document.getElementById('apiConfig').classList.remove('hidden');
    setupApiConfig();
  }
}

function setupApiConfig() {
  const translateApiKeyInput = document.getElementById('translateApiKey');
  const ttsApiKeyInput = document.getElementById('ttsApiKey');
  const backendBaseUrlInput = document.getElementById('backendBaseUrl');
  const saveApiKeysBtn = document.getElementById('saveApiKeys');

  translateApiKeyInput.value = apiKeys.translate;
  ttsApiKeyInput.value = apiKeys.tts;
  backendBaseUrlInput.value = backendBaseUrl;

  const save = () => {
    apiKeys.translate = translateApiKeyInput.value.trim();
    apiKeys.tts = ttsApiKeyInput.value.trim();
    backendBaseUrl = backendBaseUrlInput.value.trim().replace(/\/$/, '');
    if (apiKeys.translate) localStorage.setItem('translateApiKey', apiKeys.translate);
    if (apiKeys.tts) localStorage.setItem('ttsApiKey', apiKeys.tts);
    if (backendBaseUrl) localStorage.setItem('backendBaseUrl', backendBaseUrl);
    showStatus('Ayarlar kaydedildi!', 'success');
    document.getElementById('apiConfig').classList.add('hidden');
  };
  saveApiKeysBtn.addEventListener('click', save);
}

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function ensurePlayer(videoId) {
  if (player) {
    player.loadVideoById(videoId);
    return;
  }
  player = new YT.Player('youtubePlayer', {
    videoId,
    playerVars: { autoplay: 0, controls: 1, modestbranding: 1 },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

function onPlayerReady() {
  videoContainer.classList.remove('hidden');
  startDubbingBtn.disabled = false;
  stopDubbingBtn.disabled = true;
  // İstenirse düşük ses: player.setVolume(15);
  player.mute();
  updateVolume();
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && isDubbingActive) {
    startDubbingSync();
  } else if (event.data === YT.PlayerState.PAUSED && isDubbingActive) {
    pauseDubbing();
  }
}

async function loadVideo() {
  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) return showStatus('Lütfen bir YouTube video linki girin!', 'error');
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return showStatus('Geçerli bir YouTube video linki girin!', 'error');

  showLoading(true); showStatus('');
  try {
    const resp = await fetch((backendBaseUrl || '') + '/get-subtitles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Altyazı yüklenirken hata');

    subtitles = data.subtitles || [];
    mergedSubtitles = mergeSubtitles(subtitles);
    translatedSubtitles = [];

    updateVideoInfo(data);
    ensurePlayer(videoId);
    showStatus('Altyazılar alındı. Dublaja hazır.', 'success');
  } catch (e) {
    console.error(e);
    showStatus('Altyazı alınamadı: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}

function updateVideoInfo(data) {
  document.getElementById('videoTitle').textContent = data.video_title;
  document.getElementById('videoDuration').textContent = formatTime(data.video_duration);
  document.getElementById('subtitleLanguage').textContent = data.subtitle_language;
  document.getElementById('subtitleCount').textContent = (mergedSubtitles.length || data.subtitles_count);
  subtitleInfo.classList.remove('hidden');
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

async function startDubbing() {
  if (!player || !mergedSubtitles.length) return showStatus('Önce bir video yükleyin!', 'error');
  isDubbingActive = true;
  startDubbingBtn.disabled = true;
  stopDubbingBtn.disabled = false;
  player.mute();
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

  showStatus('Dublaj başlatılıyor...', 'success');
  currentSubtitleDiv.classList.remove('hidden');

  // Başlangıç buffer ını doldur
  const ct = player.getCurrentTime ? player.getCurrentTime() : 0;
  scheduleBuffering(ct);
  cleanupOldAudio(ct);

  startDubbingSync();
}

function computeSpeakingRate(text, durationSec) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 1;
  const gerekKps = words / Math.max(0.5, durationSec);
  const oran = gerekKps / NORMAL_KPS;
  if (oran < 0.8) return 0.95;
  if (oran > 1.4) return 1.25;
  return Math.min(1.15, Math.max(0.95, oran));
}

function mergeSubtitles(segs) {
  const arr = (segs || []).slice().sort((a,b) => a.start_time - b.start_time);
  const result = [];
  const isSentenceEnd = (txt) => /[\.!?…]$/.test((txt || '').trim());
  let cur = null;
  for (const s of arr) {
    if (!cur) { cur = { start_time: s.start_time, end_time: s.end_time, text: s.text }; continue; }
    const gap = s.start_time - cur.end_time;
    const combinedDur = s.end_time - cur.start_time;
    const combinedText = (cur.text + ' ' + s.text).trim();
    const words = combinedText.split(/\s+/).filter(Boolean).length;
    const ardisikMi = gap >= -0.05 && gap <= 0.6; // hafif bindirme toleransı
    if (!isSentenceEnd(cur.text) && ardisikMi && combinedDur <= 12 && words <= 25) {
      // Birleştir
      cur.end_time = s.end_time;
      cur.text = combinedText;
    } else {
      result.push(cur);
      cur = { start_time: s.start_time, end_time: s.end_time, text: s.text };
    }
  }
  if (cur) result.push(cur);
  return result;
}

function findCurrentSubtitleIndex(currentTime) {
  for (let i = 0; i < mergedSubtitles.length; i++) {
    const seg = mergedSubtitles[i];
    if (currentTime >= (seg.start_time - TOLERANCE) && currentTime < (seg.end_time + TOLERANCE)) {
      return i;
    }
  }
  return -1;
}

function scheduleBuffering(currentTime) {
  // 30s ileriye kadar üretim
  const aheadLimit = currentTime + BUFFER_AHEAD_SEC;
  for (let i = 0; i < mergedSubtitles.length; i++) {
    const seg = mergedSubtitles[i];
    if (seg.start_time >= currentTime - 0.5 && seg.start_time <= aheadLimit) {
      prepareSegment(i);
    }
  }
}

function cleanupOldAudio(currentTime) {
  for (const [i, rec] of audioCache.entries()) {
    const seg = mergedSubtitles[i];
    if (!seg) continue;
    if (seg.end_time < (currentTime - CLEANUP_BEHIND_SEC)) {
      try { if (rec.url) URL.revokeObjectURL(rec.url); } catch (_) {}
      audioCache.delete(i);
    }
  }
}

async function prepareSegment(index) {
  if (audioCache.has(index) || inFlight.has(index)) return;
  inFlight.add(index);
  const seg = mergedSubtitles[index];
  const targetLang = targetLanguageSelect.value;
  try {
    let translatedText = await translateText(seg.text, targetLang);
    translatedText = await polishTextWithGemini(translatedText, targetLang);
    const rate = computeSpeakingRate(translatedText, Math.max(0.2, seg.end_time - seg.start_time));
    const audioBlob = await textToSpeechWithRate(translatedText, targetLang, rate);
    const url = audioBlob ? URL.createObjectURL(audioBlob) : null;
    audioCache.set(index, { url, blob: audioBlob, translated: translatedText, rate });
  } catch (err) {
    const cur = retryCounts.get(index) || 0;
    if (cur < MAX_RETRIES) {
      retryCounts.set(index, cur + 1);
      const backoff = 500 * Math.pow(2, cur);
      setTimeout(() => { inFlight.delete(index); prepareSegment(index); }, backoff);
      return;
    }
    console.warn('Segment hazırlanamadı:', index, err);
  } finally {
    inFlight.delete(index);
  }
}

function startDubbingSync() {
  if (dubbingInterval) clearInterval(dubbingInterval);
  let lastVideoTime = player.getCurrentTime ? player.getCurrentTime() : 0;
  dubbingInterval = setInterval(() => {
    if (!isDubbingActive || !player) return;
    const currentTime = player.getCurrentTime();

    // Seek algılama
    if (Math.abs(currentTime - lastVideoTime) > SEEK_THRESHOLD) {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      scheduleBuffering(currentTime);
    }
    lastVideoTime = currentTime;

    // Buffer yönetimi
    scheduleBuffering(currentTime);
    cleanupOldAudio(currentTime);

    const newIndex = findCurrentSubtitleIndex(currentTime);
    if (newIndex !== currentSubtitleIndex) {
      currentSubtitleIndex = newIndex;
      if (currentSubtitleIndex >= 0 && currentSubtitleIndex < mergedSubtitles.length) {
        playCurrentSubtitle(currentTime);
      }
    }
    updateSubtitleDisplay(currentTime);
  }, SYNC_INTERVAL_MS);
}

function playCurrentSubtitle(currentTime) {
  const seg = mergedSubtitles[currentSubtitleIndex];
  const cache = audioCache.get(currentSubtitleIndex);
  if (!seg) return;

  // Mevcut sesi durdur
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  if (cache && cache.url) {
    currentAudio = new Audio(cache.url);
    currentAudio.volume = volumeSlider.value / 100;
    const offset = Math.max(0, currentTime - seg.start_time);
    currentAudio.addEventListener('loadedmetadata', () => {
      try {
        if (currentAudio.duration && offset < currentAudio.duration - 0.05) {
          currentAudio.currentTime = offset;
        }
      } catch (_) {}
      currentAudio.play().catch(err => console.error('Ses oynatma hatası:', err));
    });
    // iOS/Android uyumluluk: hemen play deneyin
    currentAudio.play().catch(() => {});
  }

  // UI güncelle
  const translated = (cache && cache.translated) || seg.text;
  document.getElementById('originalText').textContent = seg.text;
  document.getElementById('translatedText').textContent = translated;
}

function updateSubtitleDisplay(currentTime) {
  if (currentSubtitleIndex >= 0 && currentSubtitleIndex < mergedSubtitles.length) {
    const s = mergedSubtitles[currentSubtitleIndex];
    const progress = ((currentTime - s.start_time) / (s.end_time - s.start_time)) * 100;
    document.getElementById('progressFill').style.width = Math.max(0, Math.min(100, progress)) + '%';
    document.getElementById('timeInfo').textContent = `${formatTime(currentTime)} / ${formatTime(s.end_time)}`;
  }
}

function pauseDubbing() {
  if (currentAudio) currentAudio.pause();
  if (dubbingInterval) { clearInterval(dubbingInterval); dubbingInterval = null; }
}

function stopDubbing() {
  isDubbingActive = false;
  startDubbingBtn.disabled = false;
  stopDubbingBtn.disabled = true;
  if (player) player.unMute();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (dubbingInterval) { clearInterval(dubbingInterval); dubbingInterval = null; }
  currentSubtitleDiv.classList.add('hidden');
  currentSubtitleIndex = -1;
  // URL’leri temizle (ekstra temizlik)
  for (const [, rec] of audioCache.entries()) { try { if (rec.url) URL.revokeObjectURL(rec.url); } catch (_) {} }
  audioCache.clear();
  inFlight.clear();
  retryCounts.clear();
  showStatus('Dublaj durduruldu', 'success');
}

function updateVolume() {
  const volume = volumeSlider.value;
  volumeValue.textContent = volume + '%';
  if (currentAudio) currentAudio.volume = volume / 100;
}

function showLoading(show) { loadingIndicator.classList.toggle('hidden', !show); }
function showStatus(message, type = '') {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message';
  if (type) statusMessage.classList.add(type);
  statusMessage.style.display = message ? 'block' : 'none';
}

// ==== AI Çağrıları ====
async function translateText(text, targetLang) {
  // Tercihen backend proxy
  if (backendBaseUrl) {
    try {
      const resp = await fetch(backendBaseUrl + '/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target_lang: targetLang })
      });
      const data = await resp.json();
      if (resp.ok && data.translatedText) return data.translatedText;
    } catch (e) { console.warn('Backend translate hatası:', e); }
  }
  // Fallback: doğrudan Google Translate (anahtar tarayıcıda tutulur, üretim için önerilmez)
  if (!apiKeys.translate) return text;
  try {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKeys.translate}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: targetLang, format: 'text' })
    });
    const data = await response.json();
    if (data.data && data.data.translations && data.data.translations[0]) {
      return data.data.translations[0].translatedText;
    }
    return text;
  } catch (error) {
    console.error('Çeviri hatası:', error);
    return text;
  }
}

async function polishTextWithGemini(text, targetLang) {
  if (!backendBaseUrl || !geminiEnabled) return text;
  try {
    const resp = await fetch(backendBaseUrl + '/gemini-polish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: targetLang })
    });
    const data = await resp.json();
    if (data.polished) return data.polished; // ok/note
    return text;
  } catch (e) {
    console.warn('Gemini polish kullanılamadı:', e);
    return text;
  }
}

async function textToSpeechWithRate(text, lang, rate) {
  // Tercihen backend proxy
  if (backendBaseUrl) {
    try {
      const resp = await fetch(backendBaseUrl + '/synthesize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language_code: getLanguageCode(lang),
          voice_name: getVoiceName(lang),
          speaking_rate: rate,
          pitch: 0.0
        })
      });
      const data = await resp.json();
      if (resp.ok && data.audioContent) {
        const audioData = atob(data.audioContent);
        const audioArray = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) audioArray[i] = audioData.charCodeAt(i);
        return new Blob([audioArray], { type: 'audio/mp3' });
      }
    } catch (e) { console.warn('Backend TTS hatası:', e); }
  }
  // Fallback: doğrudan Google TTS (anahtar tarayıcıda tutulur, üretim için önerilmez)
  if (!apiKeys.tts) return null;
  try {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKeys.tts}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: getLanguageCode(lang), name: getVoiceName(lang) },
        audioConfig: { audioEncoding: 'MP3', speakingRate: rate, pitch: 0.0 }
      })
    });
    const data = await response.json();
    if (data.audioContent) {
      const audioData = atob(data.audioContent);
      const audioArray = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) audioArray[i] = audioData.charCodeAt(i);
      return new Blob([audioArray], { type: 'audio/mp3' });
    }
    return null;
  } catch (error) {
    console.error('TTS hatası:', error);
    return null;
  }
}

function getLanguageCode(lang) {
  const map = { 'tr': 'tr-TR','en': 'en-US','es': 'es-ES','fr': 'fr-FR','de': 'de-DE','it': 'it-IT','pt': 'pt-BR','ru': 'ru-RU','ja': 'ja-JP','ko': 'ko-KR','zh': 'zh-CN','ar': 'ar-XA' };
  return map[lang] || 'en-US';
}

function getVoiceName(lang) {
  const voices = {
    'tr': 'tr-TR-Wavenet-A', 'en': 'en-US-Wavenet-D', 'es': 'es-ES-Wavenet-A',
    'fr': 'fr-FR-Wavenet-A', 'de': 'de-DE-Wavenet-A', 'it': 'it-IT-Wavenet-A',
    'pt': 'pt-BR-Wavenet-A', 'ru': 'ru-RU-Wavenet-A', 'ja': 'ja-JP-Wavenet-A',
    'ko': 'ko-KR-Wavenet-A', 'zh': 'zh-CN-Wavenet-A', 'ar': 'ar-XA-Wavenet-A'
  };
  return voices[lang] || voices['en'];
}
