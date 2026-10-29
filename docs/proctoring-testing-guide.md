# Proctoring: what changed and how to test it

Written for: the person testing the camera proctoring (phone, second person, face visibility) on a development machine.

## What changed
- **Face visibility.** "Face not visible in camera" used to fire when the YOLO model found **no whole person**. YOLO is a body detector, so a normal laptop webcam (head and shoulders) often gave zero people and the alarm repeated every ~9 seconds. Now a **face detector** (YuNet) decides whether someone is there. The alarm only fires when **both** the face detector and YOLO see nobody.
- **Phones, laptops, books** still come from YOLO (it is good at objects).
- **More than one person** now needs two clear faces, or two large and clearly separate people. A sliver of a second body at the edge does not count.
- **Speed.** YOLO runs on ONNX Runtime (no PyTorch). About 27 ms per 640x480 frame with both detectors on the development laptop, against about 92 ms before.
- **Sharper frames.** The browser sends 640x480 (was 320x240), so phones and faces are easier to find.
- **Run limit.** Run presses per candidate per minute: 10 (was 5).

## Restart so the new code runs
The backend must be restarted (the models load at start). If you started it with `uvicorn main:app ...`, stop it and start it again. The frontend dev server reloads by itself; do a normal page refresh before you start an attempt.

Check it loaded: `http://127.0.0.1:8000/api/proctor/status` must answer `{"status":"ready"}`, and the backend log should say `Model loaded: ...yolov8n.onnx (faces: on, input width 448)`. If it says `faces: off`, the face model file is missing (`backend/models/face_detection_yunet_2023mar.onnx`).

## How the browser decides (so you know what to expect)
- A frame is checked every **3 seconds**.
- **No face and no person:** 3 checks in a row (about **9 seconds**) are needed, then "Face not visible in camera" is recorded. Looking away for a moment should no longer count, a covered camera or leaving the chair should.
- **Phone / laptop / book / more than one person:** recorded **immediately** on the first frame that shows it.
- The same event is not recorded again for **8 seconds**.
- Recruitment (shared link) only **records** events and never ends the attempt. They show as "Events N" on the page and in the admin report.

## Test checklist
Do these during the coding round with the camera on, protection test mode is fine. Note what the page and the admin report say.

| Test | What to do | Expected |
|---|---|---|
| Normal sitting | Sit normally, face the screen, 2 minutes | **No** "Face not visible". (Before: dozens.) |
| Head tilted down | Look at the keyboard for a few seconds | No event unless your face leaves the frame for 9+ seconds |
| Face covered | Cover the camera or lean far out of frame for 10+ s | "Face not visible in camera" |
| Phone | Hold a phone clearly in view, screen or back toward the camera | "Mobile phone detected" within a few seconds |
| Phone, hard cases | Phone held low, at the edge, in a dim room | Note whether it is caught (these are the hard cases) |
| Second person | Have someone stand or sit behind you, face visible | "Multiple persons detected" |
| Second person, turned away | Someone behind you with their back to the camera | Usually caught as a large second person; note the result |
| Book / notes | Hold an open book in view | "Reference material or notes detected" |
| Laptop | Hold a second laptop in view | "Secondary electronic device detected" |
| Glasses, hat, dim light | Repeat the normal-sitting test | Still no false "Face not visible" |

## Tuning (only if a test shows a problem)
All are environment variables for the backend, followed by a restart:
- `PROCTOR_YOLO_WIDTH=640` makes small phones easier to catch (slower, about 2x). `320` is fastest and less sensitive. Default 448.
- `PROCTOR_THREADS` CPU threads per frame, default 2.
- Thresholds are constants at the top of `backend/services/proctor_service.py` (`FACE_SCORE_THRESHOLD`, `STRONG_FACE_SCORE`, `BIG_PERSON_MIN_AREA`, `PHONE_CONFIDENCE_THRESHOLD`).

## What has and has not been verified
Verified: the rules and pipeline with unit tests (including webcam-style crops of a sample photo: chest-up and head-and-shoulders framings are no longer flagged, two people are flagged, a plain wall is "no person"); the whole thing runs in a clean `python:3.11-slim` container with OpenCV 5.0.0.93 and ONNX Runtime, with the same results.
Not verified: real webcams in varied conditions, a phone held in view, a real second person. That is what this checklist is for. Send back what failed (a screenshot of the admin report events plus a short description of the situation) and the thresholds can be tuned.
Not measured: load on server2 with 40 simultaneous streams.
