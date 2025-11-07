import base64
import json
import socketio
import time
import ssl
from pathlib import Path

# Socket.IO endpoint from the API spec
SOCKET_URL = "https://voice.bangla.gov.bd:9394"

# Create a Socket.IO client with SSL verification disabled
sio = socketio.Client(ssl_verify=False)

# ========== EVENT HANDLERS ==========

@sio.on('connect')
def on_connect():
    print("✅ Connected to the STT server.")

@sio.on('disconnect')
def on_disconnect():
    print("❌ Disconnected from server.")

@sio.on('result')
def on_result(data):
    """Handler for streaming recognition results"""
    print("\n🎧 Streaming Result:")
    print(json.dumps(data, indent=2, ensure_ascii=False))

@sio.on('result_upload')
def on_result_upload(data):
    """Handler for upload recognition results"""
    print("\n📄 Upload Result:")
    print(json.dumps(data, indent=2, ensure_ascii=False))


# ========== STREAMING TEST ==========

def test_streaming(audio_file_path: str, chunk_size: int = 32000):
    """
    Test the 'audio_transmit' event by sending a WAV file in chunks.
    """
    with open(audio_file_path, "rb") as f:
        data = f.read()

    chunks = [data[i:i + chunk_size] for i in range(0, len(data), chunk_size)]

    print(f"Sending {len(chunks)} chunks...")

    for i, chunk in enumerate(chunks):
        payload = {
            "index": i,
            "audio": base64.b64encode(chunk).decode('utf-8'),
            "endOfStream": i == len(chunks) - 1
        }
        sio.emit("audio_transmit", payload)
        time.sleep(0.1)  # slight delay to simulate real-time streaming

    print("✅ All chunks sent.")


# ========== FILE UPLOAD TEST ==========

def test_file_upload(audio_file_path: str):
    """
    Test the 'audio_transmit_upload' event by uploading an entire file at once.
    """
    with open(audio_file_path, "rb") as f:
        encoded_audio = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "index": 0,
        "audio": encoded_audio,
        "endOfStream": True
    }

    print("Uploading full file...")
    sio.emit("audio_transmit_upload", payload)


# ========== MAIN EXECUTION ==========

if __name__ == "__main__":
    audio_path = "azure_bn-BD-NabanitaNeural.wav"  # Path to a test WAV file
    if not Path(audio_path).exists():
        raise FileNotFoundError(f"Test file not found: {audio_path}")

    # Connect to the STT API
    sio.connect(SOCKET_URL, transports=["websocket"])

    # Run streaming test
    test_streaming(audio_path)

    # Run file upload test
    test_file_upload(audio_path)

    # Keep client alive for results
    time.sleep(10)
    sio.disconnect()