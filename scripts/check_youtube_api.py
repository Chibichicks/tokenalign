from youtube_transcript_api import YouTubeTranscriptApi
import time

def main():
    print("Checking YouTubeTranscriptApi methods...")
    video_id = '56B7IBo04Oc'
    
    try:
        # Get the transcript
        transcript = YouTubeTranscriptApi.list_transcripts(video_id)
        print("Successfully accessed the YouTubeTranscriptApi")
        
        # Try to get English transcript
        transcript_list = transcript.find_transcript(['en'])
        transcript_data = transcript_list.fetch()
        
        # Write the transcript to a file
        with open('/home/lucas/Documents/transcripts/video_transcript.txt', 'w') as f:
            for entry in transcript_data:
                f.write(f"{entry['text']} ")
        
        print("Transcript successfully saved to /home/lucas/Documents/transcripts/video_transcript.txt")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()