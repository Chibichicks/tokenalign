import yt_dlp
import json

ydl_opts = {
    'format': 'best',
    'writesubtitles': True,
    'writeautomaticsub': True,
    'subtitleslangs': ['en'],
}

url = 'https://www.youtube.com/watch?v=56B7IBo04Oc'
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    print("Title:", info.get('title'))
    print("Description:", info.get('description'))
    print("Duration:", info.get('duration'))
