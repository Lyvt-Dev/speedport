'use strict';

(function () {
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const startBtn = document.getElementById('startTest');
  const consentToggle = document.getElementById('dataConsent');
  const statusChip = document.getElementById('statusChip');
  const routeChip = document.getElementById('serverRoute');
  const clearHistoryBtn = document.getElementById('clearHistory');

  const downloadValueEl = document.getElementById('downloadValue');
  const uploadValueEl = document.getElementById('uploadValue');
  const pingValueEl = document.getElementById('pingValue');
  const downloadPeakEl = document.getElementById('downloadPeak');
  const uploadPeakEl = document.getElementById('uploadPeak');
  const pingStabilityEl = document.getElementById('pingStability');
  const avgDownloadEl = document.getElementById('avgDownload');
  const avgUploadEl = document.getElementById('avgUpload');
  const graphPingEl = document.getElementById('graphPing');
  const sampleSizeEl = document.getElementById('sampleSize');
  const jitterValueEl = document.getElementById('jitterValue');
  const jitterBadgeEl = document.getElementById('jitterBadge');
  const packetLossEl = document.getElementById('packetLossValue');
  const lossBadgeEl = document.getElementById('lossBadge');
  const consistencyValueEl = document.getElementById('consistencyValue');
  const consistencyBadgeEl = document.getElementById('consistencyBadge');
  const bestRecordEl = document.getElementById('bestRecordValue');
  const historyListEl = document.getElementById('historyList');

  const canvas = document.getElementById('speedGraph');
  const ctx = canvas?.getContext('2d');

  const HISTORY_KEY = 'lyvt-speed-history';
  const GRAPH_LIMIT = 200;
  const MAX_HISTORY = 8;

  const palette = {
    download: '#a78bfa',
    upload: '#7dd3fc',
  };

  const measurementState = {
    running: false,
    consentAccepted: false,
    graphSamples: [],
    downloadValues: [],
    uploadValues: [],
    pingValues: [],
    lastServerMeasurement: null,
    lastDownload: 0,
    lastUpload: 0,
    lastPing: 0,
    serverLabel: 'FRA-1',
  };

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    root.classList.add('light');
    updateThemeIcon('light');
  }

  themeToggle?.addEventListener('click', () => {
    const lightMode = root.classList.toggle('light');
    localStorage.setItem('theme', lightMode ? 'light' : 'dark');
    updateThemeIcon(lightMode ? 'light' : 'dark');
  });

  initConsent();
  renderHistory();
  updateBestRecord();

  startBtn?.addEventListener('click', () => {
    if (measurementState.running) return;
    if (!measurementState.consentAccepted) {
      updateStatus('idle', 'Accept the policy to run a test');
      return;
    }
    runTest();
  });

  clearHistoryBtn?.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    updateBestRecord();
  });

  function initConsent() {
    if (!consentToggle || !startBtn) return;
    const stored = localStorage.getItem('ndt7-consent') === 'true';
    consentToggle.checked = stored;
    measurementState.consentAccepted = stored;
    startBtn.disabled = !stored;

    consentToggle.addEventListener('change', () => {
      measurementState.consentAccepted = consentToggle.checked;
      localStorage.setItem('ndt7-consent', consentToggle.checked ? 'true' : 'false');
      if (!measurementState.running) {
        startBtn.disabled = !consentToggle.checked;
      }
    });
  }

  function runTest() {
    if (!window.ndt7) {
      updateStatus('error', 'ndt7 library missing');
      return;
    }

    measurementState.running = true;
    measurementState.graphSamples = [];
    measurementState.downloadValues = [];
    measurementState.uploadValues = [];
    measurementState.pingValues = [];
    measurementState.lastServerMeasurement = null;
    measurementState.lastDownload = 0;
    measurementState.lastUpload = 0;
    measurementState.lastPing = 0;

    startBtn.disabled = true;
    updateInsightsOnStart();
    updateStatus('active', 'Locating node…');

    const config = {
      userAcceptedDataPolicy: true,
      metadata: {
        client_name: 'lyvt-speed-lab',
        client_version: '1.0.0',
      },
      downloadworkerfile: 'ndt7-download-worker.min.js',
      uploadworkerfile: 'ndt7-upload-worker.min.js',
    };

    const callbacks = {
      error: (message) => handleError(message),
      serverDiscovery: () => updateStatus('active', 'Locating node…'),
      serverChosen: (server) => handleServerChoice(server),
      downloadStart: () => updateStatus('active', 'Measuring download…'),
      downloadMeasurement: (payload) => handleMeasurement('download', payload),
      downloadComplete: () => updateStatus('active', 'Preparing upload…'),
      uploadStart: () => updateStatus('active', 'Measuring upload…'),
      uploadMeasurement: (payload) => handleMeasurement('upload', payload),
      uploadComplete: () => finalizeTest(),
    };

    try {
      ndt7.test(config, callbacks);
    } catch (err) {
      handleError(err?.message || 'ndt7 error');
    }
  }

  function handleServerChoice(server) {
    const city = server?.location?.city;
    const country = server?.location?.country;
    const site = server?.site;
    const node = city ? `${city}${country ? ', ' + country : ''}` : site || 'M-Lab';
    measurementState.serverLabel = node;
    updateRoute(node);
  }

  function handleMeasurement(testType, payload) {
    if (!payload) return;
    const { Source, Data } = payload;

    if (Source === 'client' && Data && Number.isFinite(Data.MeanClientMbps)) {
      if (testType === 'download') {
        measurementState.lastDownload = Data.MeanClientMbps;
        measurementState.downloadValues.push(Data.MeanClientMbps);
        setText(downloadValueEl, Data.MeanClientMbps.toFixed(2));
      } else {
        measurementState.lastUpload = Data.MeanClientMbps;
        measurementState.uploadValues.push(Data.MeanClientMbps);
        setText(uploadValueEl, Data.MeanClientMbps.toFixed(2));
      }
      pushGraphSample();
      updateStatsDisplay();
    }

    if (Source === 'server' && Data) {
      measurementState.lastServerMeasurement = Data;
      const minRtt = Data?.TCPInfo?.MinRTT;
      if (Number.isFinite(minRtt)) {
        const pingMs = minRtt / 1000;
        measurementState.lastPing = pingMs;
        measurementState.pingValues.push(pingMs);
        setText(pingValueEl, Math.round(pingMs));
        setText(graphPingEl, Math.round(pingMs));
        updateStatsDisplay();
      }
    }

    setText(sampleSizeEl, measurementState.graphSamples.length);
  }

  function pushGraphSample() {
    measurementState.graphSamples.push({
      download: measurementState.lastDownload,
      upload: measurementState.lastUpload,
    });
    if (measurementState.graphSamples.length > GRAPH_LIMIT) {
      measurementState.graphSamples.shift();
    }
    drawGraph(measurementState.graphSamples);
  }

  function finalizeTest() {
    measurementState.running = false;
    const stats = computeStats();
    const packetLoss = stats.packetLoss;
    updateStatsDisplay();
    updateStatus('success', 'Finished measurements');
    startBtn.disabled = !measurementState.consentAccepted;

    saveResult({
      timestamp: Date.now(),
      node: measurementState.serverLabel,
      downloadAvg: stats.avgDownload,
      uploadAvg: stats.avgUpload,
      pingAvg: stats.avgPing,
      jitter: stats.jitter,
      packetLoss,
    });

    renderHistory();
    updateBestRecord();
  }

  function handleError(message) {
    console.warn('[ndt7]', message);
    measurementState.running = false;
    updateStatus('error', 'Test failed');
    startBtn.disabled = !measurementState.consentAccepted;
  }

  function updateThemeIcon(mode) {
    if (!themeToggle) return;
    themeToggle.innerHTML = mode === 'light' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }

  function updateStatus(mode, label) {
    if (!statusChip) return;
    statusChip.dataset.state = mode;
    const icon = mode === 'success' ? 'fa-check' : mode === 'active' ? 'fa-wifi' : mode === 'error' ? 'fa-triangle-exclamation' : 'fa-circle';
    statusChip.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
  }

  function updateRoute(node) {
    if (!routeChip) return;
    routeChip.innerHTML = `<i class="fa-solid fa-route"></i> Node: ${node}`;
  }

  function updateInsightsOnStart() {
    setText(downloadValueEl, '0.00');
    setText(uploadValueEl, '0.00');
    setText(pingValueEl, '0');
    setText(downloadPeakEl, '0.00');
    setText(uploadPeakEl, '0.00');
    setText(pingStabilityEl, '—');
    setText(avgDownloadEl, '0.00');
    setText(avgUploadEl, '0.00');
    setText(graphPingEl, '0');
    setText(sampleSizeEl, '0');
    setText(jitterValueEl, '0.0');
    setText(packetLossEl, '0.0');
    setText(consistencyValueEl, '—');
    jitterBadgeEl.textContent = 'pending';
    jitterBadgeEl.style.color = 'var(--muted)';
    lossBadgeEl.textContent = 'estimating';
    lossBadgeEl.style.color = 'var(--muted)';
    consistencyBadgeEl.textContent = 'pending';
    consistencyBadgeEl.style.color = 'var(--muted)';
    drawGraph([]);
  }

  function updateStatsDisplay() {
    const stats = computeStats();
    setText(downloadPeakEl, stats.peakDownload.toFixed(2));
    setText(uploadPeakEl, stats.peakUpload.toFixed(2));
    setText(avgDownloadEl, stats.avgDownload.toFixed(2));
    setText(avgUploadEl, stats.avgUpload.toFixed(2));
    setText(jitterValueEl, stats.jitter.toFixed(1));
    setText(packetLossEl, stats.packetLoss.toFixed(1));
    setText(consistencyValueEl, stats.consistency ? `${stats.consistency}% stable` : '—');
    updatePingStability(stats.jitter);
    updateBadges(stats);
  }

  function updatePingStability(jitter) {
    if (!pingStabilityEl) return;
    if (!Number.isFinite(jitter)) {
      pingStabilityEl.textContent = '—';
      return;
    }
    if (jitter < 5) pingStabilityEl.textContent = 'Excellent';
    else if (jitter < 12) pingStabilityEl.textContent = 'OK';
    else pingStabilityEl.textContent = 'Unstable';
  }

  function updateBadges(stats) {
    if (!jitterBadgeEl || !lossBadgeEl || !consistencyBadgeEl) return;

    if (stats.jitter < 6) {
      jitterBadgeEl.textContent = 'stable';
      jitterBadgeEl.style.color = 'var(--success)';
    } else if (stats.jitter < 12) {
      jitterBadgeEl.textContent = 'moderate';
      jitterBadgeEl.style.color = 'var(--warning)';
    } else {
      jitterBadgeEl.textContent = 'spiky';
      jitterBadgeEl.style.color = 'var(--error)';
    }

    if (stats.packetLoss < 0.5) {
      lossBadgeEl.textContent = 'clean';
      lossBadgeEl.style.color = 'var(--success)';
    } else if (stats.packetLoss < 1.5) {
      lossBadgeEl.textContent = 'minor';
      lossBadgeEl.style.color = 'var(--warning)';
    } else {
      lossBadgeEl.textContent = 'noticeable';
      lossBadgeEl.style.color = 'var(--error)';
    }

    if (stats.consistency >= 90) {
      consistencyBadgeEl.textContent = 'great';
      consistencyBadgeEl.style.color = 'var(--success)';
    } else if (stats.consistency >= 75) {
      consistencyBadgeEl.textContent = 'good';
      consistencyBadgeEl.style.color = 'var(--accent-2)';
    } else {
      consistencyBadgeEl.textContent = 'unstable';
      consistencyBadgeEl.style.color = 'var(--error)';
    }
  }

  function computeStats() {
    const peakDownload = maxOf(measurementState.downloadValues);
    const peakUpload = maxOf(measurementState.uploadValues);
    const avgDownload = average(measurementState.downloadValues);
    const avgUpload = average(measurementState.uploadValues);
    const avgPing = average(measurementState.pingValues);
    const jitter = computeStdDev(measurementState.pingValues);
    const consistency = computeConsistency(measurementState.downloadValues);
    const packetLoss = computePacketLoss();

    return {
      peakDownload,
      peakUpload,
      avgDownload,
      avgUpload,
      avgPing,
      jitter,
      consistency,
      packetLoss,
    };
  }

  function computePacketLoss() {
    const tcpInfo = measurementState.lastServerMeasurement?.TCPInfo;
    if (!tcpInfo || !Number.isFinite(tcpInfo.BytesAcked) || tcpInfo.BytesAcked <= 0) return 0;
    const retrans = Math.max(0, tcpInfo.BytesRetrans || 0);
    return (retrans / tcpInfo.BytesAcked) * 100;
  }

  function computeConsistency(values) {
    if (values.length < 2) return values.length ? 100 : 0;
    const avg = average(values);
    if (!avg) return 0;
    const std = computeStdDev(values);
    return Math.max(0, Math.min(100, Math.round(100 - (std / avg) * 100)));
  }

  function drawGraph(samples) {
    if (!ctx || !canvas) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(5,5,15,0.9)');
    gradient.addColorStop(1, 'rgba(5,5,15,0.6)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (!samples.length) {
      drawPlaceholderText(ctx, width, height);
      return;
    }

    const maxVal = Math.max(60, Math.max(...samples.map((s) => Math.max(s.download, s.upload))) * 1.1);
    const stepX = samples.length > 1 ? width / (samples.length - 1) : width;

    drawLine(samples, 'download', palette.download, maxVal, stepX, height);
    drawLine(samples, 'upload', palette.upload, maxVal, stepX, height);
  }

  function drawLine(samples, key, color, maxVal, stepX, height) {
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = index * stepX;
      const y = height - (sample[key] / maxVal) * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawPlaceholderText(context, width, height) {
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.font = '500 16px "Poppins", sans-serif';
    context.textAlign = 'center';
    context.fillText('Accept & start to stream real ndt7 data ✦', width / 2, height / 2);
  }

  function saveResult(entry) {
    const history = loadHistory();
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Failed to parse history', error);
      return [];
    }
  }

  function renderHistory() {
    if (!historyListEl) return;
    const history = loadHistory();

    if (!history.length) {
      historyListEl.innerHTML = '<div class="empty-state">No sessions yet. Run a test to build your archive.</div>';
      return;
    }

    historyListEl.innerHTML = history
      .map((entry) => {
        const date = new Date(entry.timestamp);
        return `
          <article class="history-card">
            <span class="timestamp">${date.toLocaleString()}</span>
            <div><small>Download</small><br/><strong>${entry.downloadAvg.toFixed(2)} Mbps</strong></div>
            <div><small>Upload</small><br/><strong>${entry.uploadAvg.toFixed(2)} Mbps</strong></div>
            <div><small>Ping</small><br/><strong>${Math.round(entry.pingAvg)} ms</strong></div>
            <div><small>Jitter</small><br/><strong>${entry.jitter.toFixed(1)} ms</strong></div>
            <div><small>Packet loss</small><br/><strong>${entry.packetLoss.toFixed(1)}%</strong></div>
            <div><small>Node</small><br/><strong>${entry.node}</strong></div>
          </article>
        `;
      })
      .join('');
  }

  function updateBestRecord() {
    const history = loadHistory();
    if (!history.length) {
      bestRecordEl.textContent = '—';
      return;
    }
    const top = history.reduce((best, item) => (item.downloadAvg > best.downloadAvg ? item : best), history[0]);
    bestRecordEl.textContent = `${top.downloadAvg.toFixed(1)} Mbps @ ${top.node}`;
  }

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function maxOf(values) {
    if (!values.length) return 0;
    return Math.max(...values);
  }

  function computeStdDev(values) {
    if (!values.length) return 0;
    const mean = average(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
})();
