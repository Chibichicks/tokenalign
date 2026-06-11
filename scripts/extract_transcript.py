from youtube_transcript_api import YouTubeTranscriptApi
import json
import sys

def get_video_transcript(video_id):
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        # Combine all transcript text into a single string
        full_transcript = " ".join([entry["text"] for entry in transcript])
        return full_transcript
    except Exception as e:
        print(f"Error getting transcript: {e}")
        return None

if __name__ == "__main__":
    video_id = "56B7IBo04Oc"
    transcript = get_video_transcript(video_id)
    if transcript:
        print(transcript)
    else:
        sys.exit(1)
