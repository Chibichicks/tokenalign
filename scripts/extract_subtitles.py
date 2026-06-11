import yt_dlp

ydl_opts = {
    'skip_download': True,
    'writeautomaticsub': True,
    'subtitleslangs': ['en'],
    'subtitlesformat': 'vtt',
    'outtmpl': 'subtitles.%(ext)s',
}

url = 'https://www.youtube.com/watch?v=56B7IBo04Oc'
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
