import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assessmentFile = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadyAssessment.jsx'), 'utf-8');
const proctorHookFile = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useFaceProctoring.js'), 'utf-8');
const fullscreenHookFile = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useAssessmentFullscreen.js'), 'utf-8');
const proctorServiceFile = fs.readFileSync(path.join(__dirname, '..', 'backend', 'services', 'proctor_service.py'), 'utf-8');
const proctorRouterFile = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routers', 'proctor.py'), 'utf-8');

describe('RoleReady Person Detection, Device Monitoring & Fullscreen Enforcement Suite', () => {

    test('1. Backend YOLO model configures CPU-optimized yolov8n with person and cell phone classes', () => {
        assert.ok(proctorServiceFile.includes("yolov8n.onnx"), "Backend proctor service must point to the yolov8n.onnx model (ONNX Runtime)");
        assert.ok(proctorServiceFile.includes("face_detection_yunet"), "Backend proctor service must also use the YuNet face detector");
        assert.ok(proctorServiceFile.includes("0:  'person'"), "Class 0 must be person");
        assert.ok(proctorServiceFile.includes("67: 'cell phone'"), "Class 67 must be cell phone");
        assert.ok(proctorServiceFile.includes("get_model_status"), "Service must expose get_model_status");
        assert.ok(proctorRouterFile.includes('/status'), "Proctor router must expose /status endpoint");
    });

    test('2. Backend frame analysis computes normalized bounding boxes and suspect labels', () => {
        assert.ok(proctorServiceFile.includes("face_boxes"), "Frame analysis must return face_boxes for candidate rendering");
        assert.ok(proctorServiceFile.includes("suspect_label"), "Frame analysis must return suspect_label");
        assert.ok(proctorServiceFile.includes("multiple_persons"), "Frame analysis must detect multiple persons");
        assert.ok(proctorServiceFile.includes("phone_detected"), "Frame analysis must detect phone");
    });

    test('3. useFaceProctoring hook connects to /api/proctor/analyze-frame with 3000ms loop', () => {
        assert.ok(proctorHookFile.includes('/api/proctor/analyze-frame'), "Hook must post to /api/proctor/analyze-frame");
        assert.ok(proctorHookFile.includes('CHECK_INTERVAL_MS = 3000'), "Hook must run on 3000ms interval");
        assert.ok(proctorHookFile.includes('NO_PERSON_THRESHOLD = 3'), "Hook must use 3 consecutive checks (~9s) before no_person strike");
    });

    test('4. useFaceProctoring returns detections, faceBoxes, personCount, and model status', () => {
        assert.ok(proctorHookFile.includes('detections,'), "Hook must export detections");
        assert.ok(proctorHookFile.includes('faceBoxes,'), "Hook must export faceBoxes");
        assert.ok(proctorHookFile.includes('personCount,'), "Hook must export personCount");
        assert.ok(proctorHookFile.includes('isModelActive,'), "Hook must export isModelActive");
    });

    test('5. RoleReadyAssessment integrates useFaceProctoring and ProctorCameraFeed', () => {
        assert.ok(assessmentFile.includes("import useFaceProctoring from '../../hooks/useFaceProctoring'"), "Assessment must import useFaceProctoring");
        assert.ok(assessmentFile.includes("<ProctorCameraFeed"), "Assessment must render ProctorCameraFeed");
        assert.ok(assessmentFile.includes("suspectLabel={suspectLabel}"), "ProctorCameraFeed must receive suspectLabel");
        assert.ok(assessmentFile.includes("detections={detections}"), "ProctorCameraFeed must receive detections");
        assert.ok(assessmentFile.includes("faceBoxes={faceBoxes}"), "ProctorCameraFeed must receive faceBoxes");
    });

    test('6. ProctorCameraFeed renders mirrored diagnostic bounding boxes and YOLO status pills', () => {
        assert.ok(assessmentFile.includes("(1 - fb[2])"), "Bounding boxes must mirror horizontally for user webcam preview");
        assert.ok(assessmentFile.includes("YOLOv8n Active"), "Must display active YOLO model badge");
        assert.ok(assessmentFile.includes("Candidate Verified"), "Must label detected person with candidate verification");
    });

    test('7. Fullscreen enforcement integrates useAssessmentFullscreen and 10s recovery gate', () => {
        assert.ok(assessmentFile.includes("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen'"), "Assessment must import useAssessmentFullscreen");
        assert.ok(assessmentFile.includes("FullscreenGateModal"), "Assessment must render FullscreenGateModal");
        assert.ok(assessmentFile.includes("onRecoveryTimeout"), "Assessment must handle recovery timeout");
        assert.ok(assessmentFile.includes("Fullscreen exit exceeded 10-second recovery limit"), "Recovery timeout must trigger violation");
    });

    test('8. Universal 3-warning malpractice policy persists violations and auto-submits on 3rd strike', () => {
        assert.ok(assessmentFile.includes("MAX_MALPRACTICE_WARNINGS = 3"), "Assessment must configure 3-warning policy");
        assert.ok(assessmentFile.includes("handleAnyViolation"), "Assessment must have universal violation handler");
        assert.ok(assessmentFile.includes("Warning 1/"), "Assessment must show Warning 1 message");
        assert.ok(assessmentFile.includes("Final Warning 2/"), "Assessment must show Final Warning 2 message");
        assert.ok(assessmentFile.includes("handleAutoSubmitDueToMalpractice"), "3rd strike must trigger automatic submission");
    });

    test('9. Instructions page verifies webcam, microphone, AI Vision Model, and fullscreen rules', () => {
        assert.ok(assessmentFile.includes("/api/proctor/status"), "Instructions hardware check must query proctor status endpoint");
        assert.ok(assessmentFile.includes("AI Vision Engine (YOLOv8n)"), "Instructions must show AI Vision Engine status tile");
        assert.ok(assessmentFile.includes("Start Assessment & Enter Fullscreen"), "Instructions must provide explicit fullscreen launch action");
    });

    test('10. Dedicated Step 1 Instructions contains overview, round durations, rules, and Continue to Device Check CTA', () => {
        assert.ok(assessmentFile.includes("currentStage === 'instructions'"), "Must have dedicated instructions stage check");
        assert.ok(assessmentFile.includes("PrepWin Assessment Instructions"), "Must show instructions banner");
        assert.ok(assessmentFile.includes("Round 1"), "Must display Round 1 info");
        assert.ok(assessmentFile.includes("Round 2"), "Must display Round 2 info");
        assert.ok(assessmentFile.includes("Round 3"), "Must display Round 3 info");
        assert.ok(assessmentFile.includes("Continue to Device Check"), "Must have Continue to Device Check CTA");
        assert.ok(assessmentFile.includes("setCurrentStage('device_check')"), "Continue CTA must navigate to device_check stage");
    });

    test('11. Dedicated Step 2 Device Check requests hardware, checks YOLO status, and provides Re-test action', () => {
        assert.ok(assessmentFile.includes("currentStage === 'device_check'"), "Must have dedicated device_check stage check");
        assert.ok(assessmentFile.includes("Hardware & Proctoring Verification"), "Must show device verification header");
        assert.ok(assessmentFile.includes("Re-test Devices"), "Must provide Re-test Devices button");
        assert.ok(assessmentFile.includes("previewVideoRef"), "Must render live preview video element");
        assert.ok(assessmentFile.includes("Camera Permission Blocked"), "Must display actionable error for denied camera");
        assert.ok(assessmentFile.includes("No Camera Device Detected"), "Must display actionable error for missing camera");
    });

    test('12. Step 3 Fullscreen Confirmation verifies document.fullscreenElement and provides retry on denial', () => {
        assert.ok(assessmentFile.includes("Fullscreen Confirmation & Launch"), "Must show fullscreen confirmation guidance");
        assert.ok(assessmentFile.includes("enterFullscreen()"), "Must call enterFullscreen on launch click");
        assert.ok(assessmentFile.includes("document.fullscreenElement"), "Must explicitly verify document.fullscreenElement");
        assert.ok(assessmentFile.includes("setLaunchError"), "Must set launchError if fullscreen cannot be established");
        assert.ok(assessmentFile.includes("Retry Fullscreen & Launch"), "Must render retry button when launch fails");
    });

    test('13. Sequential Round Progression gates Coding and Interview on server-side unlocked status', () => {
        assert.ok(assessmentFile.includes("sessionData?.coding_unlocked"), "Coding stage must be gated on coding_unlocked");
        assert.ok(assessmentFile.includes("sessionData?.interview_unlocked"), "Interview stage must be gated on interview_unlocked");
        assert.ok(assessmentFile.includes("Submit Aptitude & Unlock Coding Round"), "Aptitude submission must indicate unlocking Coding");
        assert.ok(assessmentFile.includes("Submit All & Unlock Interview"), "Coding submission must indicate unlocking Interview");
        assert.ok(assessmentFile.includes("/report"), "Interview submission must redirect to report");
    });
});

