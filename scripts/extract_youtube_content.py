#!/usr/bin/env python3
import os
import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter
import re

def extract_youtube_id(url):
    """Extract YouTube video ID from URL"""
    pattern = r'(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})'
    match = re.search(pattern, url)
    return match.group(1) if match else None

def get_video_transcript(video_id):
    """Get the transcript of a YouTube video"""
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        formatter = TextFormatter()
        formatted_transcript = formatter.format_transcript(transcript)
        return formatted_transcript
    except Exception as e:
        print(f"Error fetching transcript: {e}")
        return None

def save_transcript_to_file(transcript_text, filename):
    """Save transcript to a file"""
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(transcript_text)
    print(f"Transcript saved to {filename}")

def main():
    # Video URL
    video_url = "https://www.youtube.com/watch?v=56B7IBo04Oc"
    video_id = extract_youtube_id(video_url)
    
    if not video_id:
        print("Could not extract video ID from URL")
        return
    
    print(f"Video ID: {video_id}")
    
    # Get transcript
    transcript = get_video_transcript(video_id)
    
    if transcript:
        # Save transcript to file
        save_transcript_to_file(transcript, "/home/lucas/Documents/transcripts/youtube_transcript.txt")
        print("Transcript extracted successfully")
    else:
        print("Failed to extract transcript")

if __name__ == "__main__":
    main()