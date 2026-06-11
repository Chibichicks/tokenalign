from youtube_transcript_api import YouTubeTranscriptApi
import json

def get_video_transcript(video_id):
    try:
        transcript_list = YouTubeTranscriptApi.get_transcripts([video_id], languages=['en'])
        transcript = transcript_list[0]  # First element contains the transcript
        full_transcript = ' '.join([part['text'] for part in transcript])
        return full_transcript
    except Exception as e:
        print(f'Error: {str(e)}')
        return None

if __name__ == "__main__":
    video_id = '56B7IBo04Oc'
    transcript = get_video_transcript(video_id)
    if transcript:
        print('Transcript extracted successfully')
        print(f'Transcript length: {len(transcript)} characters')
        print('First 500 characters:', transcript[:500])
        
        # Save transcript to file
        with open('/home/lucas/Documents/transcripts/video_transcript.txt', 'w') as f:
            f.write(transcript)
        print('Transcript saved to /home/lucas/Documents/transcripts/video_transcript.txt')
    else:
        print('Failed to extract transcript')
