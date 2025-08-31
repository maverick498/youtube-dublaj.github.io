from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import yt_dlp
import os
import re
from datetime import datetime
import requests

UA_HEADERS = {
"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
"Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
}

app = Flask(name)
CORS(app)

Statik dosyalar (lokal geliştirme kolaylığı için)
@app.route("/")
def serve_frontend():
    try:
        return send_from_directory("../frontend", "index.html")
    except Exception:
        return jsonify({"message": "Backend çalışıyor. Statik dosyalar ayrı barındırılabilir."})

@app.route("/path:filename")
def serve_static(filename):
    try:
        return send_from_directory("../frontend", filename)
    except Exception:
        return jsonify({"error": "Static file not found"}), 404

def parse_time_to_seconds(time_str: str) -> float:
    try:
        s = time_str.strip().replace(",", ".")
        parts = s.split(":")
        if len(parts) == 3:
            h = int(parts[0]); m = int(parts[1]); sec = float(parts[2])
            return h * 3600 + m * 60 + sec
        elif len(parts) == 2:
            m = int(parts[0]); sec = float(parts[1])
            return m * 60 + sec
        else:
            return float(s)
    except Exception:
        return 0.0

def clean_subtitle_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def extract_info_with_clients(video_url: str):
    """
    YouTube 'player_client' değerlerini sırayla dener.
    Çerez (YDL_COOKIES_PATH) ve header'lar kullanılır.
    """
    clients = ["web", "web_embedded", "mweb", "android", "ios", "tv_embedded", "tv"]
    last_err = None
    for client in clients:
        ydl_opts = {
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["tr", "en", "auto"],
            "subtitlesformat": "vtt",
            "skip_download": True,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": [client]}},
            "http_headers": UA_HEADERS,
        }
        cookies_path = os.environ.get("YDL_COOKIES_PATH")
        if cookies_path:
            ydl_opts["cookiefile"] = cookies_path
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
                return info, client
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"yt-dlp failed for clients {clients}. Last error: {last_err}")

@app.route("/get-subtitles", methods=["POST"])
def get_subtitles():
    try:
        data = request.get_json() or {}
        video_url = data.get("video_url")
        if not video_url:
            return jsonify({"error": "Video URL gerekli"}), 400
        if "youtube.com" not in video_url and "youtu.be" not in video_url:
            return jsonify({"error": "Geçerli bir YouTube URL'si girin"}), 400

        # Sadece çoklu client fonksiyonunu kullan
        info, used_client = extract_info_with_clients(video_url)

        video_title = info.get("title", "Bilinmeyen Video")
        video_duration = info.get("duration", 0)
        subtitles = info.get("subtitles", {}) or {}
        automatic_captions = info.get("automatic_captions", {}) or {}

        subtitle_data = None
        used_lang = None

        # Önce manuel altyazı
        for lang in ["tr", "en"]:
            if lang in subtitles:
                subtitle_data = subtitles[lang]
                used_lang = lang
                break

        # Sonra otomatik altyazı
        if not subtitle_data:
            for lang in ["tr", "en"]:
                if lang in automatic_captions:
                    subtitle_data = automatic_captions[lang]
                    used_lang = f"{lang} (otomatik)"
                    break

        if not subtitle_data:
            return jsonify({"error": "Bu video için altyazı bulunamadı"}), 404

        # VTT URL seçimi
        vtt_url = None
        for sub in subtitle_data:
            if sub.get("ext") == "vtt":
                vtt_url = sub.get("url")
                break
        if not vtt_url:
            return jsonify({"error": "VTT formatında altyazı bulunamadı"}), 404

        # VTT indirirken tarayıcı başlıkları kullan
        resp = requests.get(vtt_url, headers=UA_HEADERS, timeout=20)
        resp.raise_for_status()
        vtt_content = resp.text

        # Basit VTT parse
        subtitles_list = []
        lines = vtt_content.split("\n")
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if "-->" in line:
                parts = line.split(" --> ")
                if len(parts) == 2:
                    start_time = parse_time_to_seconds(parts[0].strip())
                    end_time = parse_time_to_seconds(parts[1].strip())
                    i += 1
                    text = ""
                    while i < len(lines) and lines[i].strip() != "":
                        text += lines[i].strip() + " "
                        i += 1
                    text = clean_subtitle_text(text)
                    if text:
                        subtitles_list.append({
                            "start_time": start_time,
                            "end_time": end_time,
                            "text": text,
                            "duration": max(0.0, end_time - start_time),
                        })
            i += 1

        if not subtitles_list:
            return jsonify({"error": "Altyazı metni parse edilemedi"}), 500

        return jsonify({
            "success": True,
            "video_title": video_title,
            "video_duration": video_duration,
            "subtitle_language": used_lang,
            "subtitles_count": len(subtitles_list),
            "subtitles": subtitles_list,
            "yt_client": used_client,
        })
    except Exception as e:
        print(f"Hata: {str(e)}")
        return jsonify({"error": f"Bir hata oluştu: {str(e)}"}), 500

@app.route("/translate", methods=["POST"])
def translate_proxy():
    try:
        payload = request.get_json() or {}
        text = payload.get("text")
        target = payload.get("target_lang")
        source = payload.get("source_lang")
        api_key = os.environ.get("GOOGLE_TRANSLATE_API_KEY")
        if not text or not target:
            return jsonify({"error": "'text' ve 'target_lang' gerekli"}), 400
        if not api_key:
            return jsonify({"error": "GOOGLE_TRANSLATE_API_KEY tanımlı değil"}), 500
        url = "https://translation.googleapis.com/language/translate/v2"
        body = {"q": text, "target": target, "format": "text"}
        if source:
            body["source"] = source
        resp = requests.post(url, params={"key": api_key}, json=body, timeout=30)
        resp.raise_for_status()
        rj = resp.json()
        translated = rj.get("data", {}).get("translations", [{}])[0].get("translatedText")
        if not translated:
            return jsonify({"error": "Çeviri sonucu alınamadı"}), 502
        return jsonify({"translatedText": translated})
    except Exception as e:
        return jsonify({"error": f"Translate hata: {str(e)}"}), 500

@app.route("/synthesize", methods=["POST"])
def tts_proxy():
    try:
        payload = request.get_json() or {}
        text = payload.get("text")
        language_code = payload.get("language_code") or "en-US"
        voice_name = payload.get("voice_name")
        speaking_rate = float(payload.get("speaking_rate", 1.0))
        pitch = float(payload.get("pitch", 0.0))
        api_key = os.environ.get("GOOGLE_TTS_API_KEY")
        if not text:
            return jsonify({"error": "'text' gerekli"}), 400
        if not api_key:
            return jsonify({"error": "GOOGLE_TTS_API_KEY tanımlı değil"}), 500
        url = "https://texttospeech.googleapis.com/v1/text:synthesize"
        body = {
            "input": {"text": text},
            "voice": {"languageCode": language_code},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate, "pitch": pitch},
        }
        if voice_name:
            body["voice"]["name"] = voice_name
        resp = requests.post(url, params={"key": api_key}, json=body, timeout=30)
        resp.raise_for_status()
        rj = resp.json()
        if "audioContent" not in rj:
            return jsonify({"error": "TTS sonucu alınamadı"}), 502
        return jsonify({"audioContent": rj["audioContent"], "encoding": "MP3"})
    except Exception as e:
        return jsonify({"error": f"TTS hata: {str(e)}"}), 500

@app.route("/gemini-polish", methods=["POST"])
def gemini_polish():
    """Opsiyonel: Gemini ile metni daha doğal hale getirir."""
    try:
        payload = request.get_json() or {}
        text = payload.get("text")
        language = payload.get("language") or ""
        if not text:
            return jsonify({"error": "'text' gerekli"}), 400
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"polished": text, "note": "GEMINI_API_KEY tanımlı değil; özgün metin döndürüldü"})
        try:
            import google.generativeai as genai
        except Exception as ie:
            return jsonify({"polished": text, "note": f"Kitaplık yok: {ie}"}), 200
        genai.configure(api_key=api_key)
        prompt = f"""
Aşağıdaki altyazı satırını hedef dilde daha doğal ve TTS için kısa tutarak yeniden yaz. Özel isimleri ve sayıları koru.
Hedef dil: {language or 'belirtilmedi'}
Metin: {text}
"""
        model = genai.GenerativeModel("gemini-1.5-pro")
        res = model.generate_content(prompt)
        polished = getattr(res, "text", None) or text
        return jsonify({"polished": polished.strip()})
    except Exception as e:
        return jsonify({"error": f"Gemini hata: {str(e)}"}), 500

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "OK", "timestamp": datetime.now().isoformat()})

if name == "main":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

