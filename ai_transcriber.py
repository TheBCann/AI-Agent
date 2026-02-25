import sounddevice as sd
import numpy as np
import soundfile as sf
import sys
import time
import os
import collections
import whisper
import argparse

# 🛑 NEW: CLI Argument Parsing
parser = argparse.ArgumentParser()
parser.add_argument("--cli", action="store_true", help="Run once, print only text, and exit.")
args = parser.parse_args()

SAMPLE_RATE = 16000  
CHUNK_DURATION = 0.1 
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION)
VOLUME_THRESHOLD = 0.02 

is_running = True

if not args.cli:
    print("🧠 Loading AI Transcription Model...")
# Suppress whisper's internal print statements in CLI mode
old_stdout = sys.stdout 
if args.cli: sys.stdout = open(os.devnull, 'w')
ai_model = whisper.load_model("base")
if args.cli: sys.stdout = old_stdout

class LiveVAD:
    def __init__(self, k: int):
        self.k_budget = k
        self.current_k = k
        self.is_speaking = False
        self.audio_buffer = []
        self.pre_roll_buffer = collections.deque(maxlen=5) 

    def process_frame(self, bit: int, indata: np.ndarray):
        if not args.cli:
            print(bit, end="", flush=True)

        if bit == 1:
            self.current_k = self.k_budget
            if not self.is_speaking:
                if not args.cli: print("\n\n[🗣️ Recording...] ", end="", flush=True)
                self.is_speaking = True
                self.audio_buffer.extend(self.pre_roll_buffer)
            self.audio_buffer.append(indata.copy())
                
        else: # bit == 0
            if self.is_speaking:
                self.current_k -= 1
                self.audio_buffer.append(indata.copy())
                if self.current_k < 0:
                    self._save_and_transcribe()
            else:
                self.pre_roll_buffer.append(indata.copy())

    def _save_and_transcribe(self):
        if not self.audio_buffer: return
            
        filename = f"temp_speech_{int(time.time())}.wav"
        full_audio = np.concatenate(self.audio_buffer, axis=0)
        sf.write(filename, full_audio, SAMPLE_RATE)
        filepath = os.path.abspath(filename)
        
        result = ai_model.transcribe(filepath, fp16=False)
        transcription = result["text"].strip()
        
        if os.path.exists(filepath):
            os.remove(filepath)
            
        # 🛑 NEW: If in CLI mode, ONLY print the transcription and force exit immediately
        if args.cli:
            print(transcription)
            os._exit(0) 
        else:
            if transcription: print(f"\n📝 AI Note: \"{transcription}\"")
            self.is_speaking = False
            self.current_k = self.k_budget
            self.audio_buffer = []

vad_engine = LiveVAD(k=15)

def audio_callback(indata, frames, time, status):
    if not is_running: raise sd.CallbackStop()
    volume = np.linalg.norm(indata) / np.sqrt(len(indata))
    current_bit = 1 if volume > VOLUME_THRESHOLD else 0
    vad_engine.process_frame(current_bit, indata)

def main():
    global is_running 
    if not args.cli:
        print(f"🎤 Stream active (Threshold: {VOLUME_THRESHOLD}, k: {vad_engine.k_budget})")
    
    try:
        with sd.InputStream(callback=audio_callback, channels=1, samplerate=SAMPLE_RATE, blocksize=CHUNK_SIZE):
            while is_running: sd.sleep(100)
    except KeyboardInterrupt:
        is_running = False
        os._exit(0)

if __name__ == "__main__":
    main()
