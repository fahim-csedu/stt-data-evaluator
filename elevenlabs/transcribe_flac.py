# transcribe_flac.py
import os
import sys
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe_flac.py /path/to/audio.flac")
        print("Example: python transcribe_flac.py audio.flac")
        print("Note: This script is configured for Bengali audio transcription")
        sys.exit(1)

    audio_path = sys.argv[1]
    language_code = "ben"  # Always use Bengali for this experiment
    
    if not os.path.isfile(audio_path):
        print(f"File not found: {audio_path}")
        sys.exit(1)

    load_dotenv()
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("Set ELEVENLABS_API_KEY in your environment or .env file.")
        sys.exit(1)

    client = ElevenLabs(api_key=api_key)

    # Open the FLAC file in binary mode
    with open(audio_path, "rb") as f:
        try:
            # Build parameters dynamically
            params = {
                "file": f,
                "model_id": "scribe_v1",
                "diarize": False,
                "tag_audio_events": False
            }
            
            # Always use Bengali for this experiment
            params["language_code"] = language_code
                
            transcription = client.speech_to_text.convert(**params)
            
        except Exception as e:
            print(f"Transcription failed: {e}")
            sys.exit(1)

    # The SDK returns a rich object/dict; print the text field if present
    text = getattr(transcription, "text", None) or transcription.get("text", "")
    print(text)

    # If you also want timestamps/words, print the full JSON:
    # import json; print(json.dumps(transcription, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()