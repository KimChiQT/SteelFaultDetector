from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2
import numpy as np
import base64
import time
import sqlite3
import json
from datetime import datetime
from pathlib import Path

app = FastAPI()

# Cho phép React gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = YOLO('best.pt')

INFO_DICT = {
    'rolled_in_scale': {'vi': 'Vảy cán', 'cost': '~1 – 3 USD', 'time': '~5-10 phút'},
    'patches': {'vi': 'Đốm bề mặt', 'cost': '~1 – 4 USD', 'time': '~5-15 phút'},
    'crazing': {'vi': 'Rạn nứt', 'cost': '~3 – 8 USD', 'time': '~15-30 phút'},
    'pitted_surface': {'vi': 'Rỗ bề mặt', 'cost': '~5 – 15 USD', 'time': '~20-40 phút'},
    'inclusion': {'vi': 'Lẫn tạp chất', 'cost': '~10 – 30 USD', 'time': '~30-60 phút'},
    'scratches': {'vi': 'Vết xước', 'cost': '~0.5 – 2 USD', 'time': '~3-10 phút'}
}

# --- Simple SQLite history storage ---
# Place the DB into a stable `data/` folder next to this file so it persists across restarts
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = str(DATA_DIR / "history.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            image_base64 TEXT,
            fault_count INTEGER,
            avg_conf REAL,
            process_time REAL,
            faults_json TEXT
        )
        """
    )
    conn.commit()
    conn.close()

def save_history(image_base64, fault_count, avg_conf, process_time, faults):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    ts = datetime.utcnow().isoformat() + 'Z'
    cur.execute(
        "INSERT INTO history (timestamp, image_base64, fault_count, avg_conf, process_time, faults_json) VALUES (?,?,?,?,?,?)",
        (ts, image_base64, fault_count, avg_conf, process_time, json.dumps(faults, ensure_ascii=False)),
    )
    hid = cur.lastrowid
    conn.commit()
    conn.close()
    return hid

def list_histories(limit=100):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, timestamp, fault_count, avg_conf, process_time FROM history ORDER BY id DESC LIMIT ?", (limit,))
    rows = cur.fetchall()
    conn.close()
    return [
        {"id": r[0], "timestamp": r[1], "fault_count": r[2], "avg_conf": r[3], "process_time": r[4]} for r in rows
    ]

def get_history(hid):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, timestamp, image_base64, fault_count, avg_conf, process_time, faults_json FROM history WHERE id=?", (hid,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row[0],
        "timestamp": row[1],
        "image_base64": row[2],
        "fault_count": row[3],
        "avg_conf": row[4],
        "process_time": row[5],
        "faults": json.loads(row[6]) if row[6] else []
    }


@app.get('/history')
def history_list(limit: int = 100):
    try:
        return {"items": list_histories(limit)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/history/{history_id}')
def history_get(history_id: int):
    h = get_history(history_id)
    if not h:
        raise HTTPException(status_code=404, detail='History not found')
    return h


# initialize DB on startup
init_db()

@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    start_time = time.time()
    
    # Đọc ảnh từ React gửi lên
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    H, W, _ = img_bgr.shape
    
    # Chạy YOLO
    results = model(img_bgr)
    results[0].names[3] = 'pitted_surface'
    results[0].names[4] = 'rolled_in_scale'
    
    boxes = results[0].boxes
    detected_faults = []
    avg_conf = 0
    confidences = []

    # Cấu hình chữ và khung
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5     # Cỡ chữ nhỏ lại
    font_thickness = 1   # Độ dày chữ
    line_thickness = 2   # Độ dày viền khung (Chính là biến bị thiếu lúc nãy!)
    
    for box in boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        conf = float(box.conf[0])
        cls_id = int(box.cls[0])
        raw_name = results[0].names[cls_id]
        
        fault_info = INFO_DICT.get(raw_name, {'vi': raw_name})
        label_text = f"{raw_name} {conf:.2f}"
        
        confidences.append(conf)
        if raw_name not in [f['id'] for f in detected_faults]:
            detected_faults.append({
                'id': raw_name,
                'name': fault_info['vi'],
                'cost': INFO_DICT.get(raw_name, {}).get('cost', 'N/A'),
                'time': INFO_DICT.get(raw_name, {}).get('time', 'N/A')
            })

        color = (0, 0, 255) # Đỏ

        # Vẽ khung lỗi
        cv2.rectangle(img_bgr, (x1, y1), (x2, y2), color, line_thickness)

        # Tính toán tọa độ vẽ chữ chống tràn
        (text_w, text_h), _ = cv2.getTextSize(label_text, font, font_scale, font_thickness)
        text_x = x1
        text_y = y1 - 10

        # Nếu tràn mép trên, đẩy chữ xuống nằm trong khung
        if text_y - text_h < 0:
            text_y = y1 + text_h + 10 

        # Vẽ nền và vẽ chữ
        cv2.rectangle(img_bgr, (text_x, text_y - text_h - 5), (text_x + text_w + 5, text_y + 5), color, -1)
        cv2.putText(img_bgr, label_text, (text_x, text_y), font, font_scale, (255, 255, 255), font_thickness, cv2.LINE_AA)

    if confidences:
        avg_conf = sum(confidences) / len(confidences) * 100

    # Mã hóa ảnh sang Base64 để gửi về React
    _, buffer = cv2.imencode('.jpg', img_bgr)
    img_base64 = base64.b64encode(buffer).decode('utf-8')
    process_time = round(time.time() - start_time, 2)

    response_payload = {
        "image_base64": f"data:image/jpeg;base64,{img_base64}",
        "fault_count": len(boxes),
        "avg_conf": round(avg_conf, 1),
        "process_time": process_time,
        "faults": detected_faults
    }

    # Save to history DB and return history id
    try:
        history_id = save_history(response_payload["image_base64"], response_payload["fault_count"], response_payload["avg_conf"], response_payload["process_time"], response_payload["faults"])
        response_payload["history_id"] = history_id
    except Exception:
        # if saving fails, continue but do not block response
        response_payload["history_id"] = None

    return response_payload