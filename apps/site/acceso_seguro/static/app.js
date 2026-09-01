/* ════════════════════════════════════════════════════════
   AccesoSeguro — app.js
   ════════════════════════════════════════════════════════ */

'use strict';

// ── Estado global ──────────────────────────────────────────────────────────
let _token = sessionStorage.getItem('token') || '';
let _rol   = sessionStorage.getItem('rol')   || '';
let _user  = sessionStorage.getItem('user')  || '';
let _lote  = sessionStorage.getItem('lote')  || '';
let _currentPage = 'dashboard';
let histOffset = 0;
let _currentModalIdx = -1;
const detState = {
  all: [],
  filtered: [],
  page: 1,
  pageSize: 12,
  query: '',
};
let _relayPollInterval = null;
let _eventsPollInterval = null;
let _statsPollInterval  = null;
let _streamPollInterval = null;
let _alprStatusInterval = null;
let _alprStatsInterval  = null;
let _streamsEnabled = false;

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { doLogout(); return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

async function doLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;

  try {
    const fd = new URLSearchParams({ username: user, password: pass });
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fd.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error de autenticación');

    _token = data.access_token;
    _rol   = data.rol;
    _user  = data.username;
    _lote  = data.lote || '';
    sessionStorage.setItem('token', _token);
    sessionStorage.setItem('rol', _rol);
    sessionStorage.setItem('user', _user);
    sessionStorage.setItem('lote', _lote);

    startApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function doLogout() {
  sessionStorage.clear();
  _token = _rol = _user = _lote = '';
  stopPolling();
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  const navMiLote = document.getElementById('nav-mi-lote');
  const navHistLote = document.getElementById('nav-historial-lote');
  if (navMiLote) navMiLote.classList.add('hidden');
  if (navHistLote) navHistLote.classList.add('hidden');
}

// ── Arranque ───────────────────────────────────────────────────────────────
function startApp() {
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userInfo').textContent = `${_user} (${_rol})`;

  if (_rol === 'propietario') {
    // Ocultar navegacion estandar
    ['nav-dashboard', 'nav-vehiculos', 'nav-personas', 'nav-historial', 'nav-detecciones', 'nav-config'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    // Mostrar navegacion de propietario
    ['nav-mi-lote', 'nav-historial-lote'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
    // Ocultar escaner QR flotante
    const qrW = document.getElementById('qrFloatingWidget');
    const qrT = document.getElementById('qrFloatToggle');
    if (qrW) qrW.classList.add('hidden');
    if (qrT) qrT.classList.add('hidden');

    // Actualizar etiquetas de lote
    const lblLote1 = document.getElementById('lblLotePropietario');
    const lblLote2 = document.getElementById('lblLotePropietarioHist');
    if (lblLote1) lblLote1.textContent = _lote;
    if (lblLote2) lblLote2.textContent = _lote;

    // Ir a la seccion por defecto
    navigate('mi-lote');
  } else {
    // Mostrar navegacion estandar (excluyendo configuracion para vigilador/viewer)
    ['nav-dashboard', 'nav-vehiculos', 'nav-personas', 'nav-historial', 'nav-detecciones'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });

    const configTab = document.getElementById('nav-config');
    if (configTab) {
      if (_rol === 'admin' || _rol === 'supervisor') {
        configTab.classList.remove('hidden');
      } else {
        configTab.classList.add('hidden');
      }
    }

    // Ocultar navegacion de propietario
    ['nav-mi-lote', 'nav-historial-lote'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Ocultar botones de apertura manual para viewers o segun permisos para vigiladores
    if (_rol === 'viewer') {
      ['btnAbrirIn', 'btnAbrirOut', 'btnCerrarIn', 'btnCerrarOut'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.add('hidden');
      });
      const qrT = document.getElementById('qrFloatToggle');
      if (qrT) qrT.classList.add('hidden');
    } else if (_rol === 'vigilador') {
      // Por defecto ocultar triggers manuales hasta validar configuracion
      ['btnAbrirIn', 'btnAbrirOut', 'btnCerrarIn', 'btnCerrarOut'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.add('hidden');
      });
      
      const qrT = document.getElementById('qrFloatToggle');
      if (qrT) qrT.classList.remove('hidden');

      // Consultar configuracion para ver si estan permitidos
      api('GET', '/api/config').then(cfg => {
        if (cfg) {
          const enabled = cfg.vigilador_manual_trigger !== false;
          ['btnAbrirIn', 'btnAbrirOut', 'btnCerrarIn', 'btnCerrarOut'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
              if (enabled) {
                btn.classList.remove('hidden');
              } else {
                btn.classList.add('hidden');
              }
            }
          });
        }
      }).catch(err => {
        console.error('Error al cargar configuracion de vigilador:', err);
      });
    } else {
      // Admin/Supervisor
      ['btnAbrirIn', 'btnAbrirOut', 'btnCerrarIn', 'btnCerrarOut'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('hidden');
      });
      const qrT = document.getElementById('qrFloatToggle');
      if (qrT) qrT.classList.remove('hidden');
    }

    navigate('dashboard');
    startPolling();
  }
}

function startPolling() {
  stopPolling();
  _relayPollInterval  = setInterval(pollRelay,        2000);
  _eventsPollInterval = setInterval(loadEvents,       5000);
  _statsPollInterval  = setInterval(loadStats,        10000);
  _streamPollInterval = setInterval(pollStreamStatus, 3000);
  _alprStatusInterval = setInterval(pollAlprStatus,   2000);
  _alprStatsInterval  = setInterval(pollAlprStats,    10000);
  pollRelay();
  loadEvents();
  loadStats();
  pollStreamStatus();
  pollAlprStatus();
  pollAlprStats();
  // Delay stream activation on page load to allow document parsed cleanly without spinning loader
  setTimeout(() => {
    setStreamsEnabled(_currentPage === 'dashboard' && !document.hidden);
  }, 800);
  setInterval(() => { syncRoiCanvasSize(); drawRoiOverlay(); }, 1200);
  setInterval(updateHourlyChart, 15000);
  updateHourlyChart();
  loadRoi();
  connectWebSocket();
}

let _ws = null;
function toggleSidebar() {
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.toggle('sidebar-collapsed');
    setTimeout(() => { if (typeof updateHourlyChart === 'function') updateHourlyChart(); }, 350);
  }
}

function connectWebSocket() {
  if (_ws && _ws.readyState <= 1) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  _ws = new WebSocket(`${protocol}//${location.host}/ws/events`);
  _ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg && msg.payload && !msg.data) {
        msg.data = msg.payload;
      }
      if (msg && msg.data && !msg.sentido) {
        msg.sentido = msg.data.sentido;
      }
      if (['PLATE_READ', 'DNI_READ', 'ACCESS_RESULT'].includes(msg.type)) {
        showWsOverlay(msg);
        showToast(msg);
        if (msg.type === 'ACCESS_RESULT') {
          loadEvents();
          
          const sentido = msg.data?.sentido || msg.sentido || 'in';
          const res = msg.data?.resultado || msg.resultado || '';
          const suffix = sentido === 'out' ? 'Out' : 'In';
          
          const card = document.getElementById('relayCard' + suffix);
          const icon = document.getElementById('relayIcon' + suffix);
          const lbl  = document.getElementById('relayLabel' + suffix);
          const timer = document.getElementById('relayTimer' + suffix);
          
          if (card && icon && lbl && timer) {
            if (res === 'autorizado' || res === 'manual') {
              card.classList.add('open');
              icon.textContent = 'ON';
              lbl.textContent  = `Barrera ${sentido.toUpperCase()} (${sentido === 'out' ? 'Salida' : 'Ingreso'}): ABIERTA`;
              timer.textContent = 'Abierta: 0s';
              timer.classList.remove('hidden');
            } else if (res === 'manual_close' || res === 'sensor_close') {
              card.classList.remove('open');
              icon.textContent = 'OFF';
              lbl.textContent  = `Barrera ${sentido.toUpperCase()} (${sentido === 'out' ? 'Salida' : 'Ingreso'}): Cerrada`;
              timer.classList.add('hidden');
            }
          }
          setTimeout(pollRelay, 150);
        }
        
        if (msg.type === 'DNI_READ') {
          const txt = document.getElementById('dniTestResults');
          if (txt) {
            const timeStr = new Date().toLocaleTimeString();
            const data = msg.data || {};
            const sense = msg.sentido || data.sentido || 'IN';
            txt.value = `[${timeStr}] ESCANEO REAL (${sense.toUpperCase()}): DNI=${data.dni || ''} Nombre=${data.nombre || ''} ${data.apellido || ''}\n` + txt.value;
          }
          const modal = document.getElementById('modalPersona');
          const isModalOpen = modal && !modal.classList.contains('hidden');
          if (isModalOpen || _currentPage === 'personas') {
            if (!isModalOpen) {
              openPersonaModal();
            }
            if (msg.data) {
              const data = msg.data;
              if (data.dni) document.getElementById('perDni').value = data.dni || '';
              if (data.apellido) document.getElementById('perApellido').value = data.apellido || '';
              if (data.nombre) document.getElementById('perNombre').value = data.nombre || '';
              if (data.sexo) {
                const s = String(data.sexo).toUpperCase().trim();
                if (s === 'M' || s === 'F' || s === 'X') {
                  document.getElementById('perSexo').value = s;
                } else {
                  document.getElementById('perSexo').value = 'X';
                }
              }
              if (data.nacimiento) {
                const parts = data.nacimiento.split('/');
                if (parts.length === 3) {
                  const d = parts[0].padStart(2, '0');
                  const m = parts[1].padStart(2, '0');
                  const y = parts[2];
                  document.getElementById('perNacimiento').value = `${y}-${m}-${d}`;
                } else {
                  document.getElementById('perNacimiento').value = data.nacimiento;
                }
              }
              if (data.tramite) document.getElementById('perTramite').value = data.tramite || '';
            }
          }
        }
      }
    } catch (_) {}
  };
  _ws.onclose = () => { setTimeout(connectWebSocket, 3000); };
}

function showWsOverlay(msg) {
  let target = '';
  if (msg.sentido === 'in' || msg.data?.sentido === 'in') target = 'In';
  else if (msg.sentido === 'out' || msg.data?.sentido === 'out') target = 'Out';
  else if (msg.type === 'DNI_READ') target = 'Dni';
  
  if (!target && msg.type === 'ACCESS_RESULT') {
    target = msg.data.sentido === 'in' ? 'In' : 'Out';
  }
  if (!target) return;

  const overlay = document.getElementById('overlay' + target);
  if (!overlay) return;

  // Configuración de HUD dinámico (para cámaras de Ingreso/Salida)
  if (target === 'In' || target === 'Out') {
    const hudEnabled = target === 'In'
      ? (_cfgData.hud_overlay_enabled_in !== undefined ? _cfgData.hud_overlay_enabled_in : true)
      : (_cfgData.hud_overlay_enabled_out !== undefined ? _cfgData.hud_overlay_enabled_out : true);
      
    if (msg.type === 'PLATE_READ' && !hudEnabled) {
      overlay.classList.add('hidden');
      return;
    }

    const pos = target === 'In'
      ? (_cfgData.hud_overlay_position_in || 'bottom-left')
      : (_cfgData.hud_overlay_position_out || 'bottom-right');

    overlay.style.display = 'flex';
    overlay.style.padding = '16px';

    switch (pos) {
      case 'center':
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '0';
        break;
      case 'top-left':
        overlay.style.alignItems = 'flex-start';
        overlay.style.justifyContent = 'flex-start';
        break;
      case 'top-right':
        overlay.style.alignItems = 'flex-start';
        overlay.style.justifyContent = 'flex-end';
        break;
      case 'bottom-left':
        overlay.style.alignItems = 'flex-end';
        overlay.style.justifyContent = 'flex-start';
        break;
      case 'bottom-right':
        overlay.style.alignItems = 'flex-end';
        overlay.style.justifyContent = 'flex-end';
        break;
      default:
        if (target === 'In') {
          overlay.style.alignItems = 'flex-end';
          overlay.style.justifyContent = 'flex-start';
        } else {
          overlay.style.alignItems = 'flex-end';
          overlay.style.justifyContent = 'flex-end';
        }
        break;
    }
  }
  
  let html = '';
  if (msg.type === 'PLATE_READ') {
      const authMode = _cfgData.auth_mode || 'ambos';
      let actionText = '';
      let themeColor = '';
      let bgGrad = '';
      
      if (authMode === 'patente') {
        actionText = 'PASE DIRECTO';
        themeColor = '#10b981'; // Green
        bgGrad = 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.25) 100%)';
      } else if (authMode === 'combinado') {
        actionText = 'PASE DIRECTO O COLOQUE DNI';
        themeColor = '#3b82f6'; // Blue
        bgGrad = 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(29, 78, 216, 0.25) 100%)';
      } else { // 'dni' or 'ambos'
        actionText = 'COLOQUE DNI';
        themeColor = '#f59e0b'; // Orange
        bgGrad = 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.25) 100%)';
      }

      const isWaitingDni = msg.data.status === 'waiting_dni';
      const title = isWaitingDni ? 'PATENTE LEÍDA' : 'PATENTE DETECTADA';
      const subtext = isWaitingDni ? 'Esperando DNI...' : `Confianza: ${(msg.data.conf*100 || 90).toFixed(0)}%`;
      
      html = `<div style="background: rgba(19, 22, 31, 0.85); color: #fff; padding: 16px; border-radius: 12px; border: 1.5px solid ${themeColor}; font-weight: bold; text-align: center; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.05); min-width: 260px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: all 0.3s ease;">
                <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; color: #a0aec0; font-weight: 600;">${title}</div>
                <div style="color: #fff; font-size: 1.8rem; font-family: 'Outfit', 'Inter', monospace; font-weight: 700; letter-spacing: 3px; margin-bottom: 10px; background: rgba(255, 255, 255, 0.08); padding: 6px 14px; border-radius: 6px; display: inline-block; border: 1px solid rgba(255, 255, 255, 0.1); text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${msg.data.patente}</div>
                
                <!-- Badge de Acción -->
                <div style="background: ${bgGrad}; color: ${themeColor}; border: 1px solid ${themeColor}44; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 8px; text-transform: uppercase; display: block; box-shadow: 0 2px 8px ${themeColor}22;">
                  ${actionText}
                </div>
                
                <div style="color: #a0aec0; font-size: 0.8rem; font-weight: 500; opacity: 0.8;">${subtext}</div>
              </div>`;
  } else if (msg.type === 'DNI_READ') {
     const isWaitingPlate = msg.data.status === 'waiting_plate';
     const title = isWaitingPlate ? 'DNI LEÍDO' : 'DNI DETECTADO';
     const subtext = isWaitingPlate ? '⏳ Esperando Patente...' : (msg.data.nombre_completo || `${msg.data.nombre || ''} ${msg.data.apellido || ''}`);
     const borderColor = isWaitingPlate ? '#f59e0b' : '#3b82f6';
     const titleColor = isWaitingPlate ? '#f59e0b' : '#3b82f6';

     html = `<div style="background:rgba(19,22,31,0.92);color:${titleColor};padding:14px;border-radius:10px;border:2px solid ${borderColor};font-weight:bold;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:240px;backdrop-filter:blur(8px);">
               <div style="font-size:0.9rem;letter-spacing:1px;margin-bottom:6px;color:#a0aec0;">${title}</div>
               <div style="color:#fff;font-size:1.4rem;margin-bottom:6px;background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:4px;display:inline-block;">${msg.data.dni || ''}</div>
               <div style="color:${isWaitingPlate ? '#f59e0b' : '#fff'};font-size:0.9rem;font-weight:normal;">${subtext}</div>
             </div>`;
  } else if (msg.type === 'ACCESS_RESULT') {
     const res = msg.data?.resultado || msg.resultado || '';
     const isOk = res === 'autorizado' || res === 'manual';
     const isClose = res === 'manual_close' || res === 'sensor_close' || res === 'timeout_close';
     
     let color, title, subtext;
     if (isOk) {
       color = '#10b981'; // Green
       title = 'REGISTRADO';
       subtext = 'Abriendo Barrera...';
     } else if (isClose) {
       color = '#a0aec0'; // Gray/Neutral
       title = res === 'manual_close' ? 'CIERRE MANUAL' : (res === 'timeout_close' ? 'CIERRE AUTOMÁTICO' : 'CIERRE POR SENSOR');
       subtext = msg.data?.motivo || msg.motivo || 'Cerrando Barrera...';
     } else {
       color = '#ef4444'; // Red
       title = 'ACCESO DENEGADO';
       subtext = msg.data?.motivo || msg.motivo || 'No autorizado';
     }
     
     const subtextColor = isOk ? '#fff' : (isClose ? '#e2e8f0' : '#fc8181');
     
     html = `<div style="background:rgba(19,22,31,0.94);color:${color};padding:16px;border-radius:10px;border:2px solid ${color};font-weight:bold;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.6);min-width:260px;backdrop-filter:blur(8px);">
               <div style="font-size:1.1rem;letter-spacing:1px;margin-bottom:6px;color:${color}">${title}</div>
               <div style="color:#fff;font-size:1.5rem;font-family:monospace;letter-spacing:2px;margin-bottom:6px;background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:4px;display:inline-block;">${msg.data?.patente || msg.patente || 'SIN PLACA'}</div>
               <div style="color:${subtextColor};font-size:0.95rem;font-weight:normal;">${subtext}</div>
             </div>`;
  }
  
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
  
  if (overlay.timeoutId) clearTimeout(overlay.timeoutId);
  overlay.timeoutId = setTimeout(() => {
    overlay.classList.add('hidden');
  }, 4000);
}

function stopPolling() {
  clearInterval(_relayPollInterval);
  clearInterval(_eventsPollInterval);
  clearInterval(_statsPollInterval);
  clearInterval(_streamPollInterval);
  clearInterval(_alprStatusInterval);
  clearInterval(_alprStatsInterval);
}

// ── Navegacion ─────────────────────────────────────────────────────────────
function navigate(page) {
  _currentPage = page;
  document.querySelectorAll('.page').forEach(p => {
    p.classList.add('hidden');
    p.classList.remove('active');
    p.style.display = '';
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById('page-' + page);
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('active');
  }

  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  setStreamsEnabled(page === 'dashboard' && !document.hidden);

  if (page === 'vehiculos') loadVehiculos();
  if (page === 'personas')  loadPersonas();
  if (page === 'historial') { histOffset = 0; loadHistorial(); }
  if (page === 'detecciones') { detState.page = 1; refreshDetecciones(); }
  if (page === 'config')    { loadRuntimeConfig(); loadRoi(); loadSubsystems(); }
  if (page === 'mi-lote')   loadPreAutorizaciones();
  if (page === 'historial-lote') loadHistorialLote();
}

// ── Stream start/stop ──────────────────────────────────────────────────────
async function startStream() {
  try {
    const r = await api('POST', '/api/start');
    if (r && r.ok === false) { alert(r.msg); return; }
    setStreamsEnabled(true);
  } catch (err) { alert(err.message); }
}

async function stopStream() {
  try {
    await api('POST', '/api/stop');
    setStreamsEnabled(false);
  } catch (err) { alert(err.message); }
}

// ── ALPR status (sidebar box + KPIs base) ─────────────────────────────────
async function pollAlprStatus() {
  try {
    const s_all = await api('GET', '/api/status');
    if (!s_all) return;
    const s = s_all.in || {};
    // Sidebar status box
    const stBox = document.getElementById('statusBox');
    if (stBox) {
      const state = s.running ? '[ON]' : '[OFF]';
      const proc  = s.processed_frames ?? 0;
      const lat   = s.last_inference_ms != null ? s.last_inference_ms + 'ms' : '-';
      const err   = s.last_error || 'ninguno';
      stBox.textContent = `${state} frame=${s.frame_id} | proc=${proc} | inf=${lat} | err=${err}`;
    }
    // Source URL
    const srcEl = document.getElementById('sourceText');
    if (srcEl) srcEl.textContent = s.source || '-';
    // ALPR KPIs
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiFrame',     s.frame_id ?? '–');
    set('kpiProcessed', s.processed_frames ?? '–');
    set('kpiLatency',   s.last_inference_ms != null ? s.last_inference_ms + ' ms' : '–');
    set('kpiDedup',     s.dedup_skipped ?? '–');
    set('kpiDetTotal',  s.detections_total ?? '–');
  } catch (_) {}
}

// ─── Modal zoom imagen ──────────────────────────────────────────────────────
function openThumb(globalIdx) {
  _currentModalIdx = globalIdx;
  const item = detState.filtered[globalIdx];
  if (!item) return;

  const modalSrc = item.car_b64 || item.thumb_b64 || '';
  const thumbSrc = item.thumb_b64 || '';
  const evidenceSrc = item.foto_evidencia_b64 || '';

  let modal = document.getElementById('_thumbModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_thumbModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
    modal.innerHTML =
      '<div id="_thumbCard" style="max-width:94vw;max-height:88vh;overflow:auto;background:#13161f;border:1px solid #2d3250;border-radius:12px;padding:14px;box-shadow:0 0 60px #000;position:relative;">' +
      '<button id="_btnPrevModal" style="position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.65);border:none;color:#fff;font-size:2.2rem;cursor:pointer;padding:0;border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;transition:background 0.2s;">‹</button>' +
      '<button id="_btnNextModal" style="position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.65);border:none;color:#fff;font-size:2.2rem;cursor:pointer;padding:0;border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;transition:background 0.2s;">›</button>' +
      '<div style="display:flex;gap:14px;justify-content:center;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div id="_divMainImg" style="display:flex;flex-direction:column;align-items:center;">' +
          '<span id="_lblMainImg" style="color:#a0aec0;font-size:.85rem;margin-bottom:4px;font-weight:600;">Cámara Lectora</span>' +
          '<img id="_thumbImg" style="width:min(1200px,90vw);max-height:65vh;object-fit:contain;border-radius:8px;display:block" onerror="if(this.src.indexOf(\'/static/no-signal.svg\')===-1)this.src=\'/static/no-signal.svg\';" />' +
        '</div>' +
        '<div id="_divEvidenceImg" style="display:flex;flex-direction:column;align-items:center;">' +
          '<span style="color:#a0aec0;font-size:.85rem;margin-bottom:4px;font-weight:600;">Cámara Evidencia</span>' +
          '<img id="_thumbImgEvidence" style="width:min(600px,90vw);max-height:65vh;object-fit:contain;border-radius:8px;display:block" onerror="if(this.src.indexOf(\'/static/no-signal.svg\')===-1)this.src=\'/static/no-signal.svg\';" />' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:10px;flex-wrap:wrap">' +
      '<div><div id="_thumbLabel" style="color:#fff;font-size:1.1rem;font-weight:700;letter-spacing:.04em"></div>' +
      '<div id="_thumbDate" style="color:#c4d4e7;font-size:.9rem;margin-top:4px"></div></div>' +
      '<img id="_thumbPlate" style="height:72px;border-radius:6px;border:1px solid #3a5a7f;display:none" onerror="this.style.display=\'none\';" /></div></div>';
    
    modal.addEventListener('click', () => { modal.style.display = 'none'; _currentModalIdx = -1; });
    modal.querySelector('#_thumbCard')?.addEventListener('click', e => e.stopPropagation());
    
    modal.querySelector('#_btnPrevModal')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateModal(-1);
    });
    modal.querySelector('#_btnNextModal')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateModal(1);
    });
    
    document.body.appendChild(modal);
  }

  const mainImg = document.getElementById('_thumbImg');
  const mainLabel = document.getElementById('_lblMainImg');
  const evidenceDiv = document.getElementById('_divEvidenceImg');
  const evidenceImg = document.getElementById('_thumbImgEvidence');

  mainImg.src = modalSrc;
  
  if (evidenceSrc) {
    mainImg.style.width = 'min(600px,90vw)';
    mainLabel.style.display = 'block';
    evidenceDiv.style.display = 'flex';
    evidenceImg.src = evidenceSrc;
  } else {
    mainImg.style.width = 'min(1200px,90vw)';
    mainLabel.style.display = 'none';
    evidenceDiv.style.display = 'none';
  }

  document.getElementById('_thumbLabel').textContent = item.patente || '';
  document.getElementById('_thumbDate').textContent = formatFecha(item.fecha);
  
  const pi = document.getElementById('_thumbPlate');
  if (thumbSrc) {
    pi.src = thumbSrc;
    pi.style.display = 'block';
  } else {
    pi.style.display = 'none';
  }

  const prevBtn = document.getElementById('_btnPrevModal');
  const nextBtn = document.getElementById('_btnNextModal');
  if (prevBtn) prevBtn.style.display = globalIdx > 0 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = globalIdx < detState.filtered.length - 1 ? 'flex' : 'none';

  modal.style.display = 'flex';
}

function navigateModal(direction) {
  if (_currentModalIdx === -1) return;
  const nextIdx = _currentModalIdx + direction;
  if (nextIdx >= 0 && nextIdx < detState.filtered.length) {
    openThumb(nextIdx);
  }
}

// ── ALPR stats (detecciones hoy/hora) ────────────────────────────────────
async function pollAlprStats() {
  try {
    const s = await api('GET', '/api/stats');
    if (!s) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiDetTotal',    s.total ?? '–');
    set('kpiDetToday',    s.today ?? '–');
    set('kpiDetLastHour', s.last_hour ?? '–');
  } catch (_) {}
}

// ── Detecciones ALPR ─────────────────────────────────────────────────────
function applyDetectionFilter(resetPage = false) {
  const q = (detState.query || '').trim().toUpperCase();
  detState.filtered = !q
    ? [...detState.all]
    : detState.all.filter((row) => String(row.patente || '').toUpperCase().includes(q));

  const totalPages = Math.max(1, Math.ceil(detState.filtered.length / detState.pageSize));
  if (resetPage) detState.page = 1;
  detState.page = Math.max(1, Math.min(detState.page, totalPages));
}

function renderDetecciones() {
  const tbody = document.getElementById('bodyDetecciones');
  if (!tbody) return;
  tbody.innerHTML = '';

  const start = (detState.page - 1) * detState.pageSize;
  const end = start + detState.pageSize;
  const items = detState.filtered.slice(start, end);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Sin detecciones por ahora</td></tr>';
  } else {
    tbody.innerHTML = items.map((item, idx) => {
      const globalIdx = start + idx;
      const thumbHtml = item.thumb_b64
        ? `<img src="${item.thumb_b64}" class="det-thumb" alt="${item.patente || ''}" onclick="openThumb(${globalIdx})" onerror="this.outerHTML='<span class=muted>—</span>';" />`
        : '<span class="muted">—</span>';
      const carHtml = item.car_b64
        ? `<img src="${item.car_b64}" class="det-thumb" alt="Auto ${item.patente || ''}" onclick="openThumb(${globalIdx})" onerror="this.outerHTML='<span class=muted>—</span>';" />`
        : '<span class="muted">—</span>';
      const eviHtml = item.foto_evidencia_b64
        ? `<img src="${item.foto_evidencia_b64}" class="det-thumb" alt="Evidencia ${item.patente || ''}" onclick="openThumb(${globalIdx})" onerror="this.outerHTML='<span class=muted>—</span>';" />`
        : '<span class="muted">—</span>';
        
      const sentidoHtml = item.sentido === 'in' ? '<span style="color:#10b981;font-weight:600;">Ingreso</span>'
                        : item.sentido === 'out' ? '<span style="color:#3b82f6;font-weight:600;">Salida</span>'
                        : `<span class="muted">${item.sentido || '—'}</span>`;

      const badgeCls = item.autorizado === true ? 'badge-green'
                     : item.autorizado === false ? 'badge-red'
                     : 'badge-gray';
      const label = item.autorizado === true ? 'Autorizado'
                  : item.autorizado === false ? 'Denegado'
                  : 'Pendiente';
      const estadoHtml = `<span class="badge ${badgeCls}">${label}</span>`;

      return `
      <tr>
        <td>${formatFecha(item.fecha)}</td>
        <td>${sentidoHtml}</td>
        <td><span class="mono">${item.patente || '—'}</span></td>
        <td>${thumbHtml}</td>
        <td>${carHtml}</td>
        <td>${eviHtml}</td>
        <td>${item.region || '—'}</td>
        <td>${Number(item.ocr_conf || 0).toFixed(3)}</td>
        <td>${estadoHtml}</td>
      </tr>`;
    }).join('');
  }

  const totalPages = Math.max(1, Math.ceil(detState.filtered.length / detState.pageSize));
  document.getElementById('detPageInfo').textContent = `Página ${detState.page} / ${totalPages}`;
  document.getElementById('btnDetPrev').disabled = detState.page <= 1;
  document.getElementById('btnDetNext').disabled = detState.page >= totalPages;
}

async function refreshDetecciones() {
  const sentido = document.getElementById('detFilterSentido')?.value || '';
  const q = document.getElementById('detSearch')?.value || '';
  let url = `/api/detections?limit=200`;
  if (sentido) url += `&sentido=${sentido}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  
  try {
    const data = await api('GET', url);
    if (!data) return;
    detState.all = data.items || [];
    detState.query = q;
    applyDetectionFilter(false);
    renderDetecciones();
  } catch (err) { console.error(err); }
}

function refreshDeteccionesDB() {
  return refreshDetecciones();
}

function detPageDB(dir) {
  return detPage(dir);
}

function detPage(dir) {
  const totalPages = Math.max(1, Math.ceil(detState.filtered.length / detState.pageSize));
  if (dir === 'prev') detState.page = Math.max(1, detState.page - 1);
  else detState.page = Math.min(totalPages, detState.page + 1);
  renderDetecciones();
}

function onDetSearch() {
  detState.query = document.getElementById('detSearch')?.value || '';
  applyDetectionFilter(true);
  renderDetecciones();
}

async function clearDetecciones() {
  if (!confirm('¿Limpiar todas las detecciones en memoria?')) return;
  try {
    await api('POST', '/api/detections/clear');
    detState.all = [];
    detState.filtered = [];
    detState.page = 1;
    renderDetecciones();
  } catch (err) { alert(err.message); }
}

async function exportDeteccionesCsv() {
  try {
    const res = await fetch('/api/detections/export.csv', {
      headers: { 'Authorization': 'Bearer ' + _token },
    });
    if (!res.ok) { alert('Error exportando'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'detecciones.csv'; a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert(err.message); }
}

// ── Relay ──────────────────────────────────────────────────────────────────
async function pollRelay() {
  try {
    const d = await api('GET', '/api/relay/status');
    if (!d) return;
    const cardIn  = document.getElementById('relayCardIn');
    const iconIn  = document.getElementById('relayIconIn');
    const lblIn   = document.getElementById('relayLabelIn');
    const timerIn = document.getElementById('relayTimerIn');

    const cardOut  = document.getElementById('relayCardOut');
    const iconOut  = document.getElementById('relayIconOut');
    const lblOut   = document.getElementById('relayLabelOut');
    const timerOut = document.getElementById('relayTimerOut');

    const badge = document.getElementById('relayStatus');

    const openIn = d.in || d.open_in;
    const openOut = d.out || d.open_out;
    const openSinceIn = d.in_open_since || d.open_since_sec_in || 0;
    const openSinceOut = d.out_open_since || d.open_since_sec_out || 0;

    // Actualizar Barrera IN
    if (cardIn && iconIn && lblIn && timerIn) {
      if (openIn) {
        cardIn.classList.add('open');
        iconIn.textContent = 'ON';
        lblIn.textContent  = 'Barrera IN (Ingreso): ABIERTA';
        timerIn.textContent = `Abierta: ${openSinceIn}s`;
        timerIn.classList.remove('hidden');
      } else {
        cardIn.classList.remove('open');
        iconIn.textContent = 'OFF';
        lblIn.textContent  = 'Barrera IN (Ingreso): Cerrada';
        timerIn.classList.add('hidden');
      }
    }

    // Actualizar Barrera OUT
    if (cardOut && iconOut && lblOut && timerOut) {
      if (openOut) {
        cardOut.classList.add('open');
        iconOut.textContent = 'ON';
        lblOut.textContent  = 'Barrera OUT (Salida): ABIERTA';
        timerOut.textContent = `Abierta: ${openSinceOut}s`;
        timerOut.classList.remove('hidden');
      } else {
        cardOut.classList.remove('open');
        iconOut.textContent = 'OFF';
        lblOut.textContent  = 'Barrera OUT (Salida): Cerrada';
        timerOut.classList.add('hidden');
      }
    }

    // Actualizar badge general
    const anyOpen = openIn || openOut;
    if (badge) {
      if (anyOpen) {
        badge.className  = 'badge badge-green';
        let texts = [];
        if (openIn) texts.push(`IN ${openSinceIn}s`);
        if (openOut) texts.push(`OUT ${openSinceOut}s`);
        badge.textContent = `Relé: ABIERTO (${texts.join(' | ')})`;
      } else {
        badge.className  = 'badge badge-gray';
        badge.textContent = d.simulated ? 'Relé: SIMULADO' : 'Relé: CERRADO';
      }
    }
  } catch (_) {}
}

async function abrirBarrera(sentido) {
  const s = sentido || 'in';
  const suffix = s === 'out' ? 'Out' : 'In';
  const card = document.getElementById('relayCard' + suffix);
  const icon = document.getElementById('relayIcon' + suffix);
  const lbl  = document.getElementById('relayLabel' + suffix);
  const timer = document.getElementById('relayTimer' + suffix);
  if (card && icon && lbl && timer) {
    card.classList.add('open');
    icon.textContent = 'ON';
    lbl.textContent  = `Barrera ${s.toUpperCase()} (${s === 'out' ? 'Salida' : 'Ingreso'}): ABIERTA`;
    timer.textContent = 'Abierta: 0.0s';
    timer.classList.remove('hidden');
  }
  try {
    await api('POST', '/api/relay/open', { sentido: s, notas: 'Manual desde dashboard' });
    setTimeout(pollRelay, 150);
  } catch (err) {
    alert(err.message);
    pollRelay();
  }
}

async function cerrarBarrera(sentido) {
  const s = sentido || 'in';
  const suffix = s === 'out' ? 'Out' : 'In';
  const card = document.getElementById('relayCard' + suffix);
  const icon = document.getElementById('relayIcon' + suffix);
  const lbl  = document.getElementById('relayLabel' + suffix);
  const timer = document.getElementById('relayTimer' + suffix);
  if (card && icon && lbl && timer) {
    card.classList.remove('open');
    icon.textContent = 'OFF';
    lbl.textContent  = `Barrera ${s.toUpperCase()} (${s === 'out' ? 'Salida' : 'Ingreso'}): Cerrada`;
    timer.classList.add('hidden');
  }
  try {
    await api('POST', '/api/relay/close', { sentido: s });
    setTimeout(pollRelay, 150);
  } catch (err) {
    alert(err.message);
    pollRelay();
  }
}

async function triggerSimulation(sentido) {
  try {
    const patente = document.getElementById('simPatente').value.trim();
    const dni = document.getElementById('simDni').value.trim();
    if (!patente && !dni) {
      alert('Por favor, ingresa una Patente o un DNI para simular');
      return;
    }
    await api('POST', '/api/relay/simulate', { patente, dni, sentido });
  } catch (err) {
    alert('Error en simulación: ' + err.message);
  }
}

async function simulatePassed(sentido) {
  try {
    const res = await api('POST', '/api/relay/simulate_passed', { sentido: sentido || 'in' });
    pollRelay();
  } catch (err) {
    alert('Error en simulación de paso: ' + err.message);
  }
}

// ── Eventos recientes ──────────────────────────────────────────────────────
async function loadEvents() {
  try {
    const d = await api('GET', '/api/events/recent');
    if (!d) return;
    renderEvents(d.events || []);
  } catch (_) {}
}

function renderEvents(events) {
  const el = document.getElementById('eventsList');
  const lp = document.getElementById('lastPlate');
  if (!events.length) {
    el.innerHTML = '<div class="loading">Sin eventos todavía</div>';
    if (lp) {
      lp.textContent = '';
      lp.classList.add('hidden');
      lp.classList.remove('ok', 'deny');
    }
    return;
  }

  const lastPlateEvent = events.find(ev => !!ev.patente);
  if (lp) {
    if (lastPlateEvent) {
      const ok = lastPlateEvent.resultado === 'autorizado' || lastPlateEvent.resultado === 'manual';
      lp.textContent = `${lastPlateEvent.patente} · ${ok ? 'AUTORIZADO' : 'NO AUTORIZADO'}`;
      lp.classList.remove('hidden');
      lp.classList.toggle('ok', ok);
      lp.classList.toggle('deny', !ok);
    } else {
      lp.textContent = '';
      lp.classList.add('hidden');
      lp.classList.remove('ok', 'deny');
    }
  }

  el.innerHTML = events.map(ev => {
    const isOk = ev.resultado === 'autorizado' || ev.resultado === 'manual';
    const isClose = ev.resultado === 'manual_close' || ev.resultado === 'sensor_close' || ev.resultado === 'timeout_close';
    const badgeCls = isOk ? 'badge-green'
                   : isClose ? 'badge-gray'
                   : 'badge-red';
    const label = resultadoLabel(ev.resultado);
    const hora  = ev.fecha ? ev.fecha.substring(11, 19) : '';
    const placa = ev.patente || '–';
    const motivo = ev.motivo || '';

    return `
      <div class="event-row">
        <span class="event-plate">${placa}</span>
        <div class="event-info">
          <span class="badge ${badgeCls}">${label}</span>
          <div class="event-motivo">${escHtml(motivo)}</div>
        </div>
        <span class="event-time">${hora}</span>
      </div>`;
  }).join('');
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await api('GET', '/api/accesos/stats/totales');
    if (!d) return;
    document.getElementById('kpiAuth').textContent  = d.hoy_autorizado ?? '–';
    document.getElementById('kpiDen').textContent   = d.hoy_denegado   ?? '–';
    document.getElementById('kpiTotal').textContent = d.hoy_total      ?? '–';
  } catch (_) {}
}

// ── Stream status / autoreconnect ─────────────────────────────────────────
let _lastStreamKick = 0;

function setStreamsEnabled(enabled) {
  const inCam = document.getElementById('videoFeedIn');
  const outCam = document.getElementById('videoFeedOut');
  const qr = document.getElementById('videoFeedQr');
  _streamsEnabled = !!enabled;

  if (!inCam) return;

  if (_streamsEnabled) {
    const ts = Date.now();
    const lIn = document.getElementById('loaderIn');
    const lOut = document.getElementById('loaderOut');
    if (lIn) lIn.classList.remove('hidden');
    if (lOut) lOut.classList.remove('hidden');
    inCam.src = `/video_feed/in?t=${ts}`;
    if (outCam) outCam.src = `/video_feed/out?t=${ts}`;
    if (qr) qr.src = `/video_feed_qr?t=${ts}`;
  } else {
    inCam.src = '/static/no-signal.svg';
    if (outCam) outCam.src = '/static/no-signal.svg';
    if (qr) qr.removeAttribute('src');
    const lIn = document.getElementById('loaderIn');
    const lOut = document.getElementById('loaderOut');
    if (lIn) lIn.classList.add('hidden');
    if (lOut) lOut.classList.add('hidden');
  }
}

function refreshVideoFeed(force = false) {
  if (!_streamsEnabled) return;
  const inCam = document.getElementById('videoFeedIn');
  const outCam = document.getElementById('videoFeedOut');
  const qr = document.getElementById('videoFeedQr');
  if (!inCam) return;
  const now = Date.now();
  if (!force && (now - _lastStreamKick) < 5000) return;
  _lastStreamKick = now;
  inCam.src = `/video_feed/in?t=${now}`;
  if (outCam) outCam.src = `/video_feed/out?t=${now}`;
  if (qr) qr.src = `/video_feed_qr?t=${now}`;
}

async function pollStreamStatus() {
  try {
    if (!_streamsEnabled) return;
    const s = await api('GET', '/api/stream/status');
    if (!s) return;
    const badge = document.getElementById('streamStatusBadge');
    if (!badge) return;
    const running = !!s?.alpr?.running;
    if (running) {
      badge.className = 'badge badge-green';
      badge.textContent = 'EN VIVO';
    } else {
      badge.className = 'badge badge-red';
      badge.textContent = 'SIN SEÑAL';
      refreshVideoFeed(true);
    }
  } catch (_) {}
}

// ── Vehículos ──────────────────────────────────────────────────────────────
let _vehiculos = [];

async function loadVehiculos() {
  const q = document.getElementById('filterVeh')?.value || '';
  try {
    _vehiculos = await api('GET', '/api/vehiculos/' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    if (!_vehiculos) return;
    renderVehiculos(_vehiculos);
  } catch (err) { console.error(err); }
}

function renderVehiculos(rows) {
  const tbody = document.getElementById('bodyVehiculos');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading">Sin vehículos</td></tr>'; return; }
  tbody.innerHTML = rows.map(v => `
    <tr>
      <td><span class="mono">${escHtml(v.patente)}</span></td>
      <td>${escHtml(v.descripcion || '')}</td>
      <td>${escHtml(v.propietario || '')}</td>
      <td>${v.requiere_dni ? '✓' : '–'}</td>
      <td>${v.fecha_vencimiento ? v.fecha_vencimiento.substring(0, 10) : '–'}</td>
      <td><span class="badge ${v.activo ? 'badge-green' : 'badge-gray'}">${v.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <button class="btn btn-ghost btn-small" onclick="editVehiculo(${v.id})">Editar</button>
        <button class="btn btn-danger btn-small" onclick="confirmDelete('vehiculo', ${v.id}, '${escHtml(v.patente)}')">Dar de baja</button>
      </td>
    </tr>`).join('');
}

function openVehicleModal(v) {
  const isNew = !v;
  document.getElementById('modalVehTitle').textContent = isNew ? 'Nuevo Vehículo' : 'Editar Vehículo';
  document.getElementById('vehId').value         = v?.id       ?? '';
  document.getElementById('vehPatente').value    = v?.patente  ?? '';
  document.getElementById('vehDesc').value        = v?.descripcion ?? '';
  document.getElementById('vehProp').value        = v?.propietario ?? '';
  document.getElementById('vehVenc').value        = v?.fecha_vencimiento?.substring(0,10) ?? '';
  document.getElementById('vehRequiereDni').checked = v ? v.requiere_dni : true;
  document.getElementById('vehActivo').checked   = v ? v.activo : true;
  document.getElementById('vehHoraDesde').value = v?.hora_desde ?? '';
  document.getElementById('vehHoraHasta').value = v?.hora_hasta ?? '';

  // Sección de personas (solo al editar)
  const persSection = document.getElementById('vehPersonasSection');
  if (!isNew && v) {
    persSection.classList.remove('hidden');
    renderVehPersonas(v);
    loadPersonaSelect(v.id);
  } else {
    persSection.classList.add('hidden');
  }

  document.getElementById('modalVehiculo').classList.remove('hidden');
}

async function editVehiculo(id) {
  const v = _vehiculos.find(x => x.id === id);
  if (v) openVehicleModal(v);
}

function renderVehPersonas(v) {
  const el = document.getElementById('vehPersonasList');
  if (!v.personas?.length) { el.innerHTML = '<p style="color:var(--text-sub);font-size:.85rem">Sin personas vinculadas</p>'; return; }
  el.innerHTML = v.personas.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${escHtml(p.nombre)} <small style="color:var(--text-sub)">DNI ${p.dni}</small>
      ${p.puede_conducir ? '<span class="badge badge-blue" style="margin-left:6px">Conductor</span>' : ''}</span>
      <button class="btn btn-danger btn-small" onclick="desvincularPersona(${v.id},${p.id})">✕</button>
    </div>`).join('');
}

async function loadPersonaSelect(vehId) {
  try {
    const personas = await api('GET', '/api/personas/');
    const sel = document.getElementById('vehPersonaSelect');
    const veh = _vehiculos.find(x => x.id === vehId);
    const vinculados = new Set((veh?.personas || []).map(p => p.id));
    sel.innerHTML = '<option value="">Seleccionar persona…</option>'
      + (personas || []).filter(p => !vinculados.has(p.id) && p.activo)
          .map(p => `<option value="${p.id}">${escHtml(p.apellido + ', ' + p.nombre)} — ${p.dni}</option>`)
          .join('');
  } catch (_) {}
}

async function vincularPersona() {
  const vehId = document.getElementById('vehId').value;
  const pid   = document.getElementById('vehPersonaSelect').value;
  if (!vehId || !pid) return;
  try {
    await api('POST', `/api/vehiculos/${vehId}/persona/${pid}`, { puede_conducir: true });
    await loadVehiculos();
    const v = _vehiculos.find(x => x.id == vehId);
    if (v) { renderVehPersonas(v); loadPersonaSelect(v.id); }
  } catch (err) { alert(err.message); }
}

async function desvincularPersona(vehId, pid) {
  try {
    await api('DELETE', `/api/vehiculos/${vehId}/persona/${pid}`);
    await loadVehiculos();
    const v = _vehiculos.find(x => x.id === vehId);
    if (v) renderVehPersonas(v);
  } catch (err) { alert(err.message); }
}

async function saveVehiculo() {
  const id = document.getElementById('vehId').value;
  const body = {
    patente:          document.getElementById('vehPatente').value.trim().toUpperCase(),
    descripcion:      document.getElementById('vehDesc').value.trim() || null,
    propietario:      document.getElementById('vehProp').value.trim() || null,
    requiere_dni:     document.getElementById('vehRequiereDni').checked,
    activo:           document.getElementById('vehActivo').checked,
    fecha_vencimiento: document.getElementById('vehVenc').value || null,
    hora_desde:       document.getElementById('vehHoraDesde').value || null,
    hora_hasta:       document.getElementById('vehHoraHasta').value || null,
  };

  if (!body.patente) { alert('La patente es obligatoria'); return; }

  try {
    if (id) {
      await api('PUT', `/api/vehiculos/${id}`, body);
    } else {
      await api('POST', '/api/vehiculos/', body);
    }
    closeModal('modalVehiculo');
    loadVehiculos();
  } catch (err) { alert(err.message); }
}

// ── Personas ───────────────────────────────────────────────────────────────
let _personas = [];

async function loadPersonas() {
  const q = document.getElementById('filterPer')?.value || '';
  try {
    _personas = await api('GET', '/api/personas/' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    if (!_personas) return;
    renderPersonas(_personas);
  } catch (err) { console.error(err); }
}

function renderPersonas(rows) {
  const tbody = document.getElementById('bodyPersonas');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="loading">Sin personas</td></tr>'; return; }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td><span class="mono">${escHtml(p.dni)}</span></td>
      <td>${escHtml(p.apellido)}</td>
      <td>${escHtml(p.nombre)}</td>
      <td>${(p.vehiculos || []).map(v => `<span class="badge badge-blue">${escHtml(v.patente)}</span>`).join(' ')}</td>
      <td><span class="badge ${p.activo ? 'badge-green' : 'badge-gray'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <button class="btn btn-ghost btn-small" onclick="editPersona(${p.id})">Editar</button>
        <button class="btn btn-danger btn-small" onclick="confirmDelete('persona', ${p.id}, '${escHtml(p.apellido + ' ' + p.nombre)}')">Dar de baja</button>
      </td>
    </tr>`).join('');
}

function openPersonaModal(p) {
  const isNew = !p;
  document.getElementById('modalPerTitle').textContent = isNew ? 'Nueva Persona' : 'Editar Persona';
  document.getElementById('perId').value       = p?.id       ?? '';
  document.getElementById('perDni').value      = p?.dni      ?? '';
  document.getElementById('perApellido').value = p?.apellido ?? '';
  document.getElementById('perNombre').value   = p?.nombre   ?? '';
  document.getElementById('perSexo').value     = p?.sexo     ?? '';
  document.getElementById('perNacimiento').value = p?.fecha_nacimiento ?? '';
  document.getElementById('perTramite').value  = p?.tramite  ?? '';
  document.getElementById('perHoraDesde').value = p?.hora_desde ?? '';
  document.getElementById('perHoraHasta').value = p?.hora_hasta ?? '';
  document.getElementById('perActivo').checked = p ? p.activo : true;

  // Foto de perfil
  const fotoPath = p?.foto_path ?? '';
  document.getElementById('perFotoPath').value = fotoPath;
  const imgPreview = document.getElementById('perFotoPreview');
  const placeholder = document.getElementById('perFotoPlaceholder');
  if (fotoPath) {
    imgPreview.src = fotoPath;
    imgPreview.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    imgPreview.removeAttribute('src');
    imgPreview.style.display = 'none';
    placeholder.style.display = 'block';
  }

  // Patentes
  document.getElementById('perPatentes').value = p?.patentes ?? '';

  // Limpiar feedback del lector DNI
  const feedback = document.getElementById('dniScanFeedback');
  if (feedback) {
    feedback.textContent = 'Carga la última lectura del DNI físico escaneado.';
    feedback.style.color = 'var(--text-sub)';
  }

  document.getElementById('modalPersona').classList.remove('hidden');
}

async function editPersona(id) {
  const p = _personas.find(x => x.id === id);
  if (p) openPersonaModal(p);
}

async function savePersona() {
  const id = document.getElementById('perId').value;
  const body = {
    dni:      document.getElementById('perDni').value.trim(),
    apellido: document.getElementById('perApellido').value.trim(),
    nombre:   document.getElementById('perNombre').value.trim(),
    sexo:     document.getElementById('perSexo').value,
    fecha_nacimiento: document.getElementById('perNacimiento').value || null,
    tramite:  document.getElementById('perTramite').value.trim() || null,
    hora_desde: document.getElementById('perHoraDesde').value || null,
    hora_hasta: document.getElementById('perHoraHasta').value || null,
    activo:   document.getElementById('perActivo').checked,
    foto_path: document.getElementById('perFotoPath').value || null,
    patentes:  document.getElementById('perPatentes').value.trim() || null,
  };

  if (!body.dni || !body.apellido || !body.nombre) { alert('Los campos DNI, Apellido y Nombre son obligatorios'); return; }

  try {
    if (id) {
      await api('PUT', `/api/personas/${id}`, body);
    } else {
      await api('POST', '/api/personas/', body);
    }
    closeModal('modalPersona');
    loadPersonas();
  } catch (err) { alert(err.message); }
}

async function uploadPersonaPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/personas/photo', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionStorage.getItem('token') || ''}`
      },
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Error al subir foto');
    }

    const data = await res.json();
    if (data.ok && data.url) {
      document.getElementById('perFotoPath').value = data.url;
      const imgPreview = document.getElementById('perFotoPreview');
      const placeholder = document.getElementById('perFotoPlaceholder');
      imgPreview.src = data.url;
      imgPreview.style.display = 'block';
      placeholder.style.display = 'none';
    }
  } catch (err) {
    alert('Error al subir imagen: ' + err.message);
  }
}

async function autofillFromDniScanner() {
  const feedback = document.getElementById('dniScanFeedback');
  if (feedback) {
    feedback.textContent = 'Buscando lectura reciente...';
    feedback.style.color = 'var(--yellow)';
  }

  try {
    const res = await api('GET', '/api/personas/latest-dni');
    if (res && res.ok) {
      document.getElementById('perDni').value = res.dni || '';
      document.getElementById('perNombre').value = res.nombre || '';
      document.getElementById('perApellido').value = res.apellido || '';
      
      if (res.sexo) {
        document.getElementById('perSexo').value = res.sexo.toUpperCase();
      }
      
      if (res.nacimiento) {
        let formattedDate = res.nacimiento;
        if (formattedDate.includes('/')) {
          const parts = formattedDate.split('/');
          if (parts.length === 3) {
            formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }
        document.getElementById('perNacimiento').value = formattedDate;
      }
      
      if (res.tramite) {
        document.getElementById('perTramite').value = res.tramite;
      }

      if (feedback) {
        feedback.textContent = '¡DNI cargado con éxito!';
        feedback.style.color = 'var(--green)';
      }
    } else {
      if (feedback) {
        feedback.textContent = res.message || 'No se encontró ninguna lectura reciente de DNI.';
        feedback.style.color = 'var(--red)';
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.textContent = 'Error al consultar lector: ' + err.message;
      feedback.style.color = 'var(--red)';
    }
  }
}

// ── Historial ──────────────────────────────────────────────────────────────
async function loadHistorial() {
  const params = new URLSearchParams({ limit: 200, offset: histOffset });
  const patente   = document.getElementById('filtHistPatente')?.value.trim();
  const resultado = document.getElementById('filtHistResultado')?.value;
  const desde     = document.getElementById('filtHistDesde')?.value;
  const hasta     = document.getElementById('filtHistHasta')?.value;

  if (patente)   params.set('patente', patente);
  if (resultado) params.set('resultado', resultado);
  if (desde)     params.set('desde', desde + 'T00:00:00');
  if (hasta)     params.set('hasta', hasta + 'T23:59:59');

  try {
    const d = await api('GET', `/api/accesos/?${params}`);
    if (!d) return;
    document.getElementById('histTotal').textContent     = d.total;
    document.getElementById('histMostrando').textContent = d.items.length;
    document.getElementById('btnHistPrev').disabled = histOffset <= 0;
    document.getElementById('btnHistNext').disabled = (histOffset + 200) >= d.total;

    const tbody = document.getElementById('bodyHistorial');
    if (!d.items.length) { tbody.innerHTML = '<tr><td colspan="6" class="loading">Sin resultados</td></tr>'; return; }

    tbody.innerHTML = d.items.map(a => {
      const badgeCls = (a.resultado === 'autorizado' || a.resultado === 'manual') ? 'badge-green'
                     : a.resultado.startsWith('denegado') ? 'badge-red'
                     : 'badge-gray';
      const fecha = a.fecha_hora ? formatFecha(a.fecha_hora) : '';
      const conf  = a.ocr_conf ? (a.ocr_conf * 100).toFixed(0) + '%' : '–';
      return `<tr>
        <td style="white-space:nowrap">${fecha}</td>
        <td><span class="mono">${escHtml(a.patente || '–')}</span></td>
        <td><span class="mono">${escHtml(a.dni || '–')}</span></td>
        <td><span class="badge ${badgeCls}">${resultadoLabel(a.resultado)}</span></td>
        <td>${escHtml(a.motivo || '')}</td>
        <td>${conf}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error(err); }
}

// ── Confirmacion ───────────────────────────────────────────────────────────
function confirmDelete(type, id, label) {
  const modal = document.getElementById('modalConfirm');
  document.getElementById('confirmTitle').textContent = 'Confirmar baja';
  document.getElementById('confirmMsg').textContent   = `¿Dar de baja a "${label}"?`;
  const btn = document.getElementById('confirmBtn');
  btn.onclick = async () => {
    try {
      await api('DELETE', `/api/${type === 'vehiculo' ? 'vehiculos' : 'personas'}/${id}`);
      closeModal('modalConfirm');
      if (type === 'vehiculo') loadVehiculos();
      else loadPersonas();
    } catch (err) { alert(err.message); }
  };
  modal.classList.remove('hidden');
}

// ── Modales ────────────────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatFecha(iso) {
  if (!iso) return '-';
  try {
    const [datePart, timePartRaw] = String(iso).split('T');
    if (!datePart) return String(iso);
    const [y, m, d] = datePart.split('-');
    const timePart = timePartRaw ? timePartRaw.split('.')[0].substring(0, 5) : '';
    const yr = y.length === 4 ? y.substring(2) : y;
    return `${d}/${m}/${yr} ${timePart}`.trim();
  } catch (_) {
    const parts = String(iso).replace('T', ' ').split('.')[0].split(':');
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : String(iso);
  }
}

function resultadoLabel(r) {
  const map = {
    'autorizado':       'Autorizado',
    'manual':           'Apertura Manual',
    'manual_close':     'Cierre Manual',
    'sensor_close':     'Paso (Sensor)',
    'timeout_close':    'Cierre Automático',
    'denegado_patente': 'Den. Patente',
    'denegado_dni':     'Den. DNI',
    'denegado_ambos':   'Den. Ambos',
    'timeout':          'Timeout',
  };
  return map[r] || r;
}

// ══════════════════════════════════════════════════════════════════
//  ROI EDITOR — Dibujar sobre imagen en vivo
// ══════════════════════════════════════════════════════════════════
const roiState = { dragging: false, dirty: false, x: 0, y: 0, w: 1, h: 1 };
var _roiSentido = 'in';

function clamp01(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : Math.max(0, Math.min(1, n));
}

function getRoiCanvas() { return document.getElementById('roiCanvas'); }
function getRoiImage()  { return document.getElementById('roiImage'); }

function syncRoiCanvasSize() {
  const canvas = getRoiCanvas();
  const img = getRoiImage();
  if (!canvas || !img) return;
  const r = img.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    canvas.width  = r.width;
    canvas.height = r.height;
  }
}

function drawRoiOverlay() {
  const canvas = getRoiCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const enabled = document.getElementById('roiEnabled')?.checked;
  if (!enabled && !roiState.dirty) return;

  const x = roiState.x * canvas.width;
  const y = roiState.y * canvas.height;
  const w = roiState.w * canvas.width;
  const h = roiState.h * canvas.height;

  // Oscurecer fuera del ROI
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(x, y, w, h);

  // Borde del ROI
  ctx.strokeStyle = '#f5c518';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Label
  ctx.fillStyle = '#f5c518';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`ROI: ${Math.round(roiState.w*100)}% × ${Math.round(roiState.h*100)}%`, x + 4, y > 18 ? y - 5 : y + h + 15);
}

function updateRoiInputsFromState() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v.toFixed(4); };
  set('roiX', roiState.x); set('roiY', roiState.y);
  set('roiW', roiState.w); set('roiH', roiState.h);
}

function setRoiEnabledUi(enabled) {
  const a = document.getElementById('roiEnabled');
  if (a) a.checked = !!enabled;
}

async function loadRoi() {
  try {
    const roi = await api('GET', '/api/roi?sentido=' + _roiSentido);
    setRoiEnabledUi(!!roi.roi_enabled);
    roiState.x = clamp01(roi.roi_x, 0);
    roiState.y = clamp01(roi.roi_y, 0);
    roiState.w = Math.max(0.05, clamp01(roi.roi_w, 1));
    roiState.h = Math.max(0.05, clamp01(roi.roi_h, 1));
    roiState.dirty = false;
    updateRoiInputsFromState();
    setTimeout(() => { syncRoiCanvasSize(); drawRoiOverlay(); }, 300);
  } catch (err) { console.error(err); }
}

async function saveRoiDraw() {
  try {
    roiState.dragging = false;
    const payload = {
      roi_enabled: !!document.getElementById('roiEnabled')?.checked,
      roi_x: roiState.x, roi_y: roiState.y,
      roi_w: roiState.w, roi_h: roiState.h,
      persist: true,
    };
    await api('POST', '/api/roi?sentido=' + _roiSentido, payload);
    roiState.dirty = false;
    drawRoiOverlay();
    alert('ROI guardado para ' + (_roiSentido === 'in' ? 'INGRESO' : 'SALIDA'));
  } catch (err) { console.error(err); alert('Error guardando ROI'); }
}
// Alias para compatibilidad
async function saveRoi() { return saveRoiDraw(); }

async function clearRoiDraw() {
  setRoiEnabledUi(false);
  roiState.x = 0; roiState.y = 0; roiState.w = 1; roiState.h = 1;
  roiState.dirty = true;
  updateRoiInputsFromState();
  drawRoiOverlay();
  await saveRoiDraw();
}
async function clearRoiAndSave() { return clearRoiDraw(); }

function setupRoiDraw() {
  const canvas = getRoiCanvas();
  const img    = getRoiImage();
  if (!canvas || !img) return;

  const getPoint = (ev) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width - 1, (ev.clientX - r.left) * (canvas.width / r.width))),
      y: Math.max(0, Math.min(canvas.height - 1, (ev.clientY - r.top) * (canvas.height / r.height))),
    };
  };

  let sx = 0, sy = 0;
  canvas.addEventListener('mousedown', ev => {
    roiState.dragging = true; roiState.dirty = true;
    setRoiEnabledUi(true);
    const p = getPoint(ev);
    sx = p.x; sy = p.y;
    roiState.x = sx / canvas.width;
    roiState.y = sy / canvas.height;
    roiState.w = 0.01; roiState.h = 0.01;
    updateRoiInputsFromState(); drawRoiOverlay();
  });
  canvas.addEventListener('mousemove', ev => {
    if (!roiState.dragging) return;
    const p = getPoint(ev);
    const x1 = Math.min(sx, p.x), y1 = Math.min(sy, p.y);
    const x2 = Math.max(sx, p.x), y2 = Math.max(sy, p.y);
    roiState.x = x1 / canvas.width;  roiState.y = y1 / canvas.height;
    roiState.w = Math.max(0.05, (x2-x1) / canvas.width);
    roiState.h = Math.max(0.05, (y2-y1) / canvas.height);
    roiState.dirty = true;
    setRoiEnabledUi(true);
    updateRoiInputsFromState(); drawRoiOverlay();
  });
  const finishDraw = () => {
    if (!roiState.dragging) return;
    roiState.dragging = false;
  };
  canvas.addEventListener('mouseup', finishDraw);
  canvas.addEventListener('mouseleave', finishDraw);
  window.addEventListener('mouseup', finishDraw);

  img.addEventListener('load', () => { syncRoiCanvasSize(); drawRoiOverlay(); });
  window.addEventListener('resize', () => { syncRoiCanvasSize(); drawRoiOverlay(); });
}

function wireRoiButtons() {
  document.getElementById('roiEnabled')?.addEventListener('change', ev => {
    setRoiEnabledUi(!!ev.target.checked); roiState.dirty = true; drawRoiOverlay();
  });
}


// ══════════════════════════════════════════════════════════════════
//  ACTIVIDAD (CHART.JS)
// ══════════════════════════════════════════════════════════════════
let _hourlyChart = null;
let _chartMode  = 'today';

function initHourlyChart() {
  const canvas = document.getElementById('hourlyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const ctx = canvas.getContext('2d');
  _hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Ingresos (IN)',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.65)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 3
        },
        {
          label: 'Egresos (OUT)',
          data: [],
          backgroundColor: 'rgba(59, 130, 246, 0.65)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#8a90aa', font: { size: 10 } }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8a90aa', stepSize: 1 }, grid: { color: 'rgba(255,255,255,.07)' } },
        x: { ticks: { color: '#8a90aa', maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

async function updateHourlyChart() {
  try {
    const d = await api('GET', '/api/stats/hourly');
    if (!d) return;
    const src = _chartMode === 'today' ? d.today : d.last7days;
    if (_hourlyChart) {
      _hourlyChart.data.labels = src.labels;
      _hourlyChart.data.datasets[0].data = src.in || src.counts;
      _hourlyChart.data.datasets[1].data = src.out || [];
      _hourlyChart.update();
    }
    const msg = document.getElementById('chartMsg');
    if (msg) msg.textContent = `Hoy ${d.date} · Omitidos dedup: ${d.dedup_skipped} · Total histórico: ${d.total_db}`;
  } catch (err) { console.error(err); }
}

function wireChartButtons() {
  document.getElementById('btnChartToday')?.addEventListener('click', () => {
    _chartMode = 'today';
    document.getElementById('btnChartToday')?.classList.add('active');
    document.getElementById('btnChart7days')?.classList.remove('active');
    updateHourlyChart();
  });
  document.getElementById('btnChart7days')?.addEventListener('click', () => {
    _chartMode = '7days';
    document.getElementById('btnChart7days')?.classList.add('active');
    document.getElementById('btnChartToday')?.classList.remove('active');
    updateHourlyChart();
  });
}


// ══════════════════════════════════════════════════════════════════
//  CÁMARAS
// ══════════════════════════════════════════════════════════════════
function setCamMsg(msg) {
  const el = document.getElementById('camMsg'); if (el) el.textContent = msg;
}

function wireCameraButtons() {
  document.getElementById('btnCamSave')?.addEventListener('click', saveRuntimeConfig);
}


// ══════════════════════════════════════════════════════════════════
//  RENDIMIENTO (RUNTIME CONFIG)
// ══════════════════════════════════════════════════════════════════
let _cfgData = {};
let _cfgSubTabs = { alpr: 'in', evi: 'in', dni: 'in' };

function switchCfgTab(tabId) {
  document.querySelectorAll('.cfg-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.cfg-tab-content').forEach(c => c.classList.add('hidden'));
  const btn = document.querySelector(`.cfg-tab[onclick="switchCfgTab('${tabId}')"]`);
  if (btn) btn.classList.add('active');
  const content = document.getElementById(`cfgContent-${tabId}`);
  if (content) content.classList.remove('hidden');
  if (tabId === 'barreras') loadSubsystems();
  if (tabId === 'almacenamiento') loadEvidenceConfig();
  if (tabId === 'operadores') loadOperadores();
}

// ── Subsystem Panel (Granular Control) ─────────────────────────────────────
let _subsysRefreshTimer = null;

async function loadSubsystems() {
  try {
    const d = await api('GET', '/api/subsystems');
    if (!d) return;

    // Helper to set LED + detail + toggle
    function _set(led, detail, toggle, running, detailText) {
      const el = document.getElementById(led);
      if (el) { el.className = 'subsys-led ' + (running ? 'led-green' : 'led-red'); }
      const dt = document.getElementById(detail);
      if (dt) dt.textContent = detailText;
      const tg = document.getElementById(toggle);
      if (tg) tg.checked = running;
    }

    // ALPR
    _set('ledAlprIn', 'detailAlprIn', 'toggleAlprIn',
      d.alpr_in.running,
      d.alpr_in.running ? `Activo — ${d.alpr_in.source}` : (d.alpr_in.last_error || 'Detenido'));
    _set('ledAlprOut', 'detailAlprOut', 'toggleAlprOut',
      d.alpr_out.running,
      d.alpr_out.running ? `Activo — ${d.alpr_out.source}` : (d.alpr_out.last_error || 'Detenido'));

    // QR
    _set('ledQrIn', 'detailQrIn', 'toggleQrIn',
      d.qr_in.running,
      d.qr_in.running ? `Tipo: ${d.qr_in.type} — ${d.qr_in.com_port || d.qr_in.camera_source}` : (d.qr_in.last_error || 'Detenido'));
    _set('ledQrOut', 'detailQrOut', 'toggleQrOut',
      d.qr_out.running,
      d.qr_out.running ? `Tipo: ${d.qr_out.type} — ${d.qr_out.com_port || d.qr_out.camera_source}` : (d.qr_out.last_error || 'Detenido'));

    // Snapshots
    _set('ledSnapIn', 'detailSnapIn', 'toggleSnapIn',
      d.snapshot_enabled_in, d.snapshot_enabled_in ? 'Habilitada' : 'Deshabilitada');
    _set('ledSnapOut', 'detailSnapOut', 'toggleSnapOut',
      d.snapshot_enabled_out, d.snapshot_enabled_out ? 'Habilitada' : 'Deshabilitada');

    // Relay
    const rl = d.relay;
    const relayLed = document.getElementById('ledRelay');
    if (relayLed) relayLed.className = 'subsys-led ' + (rl.simulated ? 'led-yellow' : 'led-green');
    const relayDetail = document.getElementById('detailRelay');
    if (relayDetail) relayDetail.textContent = rl.simulated
      ? 'Modo simulado (sin Arduino)'
      : `Conectado en ${rl.port} — IN: ${rl.open_in ? 'ABIERTA' : 'cerrada'} / OUT: ${rl.open_out ? 'ABIERTA' : 'cerrada'}`;
    const relayBadge = document.getElementById('badgeRelay');
    if (relayBadge) {
      relayBadge.textContent = rl.simulated ? 'Simulado' : rl.port;
      relayBadge.className = 'badge ' + (rl.simulated ? 'badge-yellow' : 'badge-green');
    }

  } catch (err) { console.error('Error loading subsystems:', err); }
}

async function toggleSubsystem(subsystem, enable) {
  try {
    const res = await api('POST', '/api/subsystems/toggle', {
      subsystem: subsystem,
      action: enable ? 'start' : 'stop'
    });
    if (res?.msg) {
      console.log(`[SUBSYS] ${res.msg}`);
    }
    // Refresh after a short delay to let the service start/stop
    setTimeout(loadSubsystems, 600);
  } catch (err) {
    alert('Error: ' + err.message);
    loadSubsystems(); // Refresh to revert toggle state
  }
}

function switchCfgSubTab(group, sentido) {
  _cfgSubTabs[group] = sentido;
  document.querySelectorAll(`[id^="subtab${group.toUpperCase()}"]`).forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`subtab${group.toUpperCase()}-${sentido}`);
  if (btn) btn.classList.add('active');
  
  // Render that specific form
  if (group === 'alpr') {
    renderAlprForm();
    switchRoiSentido(sentido);
  }
  if (group === 'evi') renderEviForm();
  if (group === 'dni') renderDniForm();
}

function parseRtsp(url) {
  let res = { host: '', port: 554, user: '', pass: '', path: '/cam/realmonitor', channel: 1, full: url || '' };
  if (!url || !url.startsWith('rtsp')) { res.host = url || ''; return res; }
  try {
    const u = new URL(url);
    res.host = u.hostname; res.port = u.port || 554;
    res.user = decodeURIComponent(u.username || ''); res.pass = decodeURIComponent(u.password || '');
    res.path = u.pathname;
    const ch = u.searchParams.get('channel'); if (ch) res.channel = parseInt(ch);
  } catch(e) {}
  return res;
}

function buildRtsp(host, port, user, pass, path, channel) {
  if (!host) return '';
  if (!host.includes('.')) return host; // e.g., '0'
  let creds = '';
  if (user) creds = encodeURIComponent(user) + (pass ? ':' + encodeURIComponent(pass) : '') + '@';
  return `rtsp://${creds}${host}:${port || 554}${path}?channel=${channel || 1}&subtype=0`;
}

// Bind live updates
function bindFormLiveRtsp(prefix) {
  const updateRtsp = () => {
    const s = buildRtsp(
      document.getElementById(`${prefix}Host`).value,
      document.getElementById(`${prefix}Port`).value,
      document.getElementById(`${prefix}User`).value,
      document.getElementById(`${prefix}Pass`).value,
      document.getElementById(`${prefix}Path`)?.value || '/cam/realmonitor',
      document.getElementById(`${prefix}Channel`)?.value || 1
    );
    document.getElementById(`${prefix}Source`).value = s;
  };
  ['Host','Port','User','Pass','Path','Channel'].forEach(f => {
    const el = document.getElementById(`${prefix}${f}`);
    if (el) el.addEventListener('input', updateRtsp);
  });
}

async function loadRuntimeConfig() {
  try {
    _cfgData = await api('GET', '/api/config') || {};
    renderAlprForm();
    renderEviForm();
    renderDniForm();
    renderMotorForm();
    renderBarrierForm();
  } catch (err) { console.error(err); }
}

function toggleBarrierFields(sentido) {
  const isIn = sentido === 'in';
  const typeVal = document.getElementById(isIn ? 'barrierTypeIn' : 'barrierTypeOut')?.value || 'disabled';
  const comDiv = document.getElementById(isIn ? 'barrierComFieldsIn' : 'barrierComFieldsOut');
  const ipDiv = document.getElementById(isIn ? 'barrierIpFieldsIn' : 'barrierIpFieldsOut');
  
  if (comDiv) comDiv.style.display = typeVal === 'com' ? 'block' : 'none';
  if (ipDiv) ipDiv.style.display = typeVal === 'ip' ? 'block' : 'none';
}

async function renderBarrierForm() {
  const d = _cfgData;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  
  set('barrierTypeIn', d.barrier_type_in || 'simulated');
  set('barrierBaudrateIn', d.barrier_baudrate_in || 9600);
  set('barrierIpIn', d.barrier_ip_in || '');
  set('barrierIpPortIn', d.barrier_ip_port_in || 80);
  set('barrierIpProtocolIn', d.barrier_ip_protocol_in || 'tcp');
  set('barrierIpCmdOpenIn', d.barrier_ip_cmd_open_in || '');
  set('barrierIpCmdCloseIn', d.barrier_ip_cmd_close_in || '');
  set('barrierMaxOpenSecIn', d.barrier_max_open_sec_in || 0);

  set('barrierTypeOut', d.barrier_type_out || 'simulated');
  set('barrierBaudrateOut', d.barrier_baudrate_out || 9600);
  set('barrierIpOut', d.barrier_ip_out || '');
  set('barrierIpPortOut', d.barrier_ip_port_out || 80);
  set('barrierIpProtocolOut', d.barrier_ip_protocol_out || 'tcp');
  set('barrierIpCmdOpenOut', d.barrier_ip_cmd_open_out || '');
  set('barrierIpCmdCloseOut', d.barrier_ip_cmd_close_out || '');
  set('barrierMaxOpenSecOut', d.barrier_max_open_sec_out || 0);

  const selectPortIn = document.getElementById('barrierPortIn');
  const selectPortOut = document.getElementById('barrierPortOut');
  if (selectPortIn || selectPortOut) {
    try {
      const ports = await api('GET', '/api/com-ports');
      let html = '<option value="">(Simulador)</option>';
      if (ports && ports.length > 0) {
        ports.forEach(p => { html += `<option value="${p.port}">${p.port} - ${p.desc}</option>`; });
      } else {
        html = '<option value="">No se detectaron puertos COM</option>';
      }
      if (selectPortIn) {
        selectPortIn.innerHTML = html;
        selectPortIn.value = d.barrier_port_in || '';
      }
      if (selectPortOut) {
        selectPortOut.innerHTML = html;
        selectPortOut.value = d.barrier_port_out || '';
      }
    } catch (e) {
      console.error(e);
      if (selectPortIn) selectPortIn.innerHTML = '<option value="">Error cargando puertos</option>';
      if (selectPortOut) selectPortOut.innerHTML = '<option value="">Error cargando puertos</option>';
    }
  }

  toggleBarrierFields('in');
  toggleBarrierFields('out');
}

async function saveBarrierTab() {
  _cfgData.barrier_type_in = document.getElementById('barrierTypeIn').value;
  _cfgData.barrier_port_in = document.getElementById('barrierPortIn').value;
  _cfgData.barrier_baudrate_in = parseInt(document.getElementById('barrierBaudrateIn').value || 9600);
  _cfgData.barrier_ip_in = document.getElementById('barrierIpIn').value.trim();
  _cfgData.barrier_ip_port_in = parseInt(document.getElementById('barrierIpPortIn').value || 80);
  _cfgData.barrier_ip_protocol_in = document.getElementById('barrierIpProtocolIn').value;
  _cfgData.barrier_ip_cmd_open_in = document.getElementById('barrierIpCmdOpenIn').value.trim();
  _cfgData.barrier_ip_cmd_close_in = document.getElementById('barrierIpCmdCloseIn').value.trim();
  _cfgData.barrier_max_open_sec_in = parseInt(document.getElementById('barrierMaxOpenSecIn').value || 0);

  _cfgData.barrier_type_out = document.getElementById('barrierTypeOut').value;
  _cfgData.barrier_port_out = document.getElementById('barrierPortOut').value;
  _cfgData.barrier_baudrate_out = parseInt(document.getElementById('barrierBaudrateOut').value || 9600);
  _cfgData.barrier_ip_out = document.getElementById('barrierIpOut').value.trim();
  _cfgData.barrier_ip_port_out = parseInt(document.getElementById('barrierIpPortOut').value || 80);
  _cfgData.barrier_ip_protocol_out = document.getElementById('barrierIpProtocolOut').value;
  _cfgData.barrier_ip_cmd_open_out = document.getElementById('barrierIpCmdOpenOut').value.trim();
  _cfgData.barrier_ip_cmd_close_out = document.getElementById('barrierIpCmdCloseOut').value.trim();
  _cfgData.barrier_max_open_sec_out = parseInt(document.getElementById('barrierMaxOpenSecOut').value || 0);

  await saveConfigPartial();
}

async function testBarrier(sentido, action) {
  try {
    if (action === 'open') {
      const res = await api('POST', '/api/relay/open', { sentido: sentido, notas: "Prueba manual de apertura" });
      if (res) {
        showToast({ type: 'ACCESS_RESULT', resultado: 'manual', sentido: sentido, data: { status: 'APERTURA MANUAL ENVIADA' } });
      }
    } else {
      const res = await api('POST', '/api/relay/close', { sentido: sentido });
      if (res) {
        showToast({ type: 'ACCESS_RESULT', resultado: 'manual', sentido: sentido, data: { status: 'CIERRE MANUAL ENVIADO' } });
      }
    }
  } catch(e) {
    alert("Error de red al probar barrera: " + e.message);
  }
}

function renderAlprForm() {
  const s = _cfgSubTabs.alpr;
  document.getElementById('alprTitle').textContent = `ALPR - ${s === 'in' ? 'Ingreso (IN)' : 'Salida (OUT)'}`;
  const url = s === 'in' ? _cfgData.camera_source_in : _cfgData.camera_source_out;
  const p = parseRtsp(url);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('alprHost', p.host); set('alprPort', p.port); set('alprUser', p.user);
  set('alprPass', p.pass); set('alprPath', p.path); set('alprChannel', p.channel);
  set('alprSource', p.full);

  // Set new HUD properties
  const hudEnabled = s === 'in' ? _cfgData.hud_overlay_enabled_in : _cfgData.hud_overlay_enabled_out;
  const hudPos = s === 'in' ? _cfgData.hud_overlay_position_in : _cfgData.hud_overlay_position_out;
  
  const chk = document.getElementById('hudOverlayEnabled');
  if (chk) chk.checked = !!hudEnabled;
  const sel = document.getElementById('hudOverlayPosition');
  if (sel) sel.value = hudPos || (s === 'in' ? 'bottom-left' : 'bottom-right');

  // Set CPU saving properties
  const motionEnabled = s === 'in' ? _cfgData.motion_detection_enabled_in : _cfgData.motion_detection_enabled_out;
  const motionThresh = s === 'in' ? _cfgData.motion_threshold_in : _cfgData.motion_threshold_out;
  const motionCooldown = s === 'in' ? _cfgData.motion_cooldown_sec_in : _cfgData.motion_cooldown_sec_out;

  const mChk = document.getElementById('motionDetectionEnabled');
  if (mChk) mChk.checked = motionEnabled !== undefined ? !!motionEnabled : true;
  const mSel = document.getElementById('motionThreshold');
  if (mSel) mSel.value = motionThresh !== undefined ? motionThresh : 0.005;
  const mInp = document.getElementById('motionCooldownSec');
  if (mInp) mInp.value = motionCooldown !== undefined ? motionCooldown : 3.0;
}

async function saveAlprTab() {
  const s = _cfgSubTabs.alpr;
  const val = document.getElementById('alprSource').value.trim();
  
  const motionEnabled = document.getElementById('motionDetectionEnabled').checked;
  const motionThresh = parseFloat(document.getElementById('motionThreshold').value);
  const motionCooldown = parseFloat(document.getElementById('motionCooldownSec').value);

  if (s === 'in') {
    _cfgData.camera_source_in = val;
    _cfgData.hud_overlay_enabled_in = document.getElementById('hudOverlayEnabled').checked;
    _cfgData.hud_overlay_position_in = document.getElementById('hudOverlayPosition').value;
    _cfgData.motion_detection_enabled_in = motionEnabled;
    _cfgData.motion_threshold_in = motionThresh;
    _cfgData.motion_cooldown_sec_in = motionCooldown;
  } else {
    _cfgData.camera_source_out = val;
    _cfgData.hud_overlay_enabled_out = document.getElementById('hudOverlayEnabled').checked;
    _cfgData.hud_overlay_position_out = document.getElementById('hudOverlayPosition').value;
    _cfgData.motion_detection_enabled_out = motionEnabled;
    _cfgData.motion_threshold_out = motionThresh;
    _cfgData.motion_cooldown_sec_out = motionCooldown;
  }
  await saveConfigPartial();
}

function renderEviForm() {
  const d = _cfgData;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };

  // Popular IN
  const pIn = parseRtsp(d.snapshot_camera_source_in);
  set('eviHostIn', pIn.host);
  set('eviPortIn', pIn.port);
  set('eviUserIn', pIn.user);
  set('eviPassIn', pIn.pass);
  set('eviPathIn', pIn.path);
  set('eviChannelIn', pIn.channel);
  set('eviSourceIn', pIn.full);
  
  const enabledIn = d.snapshot_enabled_in;
  const chkIn = document.getElementById('eviEnabledIn');
  if (chkIn) chkIn.checked = !!enabledIn;
  set('eviTriggerIn', d.snapshot_trigger_in || 'ambos');
  set('eviCountIn', d.snapshot_count_in || 1);

  // Popular OUT
  const pOut = parseRtsp(d.snapshot_camera_source_out);
  set('eviHostOut', pOut.host);
  set('eviPortOut', pOut.port);
  set('eviUserOut', pOut.user);
  set('eviPassOut', pOut.pass);
  set('eviPathOut', pOut.path);
  set('eviChannelOut', pOut.channel);
  set('eviSourceOut', pOut.full);
  
  const enabledOut = d.snapshot_enabled_out;
  const chkOut = document.getElementById('eviEnabledOut');
  if (chkOut) chkOut.checked = !!enabledOut;
  set('eviTriggerOut', d.snapshot_trigger_out || 'ambos');
  set('eviCountOut', d.snapshot_count_out || 1);

  // Recargar streams
  const feedIn = document.getElementById('eviLiveFeedIn');
  const feedOut = document.getElementById('eviLiveFeedOut');
  if (feedIn) feedIn.src = '/video_feed_evidence/in?t=' + Date.now();
  if (feedOut) feedOut.src = '/video_feed_evidence/out?t=' + Date.now();
}

async function saveEviTab() {
  // IN
  _cfgData.snapshot_camera_source_in = document.getElementById('eviSourceIn').value.trim();
  _cfgData.snapshot_enabled_in = document.getElementById('eviEnabledIn').checked;
  _cfgData.snapshot_trigger_in = document.getElementById('eviTriggerIn').value;
  _cfgData.snapshot_count_in = parseInt(document.getElementById('eviCountIn').value) || 1;

  // OUT
  _cfgData.snapshot_camera_source_out = document.getElementById('eviSourceOut').value.trim();
  _cfgData.snapshot_enabled_out = document.getElementById('eviEnabledOut').checked;
  _cfgData.snapshot_trigger_out = document.getElementById('eviTriggerOut').value;
  _cfgData.snapshot_count_out = parseInt(document.getElementById('eviCountOut').value) || 1;

  await saveConfigPartial();
}

async function renderDniForm() {
  const s = _cfgSubTabs.dni;
  document.getElementById('dniTitle').textContent = `Lector QR DNI - ${s === 'in' ? 'Ingreso (IN)' : 'Salida (OUT)'}`;
  document.getElementById('dniSource').value = s === 'in' ? (_cfgData.qr_camera_source_in || '') : (_cfgData.qr_camera_source_out || '');
  
  // Llenar select de COM
  const selectCom = document.getElementById('dniComPort');
  if (selectCom) {
    try {
      const ports = await api('GET', '/api/com-ports');
      let html = '<option value="">(Ninguno)</option>';
      if (ports && ports.length > 0) {
        ports.forEach(p => { html += `<option value="${p.port}">${p.port} - ${p.desc}</option>`; });
      } else {
        html = '<option value="">No se detectaron puertos COM</option>';
      }
      selectCom.innerHTML = html;
      selectCom.value = s === 'in' ? (_cfgData.qr_com_port_in || '') : (_cfgData.qr_com_port_out || '');
    } catch (e) {
      console.error(e);
      selectCom.innerHTML = '<option value="">Error cargando puertos</option>';
    }
  }

  const selectType = document.getElementById('dniSourceType');
  if (selectType) selectType.value = s === 'in' ? (_cfgData.qr_source_type_in || 'camera') : (_cfgData.qr_source_type_out || 'camera');

  // DNI Stream Sync
  const dniLive = document.getElementById('dniLiveFeed');
  if (dniLive) {
    dniLive.src = '/video_feed_qr/' + s + '?t=' + Date.now();
  }
}

async function testComPort() {
  const port = document.getElementById('dniComPort').value;
  const txt = document.getElementById('dniTestResults');
  if (!port) {
    if (txt) {
      const timeStr = new Date().toLocaleTimeString();
      txt.value = `[${timeStr}] ERROR: Selecciona un puerto COM primero\n` + txt.value;
    } else {
      alert("Selecciona un puerto COM primero");
    }
    return;
  }
  
  const timeStr = new Date().toLocaleTimeString();
  if (txt) {
    txt.value = `[${timeStr}] INFO: Probando lector COM en ${port}. Escucha activa por 3 segundos. Escanee un DNI/QR ahora...\n` + txt.value;
  } else {
    alert("El sistema escuchara el puerto " + port + " por 3 segundos. ¡Por favor escanea un QR ahora!");
  }

  try {
    const res = await api('POST', '/api/test-com-port', { port: port });
    const doneTime = new Date().toLocaleTimeString();
    if (res && res.ok) {
      if (txt) {
        txt.value = `[${doneTime}] EXITO: ${res.msg}\n` + txt.value;
      } else {
        alert("EXITO:\n" + res.msg);
      }
    } else {
      const errMsg = res?.msg || "Desconocido";
      if (txt) {
        txt.value = `[${doneTime}] ERROR: ${errMsg}\n` + txt.value;
      } else {
        alert("ERROR:\n" + errMsg);
      }
    }
  } catch (err) {
    const errorTime = new Date().toLocaleTimeString();
    if (txt) {
      txt.value = `[${errorTime}] ERROR DE RED al probar puerto ${port}\n` + txt.value;
    } else {
      alert("Error de red.");
    }
  }
}

async function testQrCamera() {
  const source = document.getElementById('dniSource').value.trim();
  const txt = document.getElementById('dniCameraTestResults') || document.getElementById('dniTestResults');
  if (!source) {
    if (txt) {
      const timeStr = new Date().toLocaleTimeString();
      txt.value = `[${timeStr}] ERROR: Configure una fuente de camara DNI primero\n` + txt.value;
    } else {
      alert("Configure una fuente de camara DNI primero");
    }
    return;
  }
  
  const timeStr = new Date().toLocaleTimeString();
  if (txt) {
    txt.value = `[${timeStr}] INFO: Probando camara QR. Escucha activa por 120 segundos. Mantenga el codigo DNI frente a la camara...\n` + txt.value;
  } else {
    alert("El sistema probara la camara QR por 120 segundos. Mantenga el codigo DNI frente a la camara.");
  }

  try {
    const res = await api('POST', '/api/test-qr-camera', { source: source });
    const doneTime = new Date().toLocaleTimeString();
    if (res && res.ok) {
      if (txt) {
        txt.value = `[${doneTime}] EXITO: ${res.msg}\n` + txt.value;
      } else {
        alert("EXITO:\n" + res.msg);
      }
    } else {
      const errMsg = res?.msg || "Desconocido";
      if (txt) {
        txt.value = `[${doneTime}] ERROR: ${errMsg}\n` + txt.value;
      } else {
        alert("ERROR:\n" + errMsg);
      }
    }
  } catch (err) {
    const errorTime = new Date().toLocaleTimeString();
    if (txt) {
      txt.value = `[${errorTime}] ERROR DE RED o timeout al probar camara QR\n` + txt.value;
    } else {
      alert("Error de red o timeout.");
    }
  }
}


async function saveDniTab() {
  const s = _cfgSubTabs.dni;
  const src = document.getElementById('dniSource').value.trim();
  const com = document.getElementById('dniComPort').value.trim();
  const type = document.getElementById('dniSourceType').value;
  
  if (s === 'in') {
    _cfgData.qr_camera_source_in = src;
    _cfgData.qr_com_port_in = com;
    _cfgData.qr_source_type_in = type;
  } else {
    _cfgData.qr_camera_source_out = src;
    _cfgData.qr_com_port_out = com;
    _cfgData.qr_source_type_out = type;
  }
  await saveConfigPartial();
}

function renderMotorForm() {
  const d = _cfgData;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  set('inputInferEvery',  d.inference_every_n);
  set('selectOcrDevice',  d.ocr_device);
  set('selectAuthMode',   d.auth_mode || 'ambos');
  set('inputMinOcrConf',  d.filter_min_ocr_conf ?? 0);
  set('inputMinDetConf',  d.filter_min_detector_conf ?? 0);
  set('inputDedupWindow', d.dedup_window_sec ?? 8);
  const lOcr = document.getElementById('lblMinOcrConf');
  const lDet = document.getElementById('lblMinDetConf');
  if (lOcr) lOcr.textContent = parseFloat(d.filter_min_ocr_conf ?? 0).toFixed(2);
  if (lDet) lDet.textContent = parseFloat(d.filter_min_detector_conf ?? 0).toFixed(2);

  // Auto register checkbox
  const chkAuto = document.getElementById('checkAutoRegister');
  if (chkAuto) chkAuto.checked = d.auto_register !== false;

  // Plate filter
  const pfEnabled = document.getElementById('plateFilterEnabled');
  if (pfEnabled) pfEnabled.checked = d.plate_filter_enabled !== false;
  const countries = d.plate_filter_countries || ["AR","BR","UY","PY","CL"];
  document.querySelectorAll('.countryChk').forEach(cb => {
    cb.checked = countries.includes(cb.value);
  });
}

function saveMotorTab() {
  _cfgData.inference_every_n = Math.max(1, Number(document.getElementById('inputInferEvery')?.value || 1));
  _cfgData.ocr_device = document.getElementById('selectOcrDevice')?.value || 'auto';
  _cfgData.auth_mode = document.getElementById('selectAuthMode')?.value || 'ambos';
  _cfgData.filter_min_ocr_conf = parseFloat(document.getElementById('inputMinOcrConf')?.value  || 0);
  _cfgData.filter_min_detector_conf = parseFloat(document.getElementById('inputMinDetConf')?.value  || 0);
  _cfgData.dedup_window_sec = Math.max(0, Number(document.getElementById('inputDedupWindow')?.value || 0));
  _cfgData.auto_register = !!document.getElementById('checkAutoRegister')?.checked;

  // Filtro de formato de patente
  _cfgData.plate_filter_enabled = !!document.getElementById('plateFilterEnabled')?.checked;
  const countries = [];
  document.querySelectorAll('.countryChk:checked').forEach(cb => countries.push(cb.value));
  _cfgData.plate_filter_countries = countries;

  saveConfigPartial();
}

async function saveConfigPartial() {
  try {
    _cfgData.persist = true;
    await api('POST', '/api/config', _cfgData);
    const msg = document.getElementById('runtimeMsg');
    if (msg) msg.textContent = 'Configuración guardada (' + new Date().toLocaleTimeString() + ')';
    alert('Guardado exitosamente');
  } catch(e) {
    alert('Error guardando: ' + e.message);
  }
}

function wireRendimientoButtons() {
  document.getElementById('btnSaveRuntime')?.addEventListener('click', saveMotorTab);
  document.getElementById('inputMinOcrConf')?.addEventListener('input', ev => {
    const lb = document.getElementById('lblMinOcrConf');
    if (lb) lb.textContent = parseFloat(ev.target.value).toFixed(2);
  });
  document.getElementById('inputMinDetConf')?.addEventListener('input', ev => {
    const lb = document.getElementById('lblMinDetConf');
    if (lb) lb.textContent = parseFloat(ev.target.value).toFixed(2);
  });
  bindFormLiveRtsp('alpr');
  bindFormLiveRtsp('eviIn');
  bindFormLiveRtsp('eviOut');
}


// ── Init ───────────────────────────────────────────────────────────────────
(function init() {
  // Theme initialization
  const savedTheme = localStorage.getItem('theme');
  const btn = document.getElementById('themeToggleBtn');
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    if (btn) btn.textContent = 'Tema: Claro';
  } else {
    if (btn) btn.textContent = 'Tema: Oscuro';
  }

  if (_token) {
    startApp();
  }
  // ROI + chart + camera + rendimiento wiring
  setupRoiDraw();
  wireRoiButtons();
  wireChartButtons();
  wireCameraButtons();
  wireRendimientoButtons();
  initHourlyChart();

  const inCam = document.getElementById('videoFeedIn');
  const outCam = document.getElementById('videoFeedOut');
  
  [inCam, outCam].forEach((img, idx) => {
    const sentido = idx === 0 ? 'In' : 'Out';
    const loader = document.getElementById('loader' + sentido);
    if (img) {
      img.addEventListener('loadstart', () => {
        if (loader) loader.classList.remove('hidden');
      });
      img.addEventListener('error', () => {
        if (loader) loader.classList.add('hidden');
        const badge = document.getElementById('streamStatusBadge');
        if (badge) {
          badge.className = 'badge badge-red';
          badge.textContent = 'REINTENTANDO';
        }
        setTimeout(() => refreshVideoFeed(true), 1200);
      });
      img.addEventListener('load', () => {
        if (loader) loader.classList.add('hidden');
        const badge = document.getElementById('streamStatusBadge');
        if (badge) {
          badge.className = 'badge badge-green';
          badge.textContent = 'EN VIVO';
        }
      });
    }
  });

  document.addEventListener('visibilitychange', () => {
    setStreamsEnabled(!document.hidden && _currentPage === 'dashboard');
  });

  // Tecla Escape / Flechas de Navegacion
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
      const modal = document.getElementById('_thumbModal');
      if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        _currentModalIdx = -1;
      }
    } else if (e.key === 'ArrowLeft') {
      const modal = document.getElementById('_thumbModal');
      if (modal && modal.style.display === 'flex') {
        navigateModal(-1);
      }
    } else if (e.key === 'ArrowRight') {
      const modal = document.getElementById('_thumbModal');
      if (modal && modal.style.display === 'flex') {
        navigateModal(1);
      }
    }
  });

  // ── QR Floating Widget: Drag Support ──
  const qrHeader = document.getElementById('qrFloatHeader');
  const qrWidget = document.getElementById('qrFloatingWidget');
  if (qrHeader && qrWidget) {
    let dragging = false, dx = 0, dy = 0;
    qrHeader.addEventListener('mousedown', e => {
      dragging = true;
      const rect = qrWidget.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      qrWidget.style.left = (e.clientX - dx) + 'px';
      qrWidget.style.top = (e.clientY - dy) + 'px';
      qrWidget.style.right = 'auto';
      qrWidget.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }
})();

// ── QR Widget Toggle ──
function toggleQrWidget(forceState) {
  const w = document.getElementById('qrFloatingWidget');
  if (!w) return;
  const show = forceState !== undefined ? forceState : w.classList.contains('hidden');
  w.classList.toggle('hidden', !show);
}

// ── ROI Sentido Switching ──
function switchRoiSentido(sentido) {
  _roiSentido = sentido;
  const img = document.getElementById('roiImage');
  if (img) img.src = '/video_feed/' + sentido + '?t=' + Date.now();

  const btnIn = document.getElementById('roiBtnIn');
  const btnOut = document.getElementById('roiBtnOut');
  const label = document.getElementById('roiSentidoLabel');
  const hidden = document.getElementById('roiSentido');

  if (btnIn) { btnIn.className = sentido === 'in' ? 'btn btn-primary btn-small' : 'btn btn-ghost btn-small'; }
  if (btnOut) { btnOut.className = sentido === 'out' ? 'btn btn-primary btn-small' : 'btn btn-ghost btn-small'; }
  if (label) label.textContent = 'Editando ROI de: ' + (sentido === 'in' ? 'INGRESO' : 'SALIDA');
  if (hidden) hidden.value = sentido;

  // Load ROI for this sentido
  loadRoi();
}

// ── Global Helper Functions (Modo Claro, Toast Alerts, Exportación) ─────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = isLight ? 'Tema: Claro' : 'Tema: Oscuro';
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  
  let badgeText = 'INFO';
  let title = 'Notificación';
  let color = 'var(--accent)';

  if (msg.type === 'PLATE_READ') {
    badgeText = 'OCR';
    title = 'Patente Detectada';
    color = 'var(--accent)';
    toast.innerHTML = `
      <div style="display: flex; gap: 12px; align-items: center;">
        <span style="font-size: 0.75rem; font-weight: 800; background: rgba(0, 168, 204, 0.15); color: ${color}; padding: 3px 6px; border-radius: 4px; border: 1px solid ${color};">OCR</span>
        <div>
          <div style="font-weight: 700; color: ${color};">${title}</div>
          <div style="font-size: 1.15rem; font-family: monospace; font-weight: 700; margin: 2px 0;">${msg.data.patente}</div>
          <div style="font-size: 0.8rem; color: var(--text-sub);">Sentido: ${msg.sentido === 'in' ? 'INGRESO' : 'SALIDA'}</div>
        </div>
      </div>
    `;
  } else if (msg.type === 'DNI_READ') {
    badgeText = 'DNI';
    title = 'DNI Escaneado';
    color = 'var(--yellow)';
    toast.innerHTML = `
      <div style="display: flex; gap: 12px; align-items: center;">
        <span style="font-size: 0.75rem; font-weight: 800; background: rgba(245, 158, 11, 0.15); color: ${color}; padding: 3px 6px; border-radius: 4px; border: 1px solid ${color};">DNI</span>
        <div>
          <div style="font-weight: 700; color: ${color};">${title}</div>
          <div style="font-size: 1.05rem; font-weight: 700; margin: 2px 0;">${msg.data.nombre || ''} ${msg.data.apellido || ''}</div>
          <div style="font-size: 0.85rem; font-family: monospace; color: var(--text-sub);">DNI: ${msg.data.dni}</div>
        </div>
      </div>
    `;
  } else if (msg.type === 'ACCESS_RESULT') {
    const res = msg.data?.resultado || msg.resultado || '';
    const isOk = res === 'autorizado' || res === 'manual';
    const isClose = res === 'manual_close' || res === 'sensor_close' || res === 'timeout_close';
    
    let badgeText, title, color, bg, subtext;
    if (isOk) {
      badgeText = 'OK';
      title = 'Acceso Autorizado';
      color = 'var(--green)';
      bg = 'rgba(16, 185, 129, 0.15)';
      subtext = msg.data?.motivo || msg.motivo || 'Verificación aprobada';
    } else if (isClose) {
      badgeText = 'CIERRE';
      title = res === 'manual_close' ? 'Cierre Manual' : (res === 'timeout_close' ? 'Cierre Automático' : 'Cierre por Sensor');
      color = 'var(--text-sub)';
      bg = 'rgba(255, 255, 255, 0.08)';
      subtext = msg.data?.motivo || msg.motivo || 'Cerrando barrera';
    } else {
      badgeText = 'DENEGADO';
      title = 'Acceso Denegado';
      color = 'var(--red)';
      bg = 'rgba(239, 68, 68, 0.15)';
      subtext = msg.data?.motivo || msg.motivo || 'Verificación fallida';
    }
    toast.innerHTML = `
      <div style="display: flex; gap: 12px; align-items: center;">
        <span style="font-size: 0.75rem; font-weight: 800; background: ${bg}; color: ${color}; padding: 3px 6px; border-radius: 4px; border: 1px solid ${color};">${badgeText}</span>
        <div>
          <div style="font-weight: 700; color: ${color};">${title}</div>
          <div style="font-size: 1.05rem; font-family: monospace; font-weight: 700; margin: 2px 0;">${msg.data?.patente || msg.patente || 'SIN PLACA'}</div>
          <div style="font-size: 0.8rem; color: var(--text-sub);">${subtext}</div>
        </div>
      </div>
    `;
  } else {
    const txt = typeof msg === 'string' ? msg : JSON.stringify(msg);
    toast.innerHTML = `
      <div style="display: flex; gap: 12px; align-items: center;">
        <span style="font-size: 0.75rem; font-weight: 800; background: rgba(255, 255, 255, 0.1); color: var(--text); padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border);">INFO</span>
        <div style="font-size: 0.9rem;">${txt}</div>
      </div>
    `;
  }

  container.appendChild(toast);
  
  // Animate slide-in
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 4000);
}

async function exportHistorialCsv() {
  const params = new URLSearchParams();
  const patente   = document.getElementById('filtHistPatente')?.value.trim();
  const resultado = document.getElementById('filtHistResultado')?.value;
  const desde     = document.getElementById('filtHistDesde')?.value;
  const hasta     = document.getElementById('filtHistHasta')?.value;

  if (patente)   params.set('patente', patente);
  if (resultado) params.set('resultado', resultado);
  if (desde)     params.set('desde', desde + 'T00:00:00');
  if (hasta)     params.set('hasta', hasta + 'T23:59:59');

  try {
    const res = await fetch(`/api/accesos/export/csv?${params}`, {
      headers: { 'Authorization': 'Bearer ' + _token },
    });
    if (!res.ok) { alert('Error al exportar el historial'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `historial_accesos_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert(err.message); }
}


// ── Purga y Almacenamiento ──────────────────────────────────────────────────
async function loadEvidenceConfig() {
  try {
    const data = await api('GET', '/api/config/evidence');
    if (data && data.evidence_retention_days !== undefined) {
      const input = document.getElementById('inputEvidenceDays');
      if (input) input.value = data.evidence_retention_days;
    }
  } catch (err) {
    console.error("Error al cargar la configuración de almacenamiento:", err);
  }
}

async function saveEvidenceConfig() {
  const daysEl = document.getElementById('inputEvidenceDays');
  const msgEl = document.getElementById('evidenceMsg');
  if (!daysEl) return;
  const daysVal = parseInt(daysEl.value);
  if (isNaN(daysVal) || daysVal < 1) {
    alert("Por favor, ingrese un número de días válido (mayor o igual a 1).");
    return;
  }
  try {
    const res = await api('POST', '/api/config/evidence', { evidence_retention_days: daysVal });
    if (res && res.ok) {
      if (msgEl) {
        msgEl.textContent = 'Configuración guardada exitosamente (' + new Date().toLocaleTimeString() + ')';
        msgEl.style.color = 'var(--green)';
      }
      alert('Configuración de retención automática guardada correctamente.');
    } else {
      alert('Error al guardar: ' + (res?.detail || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al conectar con el servidor: ' + err.message);
  }
}

async function executeManualPurge() {
  const desde = document.getElementById('inputPurgeDesde').value;
  const hasta = document.getElementById('inputPurgeHasta').value;
  if (!desde || !hasta) {
    alert("Por favor, seleccione ambas fechas (Fecha Inicio y Fecha Fin).");
    return;
  }
  
  const fromDate = new Date(desde);
  const toDate = new Date(hasta);
  if (fromDate > toDate) {
    alert("La Fecha de Inicio no puede ser posterior a la Fecha de Fin.");
    return;
  }

  const confirmMsg = `¡ATENCIÓN!\n\n¿Está seguro de que desea realizar la purga manual de fotos de evidencia?\n\n` +
                     `Rango seleccionado: ${desde} hasta ${hasta}\n\n` +
                     `Esta acción eliminará de forma física e irreversible todos los archivos de fotos comprendidos en este rango.\n\n` +
                     `Escriba "ELIMINAR" para confirmar la operación:`;
                     
  const confirmation = prompt(confirmMsg);
  if (confirmation !== "ELIMINAR") {
    alert("Operación cancelada. No se realizó ninguna eliminación.");
    return;
  }

  try {
    const btn = document.querySelector('button[onclick="executeManualPurge()"]');
    let oldText = "";
    if (btn) {
      oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Purgando archivos...";
    }

    const res = await api('POST', '/api/evidencia/purge-manual', { desde: desde, hasta: hasta });
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }

    if (res && res.success) {
      const carpetas = res.carpetas_eliminadas;
      const archivos = res.archivos_eliminados;
      
      showToast(`Purga manual exitosa: Se eliminaron ${carpetas} carpetas y un total de ${archivos} archivos de fotos del servidor.`);
      alert(`Purga completada con éxito.\n\nCarpetas eliminadas: ${carpetas}\nTotal archivos de fotos borrados: ${archivos}`);
      
      document.getElementById('inputPurgeDesde').value = '';
      document.getElementById('inputPurgeHasta').value = '';
    } else {
      showToast('Error al ejecutar la purga manual.');
      alert('Error al ejecutar la purga: ' + (res?.detail || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al realizar la purga manual: ' + err.message);
  }
}

// ── Pre-Autorizaciones (Propietarios) ──────────────────────────────────────
async function loadPreAutorizaciones() {
  const tbody = document.getElementById('bodyPreAutorizaciones');
  if (!tbody) return;
  try {
    const data = await api('GET', '/api/propietario/autorizaciones');
    if (!data) return;
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No hay pre-autorizaciones activas</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(pa => {
      const nombreCompleto = escHtml(`${pa.nombre || ''} ${pa.apellido || ''}`).trim() || '—';
      const desde = formatFecha(pa.fecha_desde);
      const hasta = formatFecha(pa.fecha_hasta);
      return `
        <tr>
          <td>${nombreCompleto}</td>
          <td><span class="mono">${escHtml(pa.patente || '—')}</span></td>
          <td><span class="mono">${escHtml(pa.dni || '—')}</span></td>
          <td>${desde} hasta ${hasta}</td>
          <td>
            <button class="btn btn-danger btn-small" onclick="cancelPreAutorizacion(${pa.id})">Cancelar</button>
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="loading" style="color:var(--red);">Error al cargar pre-autorizaciones: ${escHtml(err.message)}</td></tr>`;
  }
}

async function savePreAutorizacion(event) {
  event.preventDefault();
  const patente = document.getElementById('paPatente').value.trim().toUpperCase();
  const dni = document.getElementById('paDni').value.trim();
  const nombre = document.getElementById('paNombre').value.trim();
  const apellido = document.getElementById('paApellido').value.trim();
  let desdeVal = document.getElementById('paDesde').value;
  let hastaVal = document.getElementById('paHasta').value;

  if (!patente && !dni) {
    alert('Debe ingresar al menos una Patente o un DNI para autorizar.');
    return;
  }
  if (!desdeVal || !hastaVal) {
    alert('Debe ingresar las fechas de vigencia.');
    return;
  }

  // Format ranges to cover the whole day
  const desde = desdeVal + " 00:00";
  const hasta = hastaVal + " 23:59";

  const body = {
    patente: patente || null,
    dni: dni || null,
    nombre: nombre || null,
    apellido: apellido || null,
    fecha_desde: desde,
    fecha_hasta: hasta
  };

  try {
    const res = await api('POST', '/api/propietario/autorizaciones', body);
    if (res) {
      alert('Visita pre-autorizada con éxito.');
      document.getElementById('formPreAutorizacion').reset();
      loadPreAutorizaciones();
    }
  } catch (err) {
    alert('Error al crear pre-autorización: ' + err.message);
  }
}

async function cancelPreAutorizacion(id) {
  if (!confirm('¿Está seguro de que desea cancelar esta pre-autorización?')) return;
  try {
    await api('DELETE', `/api/propietario/autorizaciones/${id}`);
    loadPreAutorizaciones();
  } catch (err) {
    alert('Error al cancelar: ' + err.message);
  }
}

async function loadHistorialLote() {
  const tbody = document.getElementById('bodyHistorialLote');
  if (!tbody) return;
  try {
    const data = await api('GET', '/api/propietario/historial?limit=50');
    if (!data || !data.items) return;
    if (!data.items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">Sin accesos registrados para este lote</td></tr>';
      return;
    }
    tbody.innerHTML = data.items.map(a => {
      const badgeCls = (a.resultado === 'autorizado' || a.resultado === 'manual') ? 'badge-green' : 'badge-red';
      const fecha = a.fecha ? formatFecha(a.fecha) : '';
      const sentidoHtml = a.sentido === 'in' ? '<span style="color:#10b981;font-weight:600;">Ingreso</span>'
                        : a.sentido === 'out' ? '<span style="color:#3b82f6;font-weight:600;">Salida</span>'
                        : `<span class="muted">${a.sentido || '—'}</span>`;
      
      const fotoHtml = a.foto_evidencia 
        ? `<button class="btn btn-ghost btn-small" onclick="openEvidencePreview('${escHtml(a.foto_evidencia)}', '${escHtml(a.patente || 'SIN PLACA')}', '${fecha}')">Ver Foto</button>`
        : '<span class="muted">—</span>';

      return `<tr>
        <td style="white-space:nowrap">${fecha}</td>
        <td>${sentidoHtml}</td>
        <td><span class="mono">${escHtml(a.patente || '—')}</span></td>
        <td><span class="mono">${escHtml(a.dni || '—')}</span></td>
        <td>—</td>
        <td><span class="badge ${badgeCls}">${resultadoLabel(a.resultado)}</span></td>
        <td>${fotoHtml}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="loading" style="color:var(--red);">Error al cargar historial: ${escHtml(err.message)}</td></tr>`;
  }
}

function openEvidencePreview(path, label, date) {
  let modal = document.getElementById('_evidencePreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_evidencePreviewModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
    modal.innerHTML = `
      <div id="_evidenceCard" style="max-width:90vw;max-height:85vh;background:#13161f;border:1px solid #2d3250;border-radius:12px;padding:16px;box-shadow:0 0 60px #000;position:relative;" onclick="event.stopPropagation()">
        <h3 id="_evidenceTitle" style="color:#fff;margin-bottom:8px;font-size:1.1rem;font-weight:700;"></h3>
        <img id="_evidenceImg" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;display:block;" onerror="this.src='/static/no-signal.svg';" />
        <div id="_evidenceDate" style="color:#c4d4e7;font-size:.85rem;margin-top:10px;text-align:right;"></div>
      </div>
    `;
    modal.addEventListener('click', () => { modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  document.getElementById('_evidenceTitle').textContent = 'Evidencia: ' + label;
  document.getElementById('_evidenceImg').src = path;
  document.getElementById('_evidenceDate').textContent = date;
  modal.style.display = 'flex';
}


// ── Gestión de Operadores y Propietarios ───────────────────────────────────
let _operadoresList = [];

async function loadOperadores() {
  const tbody = document.getElementById('tblOperadoresBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Cargando operadores...</td></tr>';
  
  try {
    // 1. Cargar operadores
    const ops = await api('GET', '/api/auth/operadores');
    _operadoresList = ops || [];
    
    // 2. Cargar configuraciones globales para los toggles de privilegios
    const cfg = await api('GET', '/api/config');
    if (cfg) {
      const chkVigilador = document.getElementById('checkVigiladorManual');
      const chkPropietario = document.getElementById('checkPropietarioAuth');
      const chkAutoIn = document.getElementById('checkAutoOpenIn');
      const chkAutoOut = document.getElementById('checkAutoOpenOut');
      
      if (chkVigilador) chkVigilador.checked = !!cfg.vigilador_manual_trigger;
      if (chkPropietario) chkPropietario.checked = !!cfg.propietario_auth_visits;
      if (chkAutoIn) chkAutoIn.checked = !!cfg.barrier_auto_open_in;
      if (chkAutoOut) chkAutoOut.checked = !!cfg.barrier_auto_open_out;
    }
    
    // 3. Renderizar la tabla de operadores
    if (_operadoresList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted text-center" style="padding:16px">No hay cuentas registradas.</td></tr>';
      return;
    }
    
    tbody.innerHTML = _operadoresList.map(o => {
      const activeText = o.activo ? 'Activa' : 'Inactiva';
      const activeClass = o.activo ? 'badge-green' : 'badge-gray';
      const toggleText = o.activo ? 'Desactivar' : 'Activar';
      const roleText = o.rol.toUpperCase();
      
      return `<tr>
        <td><span style="font-weight:bold; color:var(--accent);">${escHtml(o.username)}</span></td>
        <td><span class="mono">${escHtml(roleText)}</span></td>
        <td><span>${escHtml(o.lote || '—')}</span></td>
        <td><span class="badge ${activeClass}">${activeText}</span></td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-ghost btn-small" onclick='editOperador(${JSON.stringify(o)})' style="margin-right:4px;">Editar</button>
          <button class="btn btn-ghost btn-small" onclick="toggleOperadorStatus(${o.id}, ${o.activo})">${toggleText}</button>
        </td>
      </tr>`;
    }).join('');
    
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="muted text-center" style="color:var(--red); padding:16px">Error al cargar: ${escHtml(err.message)}</td></tr>`;
  }
}

function onOpRolChange() {
  const rolSel = document.getElementById('opRol');
  const loteInput = document.getElementById('opLote');
  if (!rolSel || !loteInput) return;
  
  if (rolSel.value === 'propietario') {
    loteInput.disabled = false;
    loteInput.placeholder = 'Lote 123';
  } else {
    loteInput.value = '';
    loteInput.disabled = true;
    loteInput.placeholder = 'No aplica';
  }
}

async function saveGlobalPermissions() {
  const chkVigilador = document.getElementById('checkVigiladorManual');
  const chkPropietario = document.getElementById('checkPropietarioAuth');
  const chkAutoIn = document.getElementById('checkAutoOpenIn');
  const chkAutoOut = document.getElementById('checkAutoOpenOut');
  const msgEl = document.getElementById('permsGlobalMsg');
  
  const payload = {
    vigilador_manual_trigger: chkVigilador ? !!chkVigilador.checked : true,
    propietario_auth_visits: chkPropietario ? !!chkPropietario.checked : true,
    barrier_auto_open_in: chkAutoIn ? !!chkAutoIn.checked : true,
    barrier_auto_open_out: chkAutoOut ? !!chkAutoOut.checked : true
  };
  
  try {
    const res = await api('POST', '/api/config', payload);
    if (res) {
      if (msgEl) {
        msgEl.textContent = 'Privilegios actualizados y persistidos en config.yaml (' + new Date().toLocaleTimeString() + ')';
        msgEl.style.color = 'var(--green)';
      }
      alert('Configuración de privilegios guardada correctamente.');
    }
  } catch (err) {
    alert('Error al guardar privilegios globales: ' + err.message);
  }
}

function editOperador(op) {
  const formTitle = document.getElementById('formOperadorTitle');
  const opIdInput = document.getElementById('opId');
  const usernameInput = document.getElementById('opUsername');
  const passwordInput = document.getElementById('opPassword');
  const lblPassword = document.getElementById('lblOpPassword');
  const rolSel = document.getElementById('opRol');
  const loteInput = document.getElementById('opLote');
  const activeChk = document.getElementById('opActivo');
  
  if (formTitle) formTitle.textContent = 'Editar Usuario';
  if (opIdInput) opIdInput.value = op.id;
  if (usernameInput) usernameInput.value = op.username;
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.placeholder = 'Dejar vacío para no cambiar';
  }
  if (lblPassword) lblPassword.textContent = 'Nueva Contraseña';
  if (rolSel) rolSel.value = op.rol;
  if (loteInput) {
    loteInput.value = op.lote || '';
    loteInput.disabled = (op.rol !== 'propietario');
    loteInput.placeholder = (op.rol === 'propietario') ? 'Lote 123' : 'No aplica';
  }
  if (activeChk) activeChk.checked = !!op.activo;
  
  const msgEl = document.getElementById('opFormMsg');
  if (msgEl) msgEl.textContent = '-';
}

function cancelOpEdit() {
  const formTitle = document.getElementById('formOperadorTitle');
  const opIdInput = document.getElementById('opId');
  const usernameInput = document.getElementById('opUsername');
  const passwordInput = document.getElementById('opPassword');
  const lblPassword = document.getElementById('lblOpPassword');
  const rolSel = document.getElementById('opRol');
  const loteInput = document.getElementById('opLote');
  const activeChk = document.getElementById('opActivo');
  
  if (formTitle) formTitle.textContent = 'Registrar Nuevo Usuario';
  if (opIdInput) opIdInput.value = '';
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.placeholder = '••••••••';
  }
  if (lblPassword) lblPassword.textContent = 'Contraseña *';
  if (rolSel) rolSel.value = 'viewer';
  if (loteInput) {
    loteInput.value = '';
    loteInput.disabled = true;
    loteInput.placeholder = 'No aplica';
  }
  if (activeChk) activeChk.checked = true;
  
  const msgEl = document.getElementById('opFormMsg');
  if (msgEl) msgEl.textContent = '-';
}

async function saveOperador() {
  const opIdInput = document.getElementById('opId');
  const usernameInput = document.getElementById('opUsername');
  const passwordInput = document.getElementById('opPassword');
  const rolSel = document.getElementById('opRol');
  const loteInput = document.getElementById('opLote');
  const activeChk = document.getElementById('opActivo');
  const msgEl = document.getElementById('opFormMsg');
  
  if (!usernameInput || !rolSel || !loteInput) return;
  
  const oid = opIdInput ? opIdInput.value : '';
  const username = usernameInput.value.trim();
  const password = passwordInput ? passwordInput.value : '';
  const rol = rolSel.value;
  const lote = loteInput.value.trim() || null;
  const activo = activeChk ? !!activeChk.checked : true;
  
  if (!username) {
    alert('Por favor, especifique el nombre de usuario.');
    return;
  }
  
  if (!oid && !password) {
    alert('Por favor, especifique la contraseña para el nuevo usuario.');
    return;
  }
  
  if (rol === 'propietario' && !lote) {
    alert('El rol Propietario requiere especificar un Lote.');
    return;
  }
  
  try {
    let res;
    if (oid) {
      // Modificar
      const payload = { username, rol, lote, activo };
      if (password) payload.password = password;
      res = await api('PUT', `/api/auth/operadores/${oid}`, payload);
      alert('Usuario modificado correctamente.');
    } else {
      // Crear
      const payload = { username, password, rol, lote };
      res = await api('POST', '/api/auth/operadores', payload);
      alert('Nuevo usuario registrado correctamente.');
    }
    
    if (res) {
      cancelOpEdit();
      loadOperadores();
    }
  } catch (err) {
    alert('Error al guardar usuario: ' + err.message);
  }
}

async function toggleOperadorStatus(oid, currentStatus) {
  try {
    const res = await api('PUT', `/api/auth/operadores/${oid}`, { activo: !currentStatus });
    if (res) {
      alert(`Usuario ${!currentStatus ? 'activado' : 'desactivado'} correctamente.`);
      loadOperadores();
    }
  } catch (err) {
    alert('Error al cambiar estado del usuario: ' + err.message);
  }
}

