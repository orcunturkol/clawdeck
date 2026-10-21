# Turkish text to speech worker for Clawdeck: JSON lines in on stdin, JSON lines out on stdout.
import json
import os
import sys
import tempfile
import time

from antalia_mini import Antalia

tts = Antalia(sys.argv[1], device="cpu", sample_rate=24000)
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    req = json.loads(line)
    try:
        start = time.time()
        fd, path = tempfile.mkstemp(prefix="clawdeck-tts-", suffix=".wav")
        os.close(fd)
        speech = tts.say(req["text"], path, seed=0)
        out = {"id": req["id"], "path": path, "duration": speech.duration, "seconds": round(time.time() - start, 2)}
    except Exception as e:
        out = {"id": req["id"], "error": str(e)}
    print(json.dumps(out), flush=True)
