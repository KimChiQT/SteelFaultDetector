import React, { useState, useRef, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import jsPDF from 'jspdf';

ChartJS.register(ArcElement, Tooltip, Legend);

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

const CRITERIA_WEIGHTS = {
  cost: 0.608,
  time: 0.120,
  area: 0.272,
};

function computePairWeights(a) {
  const c1 = 1 + 1 / a;
  const c2 = a + 1;
  const wSua = ((1 / c1) + (a / c2)) / 2;
  const wBo = (((1 / a) / c1) + (1 / c2)) / 2;
  return { wSua, wBo };
}

function decideRepairOrScrap({ aCost, aTime, aArea }) {
  const { wSua: wSuaCost, wBo: wBoCost } = computePairWeights(aCost);
  const { wSua: wSuaTime, wBo: wBoTime } = computePairWeights(aTime);
  const { wSua: wSuaArea, wBo: wBoArea } = computePairWeights(aArea);

  const scoreSua =
    CRITERIA_WEIGHTS.cost * wSuaCost +
    CRITERIA_WEIGHTS.time * wSuaTime +
    CRITERIA_WEIGHTS.area * wSuaArea;

  const scoreBo =
    CRITERIA_WEIGHTS.cost * wBoCost +
    CRITERIA_WEIGHTS.time * wBoTime +
    CRITERIA_WEIGHTS.area * wBoArea;

  const decision = scoreSua > scoreBo ? 'Nên SỬA CHỮA' : 'Nên BỎ';

  return { scoreSua, scoreBo, decision };
}

export default function App() {
  const [page, setPage] = useState('home');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [aCost, setACost] = useState(3);
  const [aTime, setATime] = useState(3);
  const [aArea, setAArea] = useState(3);
  const [decisionResult, setDecisionResult] = useState(null);
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [history, setHistory] = useState([]);
  const [totalAnalyses, setTotalAnalyses] = useState(0);
  const [totalFaults, setTotalFaults] = useState(0);
  const [scanHistory, setScanHistory] = useState([]);
  const [lastScanId, setLastScanId] = useState(null);
  const fileInputRef = useRef(null);
  const statsChartRef = useRef(null);

  // Load persisted history on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ds_history');
      if (raw) setHistory(JSON.parse(raw));
      const ta = localStorage.getItem('ds_totalAnalyses');
      if (ta) setTotalAnalyses(Number(ta));
      const tf = localStorage.getItem('ds_totalFaults');
      if (tf) setTotalFaults(Number(tf));
      const sh = localStorage.getItem('ds_scanHistory');
      if (sh) setScanHistory(JSON.parse(sh));
    } catch (e) {
      console.error('Failed to load persisted history', e);
    }
  }, []);

  // Persist history whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('ds_history', JSON.stringify(history));
      localStorage.setItem('ds_totalAnalyses', String(totalAnalyses));
      localStorage.setItem('ds_totalFaults', String(totalFaults));
      localStorage.setItem('ds_scanHistory', JSON.stringify(scanHistory));
    } catch (e) {
      console.error('Failed to persist history', e);
    }
  }, [history, totalAnalyses, totalFaults, scanHistory]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return alert("Vui lòng tải ảnh lên trước!");
    setLoading(true);
    setPage('report');

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(`${API_BASE_URL}/analyze`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      setReportData(data);
      // Save scan entry (persist each analysis)
      try {
        const entry = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          fileName: selectedFile?.name || null,
          image_base64: data.image_base64 || null,
          fault_count: data.fault_count,
          faults: data.faults,
          avg_conf: data.avg_conf,
          process_time: data.process_time,
          decision: null,
          scoreSua: null,
          scoreBo: null,
          aCost: Number(aCost),
          aTime: Number(aTime),
          aArea: Number(aArea),
        };
        setScanHistory((s) => [entry, ...s]);
        setLastScanId(entry.id);
      } catch (e) {
        console.error('Failed to record scan entry', e);
      }
    } catch (error) {
      console.error("Lỗi kết nối API:", error);
      alert("Không thể kết nối đến AI. Hãy chắc chắn backend đang chạy.");
      setPage('home');
    }
    setLoading(false);
  };

  const viewScan = (id) => {
    const s = scanHistory.find((x) => x.id === id);
    if (s) {
      const rd = {
        image_base64: s.image_base64 || null,
        fault_count: s.fault_count,
        faults: s.faults,
        avg_conf: s.avg_conf,
        process_time: s.process_time,
      };
      setReportData(rd);
      setACost(s.aCost ?? 3);
      setATime(s.aTime ?? 3);
      setAArea(s.aArea ?? 3);
      if (s.decision) {
        setDecisionResult({ scoreSua: s.scoreSua, scoreBo: s.scoreBo, decision: s.decision });
      } else {
        setDecisionResult(null);
      }
      setLastScanId(s.id);
      setPage('report');
      return;
    }

    // If not found locally, try loading from backend history endpoint
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/history/${id}`);
        if (!res.ok) throw new Error('Not found');
        const h = await res.json();
        const rd = {
          image_base64: h.image_base64 || null,
          fault_count: h.fault_count,
          faults: h.faults || [],
          avg_conf: h.avg_conf,
          process_time: h.process_time,
        };
        // add to local scanHistory for quicker access next time
        const entry = {
          id: h.id,
          timestamp: h.timestamp,
          fileName: null,
          image_base64: h.image_base64,
          fault_count: h.fault_count,
          faults: h.faults || [],
          avg_conf: h.avg_conf,
          process_time: h.process_time,
          decision: null,
          scoreSua: null,
          scoreBo: null,
          aCost: 3,
          aTime: 3,
          aArea: 3,
        };
        setScanHistory((sarr) => [entry, ...sarr]);
        setReportData(rd);
        setDecisionResult(null);
        setLastScanId(h.id);
        setPage('report');
      } catch (err) {
        console.error('Failed to fetch history from backend', err);
        alert('Không tìm thấy quét cả trên máy hoặc server');
      }
    })();
  };

  // Load histories from backend and append to local scanHistory
  const loadRemoteHistories = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/history`);
      if (!res.ok) throw new Error('Failed to fetch');
      const j = await res.json();
      const items = j.items || [];
      // For each item, fetch its details (image + faults)
      const details = await Promise.all(items.map(async (it) => {
        try {
          const r2 = await fetch(`${API_BASE_URL}/history/${it.id}`);
          if (!r2.ok) return null;
          const d = await r2.json();
          return {
            id: d.id,
            timestamp: d.timestamp,
            fileName: null,
            image_base64: d.image_base64,
            fault_count: d.fault_count,
            faults: d.faults || [],
            avg_conf: d.avg_conf,
            process_time: d.process_time,
            decision: null,
            scoreSua: null,
            scoreBo: null,
            aCost: 3,
            aTime: 3,
            aArea: 3,
          };
        } catch (e) {
          return null;
        }
      }));
      const filtered = details.filter(Boolean);
      if (filtered.length === 0) return alert('Không có lịch sử trên server');
      // merge with existing local scanHistory but avoid duplicates by id
      setScanHistory((prev) => {
        const existingIds = new Set(prev.map(p => p.id));
        const merged = [...filtered.filter(f => !existingIds.has(f.id)), ...prev];
        return merged;
      });
      alert(`Đã tải ${filtered.length} mục từ server`);
    } catch (err) {
      console.error('Error loading remote histories', err);
      alert('Lấy lịch sử từ server thất bại');
    }
  };

  const resetApp = () => {
    setPage('home');
    setSelectedFile(null);
    setPreviewUrl(null);
    setReportData(null);
    setACost(3);
    setATime(3);
    setAArea(3);
    setDecisionResult(null);
  };

  const handleDecision = () => {
    const result = decideRepairOrScrap({
      aCost: Number(aCost),
      aTime: Number(aTime),
      aArea: Number(aArea),
    });
    setDecisionResult(result);

    // Update history & metrics when a decision is made for the current report
    if (reportData) {
      setHistory((prev) => {
        const newHistory = [...prev];
        const decisionIsRepair = result.decision === 'Nên SỬA CHỮA';

        reportData.faults.forEach((fault) => {
          const name = fault.name;
          const idx = newHistory.findIndex((h) => h.name === name);
          if (idx === -1) {
            newHistory.push({
              name,
              scansWithFault: 1,
              occurrences: 1,
              repairsCount: decisionIsRepair ? 1 : 0,
              scrapsCount: decisionIsRepair ? 0 : 1,
            });
          } else {
            newHistory[idx].scansWithFault += 1;
            newHistory[idx].occurrences += 1;
            if (decisionIsRepair) newHistory[idx].repairsCount += 1;
            else newHistory[idx].scrapsCount += 1;
          }
        });

        return newHistory;
      });

      setTotalAnalyses((v) => v + 1);
      setTotalFaults((v) => v + (reportData.fault_count || reportData.faults.length));
    }

    // Attach decision to last scan entry if present
    if (lastScanId) {
      setScanHistory((prev) => prev.map((s) => s.id === lastScanId ? { ...s, decision: result.decision, scoreSua: result.scoreSua, scoreBo: result.scoreBo } : s));
    }
  };

  const handleAdminLogin = () => {
    try {
      const pwd = window.prompt('Nhập mật khẩu ADMIN để chỉnh sửa AHP:');
      if (!pwd) return;
      // NOTE: placeholder password. Replace with secure auth for production.
      if (pwd === 'admin123') {
        setAdminLoggedIn(true);
        alert('Đăng nhập admin thành công — bạn có thể chỉnh sửa AHP.');
      } else {
        alert('Mật khẩu sai');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAdminLogout = () => {
    if (!confirm('Đăng xuất admin?')) return;
    setAdminLoggedIn(false);
  };

  const handleExportCSV = () => {
    if (!history || history.length === 0) return alert('Không có dữ liệu lịch sử để xuất.');

    const rows = [];
    rows.push(['Tên lỗi', 'Số lần quét', 'Tần suất lỗi', 'Tỷ lệ số lượng lỗi(%)', '% sửa lỗi', '% loại bỏ']);
    history.forEach((h) => {
      const scans = h.scansWithFault || 0;
      const freq = totalAnalyses > 0 ? `${scans}/${totalAnalyses}` : '0/0';
      const pctCount = totalFaults > 0 ? ((h.occurrences / totalFaults) * 100).toFixed(1) + '%' : '0%';
      const pctRepair = scans > 0 ? ((h.repairsCount / scans) * 100).toFixed(1) + '%' : '0%';
      const pctScrap = scans > 0 ? ((h.scrapsCount / scans) * 100).toFixed(1) + '%' : '0%';
      rows.push([h.name, String(scans), freq, pctCount, pctRepair, pctScrap]);
    });

    const csvContent = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'history.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportChartPNG = () => {
    if (!statsChartRef.current) return alert('Không có biểu đồ để xuất');
    const url = statsChartRef.current.toBase64Image();
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chart.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportChartPDF = () => {
    if (!statsChartRef.current) return alert('Không có biểu đồ để xuất');
    const url = statsChartRef.current.toBase64Image();
    const pdf = new jsPDF({ orientation: 'landscape' });
    // addImage(imageData, format, x, y, width, height)
    pdf.addImage(url, 'PNG', 10, 10, 280, 150);
    pdf.save('chart.pdf');
  };

  const clearHistory = () => {
    if (!confirm('Xóa toàn bộ lịch sử?')) return;
    setHistory([]);
    setTotalAnalyses(0);
    setTotalFaults(0);
    setScanHistory([]);
    try {
      localStorage.removeItem('ds_history');
      localStorage.removeItem('ds_totalAnalyses');
      localStorage.removeItem('ds_totalFaults');
      localStorage.removeItem('ds_scanHistory');
    } catch (e) {
      console.error('Failed to clear persisted history', e);
    }
  };

  function inferCauseAndImprovement(name) {
    const n = (name || '').toLowerCase();
    if ((n.includes('tr') && n.includes('y')) || n.includes('scratch') || n.includes('trầy')) {
      return {
        cause: 'Do va chạm / ma sát trong quá trình vận chuyển hoặc xử lý',
        improvement: 'Tăng biện pháp bảo vệ bề mặt, dùng đệm, cải thiện thao tác bốc xếp',
      };
    }
    if (n.includes('gỉ') || n.includes('rust')) {
      return {
        cause: 'Do oxy hóa / ẩm ướt trong bảo quản',
        improvement: 'Cải thiện điều kiện lưu kho (chống ẩm), xử lý chống gỉ trước khi lưu',
      };
    }
    if (n.includes('nứt') || n.includes('crack')) {
      return {
        cause: 'Ứng suất cơ học hoặc lỗi quá trình nhiệt',
        improvement: 'Kiểm soát quá trình gia công, giảm ứng suất, kiểm tra nhiệt xử lý',
      };
    }
    return {
      cause: 'Cần kiểm tra thực tế để xác định nguyên nhân chính xác',
      improvement: 'Ghi nhận ảnh mẫu, tập hợp dữ liệu để phân tích sâu hơn',
    };
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Top Header */}
      <header className="flex justify-between items-center px-10 py-4 bg-white shadow-sm">
        <div className="flex items-center space-x-2">
          <div className="bg-blue-600 text-white p-2 rounded-lg">🛡️</div>
          <h1 className="text-xl font-black text-blue-900 tracking-tight">DETECTSTEEL</h1>
        </div>
        <div className="flex items-center space-x-4">
          <button onClick={() => setPage('home')} className={`text-sm font-medium ${page === 'home' ? 'text-blue-600' : 'text-slate-500'}`}>Trang chủ</button>
          <button onClick={() => setPage('history')} className={`text-sm font-medium ${page === 'history' ? 'text-blue-600' : 'text-slate-500'}`}>Lịch sử</button>
          <button onClick={() => setPage('stats')} className={`text-sm font-medium ${page === 'stats' ? 'text-blue-600' : 'text-slate-500'}`}>Thống kê</button>
        </div>
      </header>

      {/* --- MÀN HÌNH HOME --- */}
      {page === 'home' && (
        <main className="max-w-5xl mx-auto mt-12 px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-slate-900">
              Hệ thống nhận diện Thép <span className="text-blue-600">AI</span>
            </h2>
            <p className="text-slate-500 mt-2">Tải lên hình ảnh lô thép để bắt đầu phân tích thời gian thực</p>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-lg border border-slate-100 mx-auto max-w-3xl">
            <div
              className="border-2 border-dashed border-slate-300 rounded-2xl p-16 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition"
              onClick={() => fileInputRef.current.click()}
            >
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
              <div className="bg-blue-100 text-blue-600 p-4 rounded-xl mb-4 text-2xl">↑</div>
              <h3 className="font-bold text-lg">Chọn hoặc kéo thả ảnh</h3>
              <p className="text-slate-400 text-sm mt-1">Hỗ trợ JPG, PNG (Tải nhiều ảnh cùng lúc)</p>
              {previewUrl && <p className="text-green-600 mt-4 font-semibold">✅ Đã chọn ảnh: {selectedFile.name}</p>}
            </div>

            <button
              onClick={handleAnalyze}
              className="w-full mt-6 bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 font-bold py-4 rounded-xl transition duration-300"
            >
              🖼️ Bắt đầu nhận diện
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6 mt-10 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h4 className="font-bold text-sm mb-2">THỜI GIAN THỰC</h4>
              <p className="text-xs text-slate-500 leading-relaxed">Mọi kết quả đều được đóng dấu thời gian chính xác lúc phân tích.</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h4 className="font-bold text-sm mb-2">YOLO AI</h4>
              <p className="text-xs text-slate-500 leading-relaxed">Tự động khoanh vùng và phát hiện lỗi bề mặt thép.</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h4 className="font-bold text-sm mb-2">BÁO CÁO CHUẨN</h4>
              <p className="text-xs text-slate-500 leading-relaxed">Xuất dữ liệu dưới dạng thông số kỹ thuật chi tiết.</p>
            </div>
          </div>
        </main>
      )}

      {/* --- MÀN HÌNH HISTORY --- */}
      {page === 'history' && (
        <main className="max-w-6xl mx-auto mt-6 px-6">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setPage('home')} className="text-slate-500 hover:text-blue-600 font-semibold text-sm flex items-center">← QUAY LẠI</button>
            <div className="flex items-center gap-2">
              <button onClick={handleExportCSV} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-md text-xs border">⬇️ Xuất CSV</button>
              <button onClick={loadRemoteHistories} className="bg-green-50 hover:bg-green-100 text-green-700 px-3 py-2 rounded-md text-xs border">🔁 Tải từ server</button>
              <button onClick={clearHistory} className="bg-red-50 hover:bg-red-100 text-red-700 px-3 py-2 rounded-md text-xs border">🗑️ Xóa lịch sử</button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100">
            <h2 className="text-lg font-bold mb-4">Lịch sử quét (mỗi lần phân tích)</h2>
            {scanHistory.length === 0 ? (
              <p className="text-slate-500 text-sm">Chưa có quét nào.</p>
            ) : (
              <div className="space-y-3 text-xs">
                {scanHistory.map((s) => (
                  <div key={s.id} className="p-3 border rounded-lg flex gap-3">
                    {/* thumbnail */}
                    <div className="w-24 h-16 bg-slate-100 rounded overflow-hidden flex-shrink-0">
                      {s.image_base64 ? (
                        // eslint-disable-next-line jsx-a11y/img-redundant-alt
                        <img src={s.image_base64} alt="thumb" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">No image</div>
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold">{new Date(s.timestamp).toLocaleString()}</div>
                          <div className="text-slate-500">Tệp: {s.fileName || '—'} · Lỗi: {s.fault_count} · Thời gian: {s.process_time}s</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{s.decision || 'Chưa quyết định'}</div>
                          {s.scoreSua != null && <div className="text-slate-500">S: {s.scoreSua.toFixed(3)} · B: {s.scoreBo.toFixed(3)}</div>}
                          <button onClick={() => viewScan(s.id)} className="mt-2 w-full ml-0 bg-blue-600 text-white text-xs px-3 py-1 rounded">Xem báo cáo</button>
                        </div>
                      </div>

                      {s.faults && s.faults.length > 0 && (
                        <div className="mt-2 text-slate-600">
                          <div className="font-semibold text-xs">Chi tiết lỗi:</div>
                          <ul className="list-disc pl-5">
                            {s.faults.map((f, i) => (
                              <li key={i} className="text-xs">{f.name} — {f.id} ({f.cost}, {f.time})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {/* --- MÀN HÌNH THỐNG KÊ --- */}
      {page === 'stats' && (
        <main className="max-w-6xl mx-auto mt-6 px-6">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setPage('home')} className="text-slate-500 hover:text-blue-600 font-semibold text-sm flex items-center">← QUAY LẠI</button>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100">
            <h2 className="text-lg font-bold mb-4">Thống kê lỗi (Biểu đồ thanh)</h2>

            {scanHistory.length === 0 ? (
              <p className="text-slate-500 text-sm">Chưa có dữ liệu để hiển thị thống kê.</p>
            ) : (
              (() => {
                // Aggregate occurrences per fault name from scanHistory
                const counts = {};
                scanHistory.forEach(s => {
                  (s.faults || []).forEach(f => {
                    counts[f.name] = (counts[f.name] || 0) + 1;
                  });
                });
                const labels = Object.keys(counts);
                const values = labels.map(l => counts[l]);
                const total = values.reduce((a, b) => a + b, 0) || 1;
                const data = {
                  labels,
                  datasets: [
                    {
                      data: values,
                      backgroundColor: ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'],
                      hoverOffset: 6,
                    },
                  ],
                };
                return (
                  <div className="w-full">
                    <div className="flex gap-2 mb-3">
                      <button onClick={handleExportChartPNG} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-md text-xs border">⬇️ Xuất PNG</button>
                      <button onClick={handleExportChartPDF} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-md text-xs border">⬇️ Xuất PDF</button>
                    </div>
                    <div className="max-w-lg mx-auto">
                      <Pie ref={statsChartRef} data={data} />
                    </div>

                    <div className="mt-4 text-xs text-slate-600">
                      <p>Tổng số phân tích: <span className="font-semibold">{totalAnalyses}</span></p>
                      <p>Tổng số lỗi ghi nhận: <span className="font-semibold">{totalFaults}</span></p>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </main>
      )}

      {/* --- MÀN HÌNH REPORT --- */}
      {page === 'report' && (
        <main className="max-w-6xl mx-auto mt-6 px-6">
          <div className="flex justify-between items-center mb-8">
            <button onClick={resetApp} className="text-slate-500 hover:text-blue-600 font-semibold text-sm flex items-center">
              ← QUAY LẠI
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleExportCSV} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-md text-xs border">⬇️ Xuất CSV</button>
              <button onClick={handlePrint} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-md text-xs border">🖨️ In báo cáo</button>
              <button onClick={resetApp} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold text-sm transition shadow-md flex items-center">
                🔄 QUÉT LẠI
              </button>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-3xl font-black text-blue-900 border-l-4 border-blue-600 pl-4 tracking-tight">BÁO CÁO NHẬN DIỆN CHI TIẾT</h2>
            <p className="text-slate-500 mt-2 text-sm flex items-center gap-2">
              📅 Hoàn tất lúc: {new Date().toLocaleTimeString()} {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          {loading ? (
            <div className="text-center py-20"><p className="text-xl font-bold text-blue-600 animate-pulse">AI Đang phân tích hình ảnh...</p></div>
          ) : reportData && (
            <div className="grid grid-cols-[1.2fr_1fr] gap-8">
              {/* Cột trái: Ảnh */}
              <div className="bg-white p-2 rounded-3xl shadow-lg border border-slate-100 relative">
                <div className="absolute top-6 left-6 bg-blue-600 text-white text-xs font-bold px-4 py-1.5 rounded-full z-10 shadow-md">
                  ẢNH PHÂN TÍCH #1
                </div>
                <img src={reportData.image_base64} alt="Analyzed" className="w-full h-auto rounded-2xl object-cover" />
              </div>

              {/* Cột phải: Thống kê y hệt hình + AHP quyết định Sửa/Bỏ */}
              <div className="bg-white p-8 rounded-3xl shadow-lg border border-slate-100 space-y-8">
                {/* Block 1 */}
                <h3 className="text-blue-800 font-bold text-sm mb-4 flex items-center gap-2">⏱ THỐNG KÊ DỮ LIỆU</h3>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <p className="text-xs text-blue-600 font-bold mb-1">SỐ LƯỢNG LỖI</p>
                    <p className="text-3xl font-black">{reportData.fault_count} <span className="text-sm font-normal text-slate-400">điểm</span></p>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <p className="text-xs text-blue-600 font-bold mb-1">ĐỘ CHÍNH XÁC</p>
                    <p className="text-3xl font-black text-green-500">{reportData.avg_conf}%</p>
                  </div>
                </div>

                {/* Block 2 */}
                <h3 className="text-yellow-600 font-bold text-sm mb-4 flex items-center gap-2">🕒 THÔNG TIN THỜI GIAN</h3>
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-4 mb-8">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Thời gian hoàn tất:</span>
                    <span className="font-bold bg-orange-50 text-orange-700 px-3 py-1 rounded-md text-xs border border-orange-100">
                      {new Date().toLocaleTimeString()} {new Date().toLocaleDateString('en-GB')}
                    </span>
                  </div>
                  <hr className="border-slate-200" />
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">⚡ Tốc độ xử lý:</span>
                    <span className="font-bold">{reportData.process_time}s</span>
                  </div>
                </div>

                {/* Block 3: Cảnh báo */}
                <div>
                  <h3 className="text-red-600 font-bold text-sm mb-4 flex items-center gap-2">⚠️ LỖI & CẢNH BÁO</h3>
                  {reportData.fault_count === 0 ? (
                    <div className="text-green-600 font-bold bg-green-50 p-3 rounded-lg border border-green-200 text-sm text-center">
                      Bề mặt an toàn, không phát hiện khuyết tật.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reportData.faults.map((fault, idx) => (
                        <div key={idx} className="bg-red-50 border border-red-100 rounded-xl p-4">
                          <p className="font-bold text-red-700 text-sm mb-2">{fault.name} ({fault.id})</p>
                          <p className="text-xs text-slate-600 mb-1">• Chi phí sửa chữa: <span className="font-bold">{fault.cost}</span></p>
                          <p className="text-xs text-slate-600">• Thời gian xử lý: <span className="font-bold">{fault.time}</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Block 4: Hệ hỗ trợ quyết định AHP */}
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                  <h3 className="text-blue-800 font-bold text-sm mb-3 flex items-center gap-2">
                    🧠 HỆ HỖ TRỢ QUYẾT ĐỊNH (AHP)
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Đánh giá mức độ tốt hơn của phương án <span className="font-semibold">SỬA CHỮA</span> so với <span className="font-semibold">BỎ</span> trên thang 1–5.
                  </p>

                  <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-600">AHP: so sánh sửa đổi và loại bỏ (chỉ admin mới chỉnh sửa)</div>
                      <div className="text-xs">
                        {!adminLoggedIn ? (
                          <button onClick={handleAdminLogin} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded border">Đăng nhập</button>
                        ) : (
                          <button onClick={handleAdminLogout} className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded border">Đăng xuất Admin</button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-slate-600">
                        <p className="font-semibold">Về CHI PHÍ</p>
                        <p>Sửa tốt hơn Bỏ bao nhiêu lần?</p>
                      </div>
                      <select
                        value={aCost}
                        onChange={(e) => setACost(e.target.value)}
                        disabled={!adminLoggedIn}
                        className="border border-slate-300 rounded-lg text-xs px-2 py-1 bg-white"
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-slate-600">
                        <p className="font-semibold">Về THỜI GIAN</p>
                        <p>Sửa tốt hơn Bỏ bao nhiêu lần?</p>
                      </div>
                      <select
                        value={aTime}
                        onChange={(e) => setATime(e.target.value)}
                        disabled={!adminLoggedIn}
                        className="border border-slate-300 rounded-lg text-xs px-2 py-1 bg-white"
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-slate-600">
                        <p className="font-semibold">Về DIỆN TÍCH LỖI</p>
                        <p>Sửa tốt hơn Bỏ bao nhiêu lần?</p>
                      </div>
                      <select
                        value={aArea}
                        onChange={(e) => setAArea(e.target.value)}
                        disabled={!adminLoggedIn}
                        className="border border-slate-300 rounded-lg text-xs px-2 py-1 bg-white"
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={handleDecision}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition"
                  >
                    TƯ VẤN QUYẾT ĐỊNH
                  </button>

                  {decisionResult && (
                    <div className="mt-4 text-xs space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Điểm Sửa Chữa:</span>
                        <span className="font-bold text-blue-700">
                          {decisionResult.scoreSua.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Điểm Loại Bỏ:</span>
                        <span className="font-bold text-blue-700">
                          {decisionResult.scoreBo.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-2 text-center font-bold text-sm">
                        {decisionResult.decision === 'Nên SỬA CHỮA' ? (
                          <span className="text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg">
                            ✅ {decisionResult.decision}
                          </span>
                        ) : (
                          <span className="text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-lg">
                            ⚠️ {decisionResult.decision}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Block 5: Bảng lịch sử truy xuất */}
                <div className="bg-white p-4 rounded-xl border border-slate-100 mt-4">
                  <h3 className="text-sm font-bold mb-3"> BẢNG TỔNG QUAN</h3>
                  <div className="text-xs overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-slate-600">
                          <th className="py-2">Tên lỗi</th>
                          <th className="py-2">Số lần quét</th>
                          <th className="py-2">Tần suất lỗi</th>
                          <th className="py-2">Tỷ lệ số lượng lỗi(%)</th>
                          <th className="py-2">Tỷ lệ sửa lỗi(%)</th>
                          <th className="py-2">Tỷ lệ loại bỏ(%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-4 text-center text-slate-500">Chưa có dữ liệu lịch sử</td>
                          </tr>
                        ) : (
                          history.map((h, idx) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="py-2 font-semibold">{h.name}</td>
                              <td className="py-2">{h.scansWithFault}</td>
                              <td className="py-2">{totalAnalyses > 0 ? `${h.scansWithFault}/${totalAnalyses}` : '0/0'}</td>
                              <td className="py-2">{totalFaults > 0 ? ((h.occurrences / totalFaults) * 100).toFixed(1) + '%' : '0%'}</td>
                              <td className="py-2">{h.scansWithFault > 0 ? ((h.repairsCount / h.scansWithFault) * 100).toFixed(1) + '%' : '0%'}</td>
                              <td className="py-2">{h.scansWithFault > 0 ? ((h.scrapsCount / h.scansWithFault) * 100).toFixed(1) + '%' : '0%'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Block 6: Kết luận & Cải tiến */}
                <div className="bg-gradient-to-r from-indigo-50 via-pink-50 to-yellow-50 border border-transparent p-6 rounded-2xl mt-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-pink-500">KẾT LUẬN &amp; CẢI TIẾN</h3>
                    <div className="text-xs text-slate-500">Gợi ý tự động • Kiểm tra thực tế</div>
                  </div>

                  {reportData && reportData.faults && reportData.faults.length > 0 ? (
                    reportData.faults.map((f, i) => {
                      const ci = inferCauseAndImprovement(f.name);
                      return (
                        <div key={i} className="mb-3 p-4 rounded-lg bg-white/80 border border-slate-100 shadow-sm flex gap-4 items-start">
                          <div className="w-1 h-12 rounded-full bg-gradient-to-b from-indigo-500 to-pink-500" />
                          <div className="flex-1 text-xs">
                            <p className="font-semibold text-slate-800">{f.name}</p>
                            <p className="text-slate-600 mt-1">Nguyên nhân: <span className="font-medium text-indigo-600">{ci.cause}</span></p>
                            <p className="text-slate-600">Cải tiến: <span className="font-medium text-pink-600">{ci.improvement}</span></p>
                            <div className="mt-2 flex gap-2 items-center">
                              <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 border">Nguyên nhân</span>
                              <span className="text-xs px-2 py-1 rounded-full bg-pink-100 text-pink-700 border">Cải tiến</span>
                              <span className="ml-auto text-xs px-2 py-1 rounded-full bg-green-100 text-green-800 border">{f.cost} • {f.time}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-slate-500 text-xs">Không có kết luận tự động — cần dữ liệu hoặc ảnh mẫu.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}