# Note: nbjones_analysis/ was removed. Update the path below if reusing.
import whisper
model = whisper.load_model('base')

# Update this path to point to your audio file
AUDIO_PATH = "/home/lucas/Documents/media/audio.wav"
OUTPUT_PATH = "/home/lucas/Documents/media/transcripts/transcript.txt"

import os
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

result = model.transcribe(AUDIO_PATH)
with open(OUTPUT_PATH, 'w') as f:
    f.write(result['text'])
print(f"Transcription completed and saved to {OUTPUT_PATH}")
