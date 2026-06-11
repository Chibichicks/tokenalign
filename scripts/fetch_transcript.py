from youtube_transcript_api import YouTubeTranscriptApi
import time

def fetch_transcript(video_id):
    try:
        # Try to get the transcript directly
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        return transcript
    except Exception as e:
        print(f"Error fetching transcript: {e}")
        return None

# Fetch the transcript for the video
video_id = '56B7IBo04Oc'
transcript = fetch_transcript(video_id)

if transcript:
    # Write the transcript to a file
    with open('/home/lucas/Documents/transcripts/video_transcript.txt', 'w') as f:
        for entry in transcript:
            f.write(f"{entry['text']} ")
    
    print("Transcript successfully saved to /home/lucas/Documents/transcripts/video_transcript.txt")
else:
    print("Failed to fetch transcript")