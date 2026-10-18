/* Monitor Financiero — frontend (HTML + JS puro). Toda la contabilidad la hace el backend; aquí solo se muestra y se captura. */
'use strict';

const APP_VERSION = '1.2.0';       // versión del frontend; súbela cada vez que publiques cambios en frontend/
const NOMBRE_APP = 'Monitor Financiero';

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } }
};
// Privacidad: con los montos ocultos se muestran •••• en lugar de cantidades (preferencia guardada por dispositivo).
let oculto = LS.get('apartados.oculto') === '1';
const MASK = '••••';
const FMT = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fmt = c => oculto ? MASK : FMT.format((c || 0) / 100);
const fmtS = c => oculto ? MASK : (c > 0 ? '+' : '') + FMT.format((c || 0) / 100);          // con signo
const cStr = c => { const s = c < 0 ? '-' : ''; c = Math.abs(c); return s + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2); };
const parseMontoLocal = v => {                                     // solo para sumas en vivo; el servidor valida de verdad
  const m = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(v).replace(/[\s,$]/g, ''));
  if (!m) return null;
  const c = parseInt(m[2], 10) * 100 + (m[3] ? parseInt((m[3] + '0').slice(0, 2), 10) : 0);
  return m[1] ? -c : c;
};
const fmtFecha = f => { if (!f) return ''; const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtCorta = f => { const [, m, d] = f.split('-'); return `${+d} ${MESES[+m - 1]}`; };
const PALETA = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4b5563'];

let CFG = { url: LS.get('apartados.url') || '', token: LS.get('apartados.token') || '' };
let S = null;                                   // último estado del servidor
let vista = 'resumen';
const F = { cuenta: '', ap: '', tipo: '', desde: '', hasta: '' };      // filtros de movimientos
let rango = '3M', modoGrafica = 'ap', filtroGraf = 'todo', verArchivados = false, grafica = null, conc = null, ultimaCuentaConc = '';

const botonEnvio = e => e.submitter || e.target.querySelector('button[type=submit], button.primario');

// ---------- API ----------
async function api(accion, datos = {}, cfg = CFG) {
  let r;
  try {
    r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, accion, datos }) });
  } catch { throw new Error('No hay conexión con el servidor. Revisa tu internet o la URL.'); }
  let j;
  try { j = await r.json(); } catch { throw new Error('Respuesta inválida del servidor (¿es correcta la URL de la Web App?).'); }
  if (!j.ok) { const e = new Error(j.error || 'Error desconocido'); e.codigo = j.codigo; throw e; }
  return j.datos;
}
async function mutar(accion, datos, msg = 'Guardado') {
  S = await api(accion, datos);
  renderTodo();
  toast(msg);
  return S;
}

// ---------- Interfaz base ----------
let tToast;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(tToast); tToast = setTimeout(() => { t.hidden = true; }, 2800);
}
function aviso(msg, tipo = '') { const a = $('#aviso'); a.hidden = !msg; a.className = 'aviso ' + tipo; a.textContent = msg || ''; }

function modal({ titulo, html, ok = 'Guardar', onSubmit, onOpen }) {
  const dlg = $('#modal'), f = $('#modal-form');
  f.innerHTML = `<h2>${esc(titulo)}</h2>${html}<p class="err" id="m-err" role="alert"></p>
    <div class="botones"><button type="button" class="sec" data-x>Cancelar</button>${ok ? `<button type="submit" class="primario">${esc(ok)}</button>` : ''}</div>`;
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector('.primario'); if (b) b.disabled = true;
    $('#m-err').textContent = '';
    try { await onSubmit(new FormData(f)); dlg.close(); }
    catch (er) { $('#m-err').textContent = er.message; }
    finally { if (b) b.disabled = false; }
  };
  f.querySelector('[data-x]').onclick = () => dlg.close();
  dlg.showModal();
  onOpen?.(f);
}

function irA(v) {
  vista = v;
  $$('.vista').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  $$('#nav button').forEach(b => b.classList.toggle('activa', b.dataset.vista === v));
  if (v === 'resumen') dibujarGrafica();
  window.scrollTo(0, 0);
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) irA(b.dataset.vista); });
$('#btn-refrescar').addEventListener('click', () => cargar(true));

function pintarOjo() {
  const b = $('#btn-ojo');
  b.textContent = oculto ? '🙈' : '👁';
  b.title = oculto ? 'Mostrar montos' : 'Ocultar montos';
  b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(oculto));
}
$('#btn-ojo').addEventListener('click', () => {
  oculto = !oculto; LS.set('apartados.oculto', oculto ? '1' : '0'); pintarOjo();
  if (S) renderTodo();
  toast(oculto ? 'Montos ocultos' : 'Montos visibles');
});
pintarOjo();

// ---------- Datos derivados ----------
const apById = id => S.apartados.find(a => a.id === id);
const nomAp = id => (apById(id) || {}).nombre || '';
const cuentaById = id => (S.cuentas || []).find(c => c.id === id);
const etqCuenta = c => c ? `${c.banco} · ${c.nombre}` : 'Sin cuenta';
const cuentaDeAp = a => cuentaById(a && a.cuenta_id);
const colorDe = a => a.color || PALETA[Math.max(S.apartados.indexOf(a), 0) % PALETA.length];
const apsVisibles = () => S.apartados.filter(a => a.estado === 'activo' && (cuentaById(a.cuenta_id) || {}).estado === 'activo');
const cuentasActivas = () => (S.cuentas || []).filter(c => c.estado === 'activo');
const hayISR = () => parseFloat(S.config.isr_pct) > 0 || (S.cuentas || []).some(c => c.isr_pct !== '' && parseFloat(c.isr_pct) > 0);
const sumar = aps => aps.reduce((t, a) => { for (const k of ['saldo', 'capital', 'intereses', 'pendiente', 'hoy', 'mes', 'bruto', 'neto']) t[k] += a[k] || 0; return t; },
  { saldo: 0, capital: 0, intereses: 0, pendiente: 0, hoy: 0, mes: 0, bruto: 0, neto: 0 });
/** Tasa vigente hoy de un apartado: la propia si tiene, si no la general. null si no hay ninguna. */
function tasaVigente(a) {
  const ult = l => l.filter(t => t.fecha_inicio <= S.hoy).sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio)).pop();
  const propia = ult(S.tasas.filter(t => t.apartado_id === a.id));
  if (propia) return { pct: propia.tasa_pct, propia: true };
  const gen = ult(S.tasas.filter(t => !t.apartado_id));
  return gen ? { pct: gen.tasa_pct, propia: false } : null;
}
/** Banco ▸ cuenta ▸ apartados activos (solo cuentas activas). */
function gruposPorBanco() {
  const bancos = new Map();
  cuentasActivas().forEach(c => {
    if (!bancos.has(c.banco)) bancos.set(c.banco, []);
    bancos.get(c.banco).push({ cuenta: c, aps: S.apartados.filter(a => a.cuenta_id === c.id && a.estado === 'activo') });
  });
  return [...bancos].map(([banco, cuentas]) => ({ banco, cuentas }));
}
const textoCap = c => c.capitalizacion ? (c.capitalizacion === 'mensual' ? 'Mensual' : 'Diaria') : `${S.config.capitalizacion === 'mensual' ? 'Mensual' : 'Diaria'} (global)`;
const textoISR = c => c.isr_pct !== '' ? `ISR ${c.isr_pct}%` : (parseFloat(S.config.isr_pct) > 0 ? `ISR ${S.config.isr_pct}% (global)` : '');

// ---------- Resumen ----------
function tarjetaAp(a, T) {
  const t = tasaVigente(a);
  return `<article class="card ap" style="--c:${colorDe(a)}" data-acc="ver-movs" data-id="${a.id}" tabindex="0" role="button" aria-label="Ver movimientos de ${esc(a.nombre)}">
    <div class="fila entre"><span class="nom">${esc(a.icono)} ${esc(a.nombre)}</span><span class="chip">${t ? esc(t.pct) + '%' + (t.propia ? '' : ' general') : 'sin tasa'}</span></div>
    <div class="sal num">${fmt(a.saldo)}</div>
    <div class="barra"><i style="width:${T.saldo ? Math.min(100, a.saldo * 100 / T.saldo) : 0}%"></i></div>
    <div class="det num"><span>Capital ${fmt(a.capital)}</span><span>Intereses ${fmt(a.intereses)}</span></div>
    <div class="det num"><span>Hoy ${fmt(a.hoy)}</span><span>Mes ${fmt(a.mes)}</span><span>Acum. ${fmt(a.bruto)}${hayISR() ? ` (neto ${fmt(a.neto)})` : ''}</span></div>
  </article>`;
}
function opcionesFiltroGraf() {
  const cu = (S.cuentas || []).filter(c => c.estado !== 'eliminado');
  const bancos = [...new Set(cu.map(c => c.banco))];
  const aps = S.apartados.filter(a => a.estado !== 'eliminado');
  const o = (v, t) => `<option value="${esc(v)}" ${filtroGraf === v ? 'selected' : ''}>${esc(t)}</option>`;
  return o('todo', 'Todo (todas las cuentas)') +
    (bancos.length > 1 ? `<optgroup label="Banco">${bancos.map(b => o('b:' + b, b)).join('')}</optgroup>` : '') +
    (cu.length > 1 ? `<optgroup label="Cuenta">${cu.map(c => o('c:' + c.id, etqCuenta(c))).join('')}</optgroup>` : '') +
    `<optgroup label="Apartado">${aps.map(a => o('a:' + a.id, a.nombre + ' · ' + (cuentaDeAp(a) || {}).banco)).join('')}</optgroup>`;
}
function idsFiltroGraf() {
  const todos = S.apartados.map(a => a.id);
  const [k, v] = [filtroGraf.slice(0, 1), filtroGraf.slice(2)];
  let ids = todos;
  if (k === 'b') ids = S.apartados.filter(a => (cuentaDeAp(a) || {}).banco === v).map(a => a.id);
  else if (k === 'c') ids = S.apartados.filter(a => a.cuenta_id === v).map(a => a.id);
  else if (k === 'a') ids = [v];
  return ids.length ? ids : todos;
}
function renderResumen() {
  const T = S.total, grupos = gruposPorBanco();
  const pendiente = T.pendiente > 0;
  $('#v-resumen').innerHTML = `
    <div class="card hero">
      <div class="fila entre"><span class="etq">Saldo total (todas las cuentas y bancos)</span>
        <span class="insignia ${S.integridad.ok ? '' : 'mal'}">${S.integridad.ok ? '✓ Cuadra' : '⚠ No cuadra'}</span></div>
      <div class="grande num">${fmt(T.saldo)}</div>
      <p class="sub">Capital aportado <b class="num">${fmt(T.capital)}</b> · Intereses ganados <b class="num">${fmt(T.intereses)}</b>
        ${pendiente ? `· Devengado por pagar <b class="num">${fmt(T.pendiente)}</b>` : ''}</p>
      <div class="kpis">
        <div class="kpi"><small>Interés hoy</small><b class="num">${fmt(T.hoy)}</b></div>
        <div class="kpi"><small>Este mes</small><b class="num">${fmt(T.mes)}</b></div>
        <div class="kpi"><small>Acumulado${hayISR() ? ' (bruto)' : ''}</small><b class="num">${fmt(T.bruto)}</b></div>
      </div>
      ${hayISR() ? `<p class="sub">Rendimiento neto de ISR: <b class="num">${fmt(T.neto)}</b></p>` : ''}
    </div>
    ${grupos.length ? grupos.map(g => {
      const aps = g.cuentas.flatMap(x => x.aps), Tb = sumar(aps);
      return `<section class="banco">
        <div class="banco-t"><h2>🏦 ${esc(g.banco)}</h2><b class="num">${fmt(Tb.saldo)}</b></div>
        ${g.cuentas.map(x => `<div class="cuenta">
          <div class="cuenta-t"><span>${esc(x.cuenta.nombre)} <small class="sub">· ${esc(textoCap(x.cuenta))}</small></span><b class="num">${fmt(sumar(x.aps).saldo)}</b></div>
          ${x.aps.length ? `<div class="tarjetas">${x.aps.map(a => tarjetaAp(a, T)).join('')}</div>` : '<div class="vacio">Esta cuenta aún no tiene apartados.</div>'}
        </div>`).join('')}
      </section>`;
    }).join('') : `<div class="card vacio">Aún no tienes cuentas. Crea la primera en la pestaña <b>Cuentas</b> (banco y nombre) y luego sus apartados.</div>`}
    <div class="card">
      <div class="fila entre">
        <h2>Crecimiento</h2>
        <div class="fila">
          <label class="inline">Ver<select data-graf="filtro">${opcionesFiltroGraf()}</select></label>
          <div class="segmentos" role="group" aria-label="Tipo de gráfica">
            <button data-acc="modo" data-id="ap" class="${modoGrafica === 'ap' ? 'on' : ''}">Por apartado</button>
            <button data-acc="modo" data-id="tot" class="${modoGrafica === 'tot' ? 'on' : ''}">Capital vs. interés</button>
          </div>
          <div class="segmentos" role="group" aria-label="Rango">
            ${['1M', '3M', '6M', '1A', 'Todo'].map(r => `<button data-acc="rango" data-id="${r}" class="${rango === r ? 'on' : ''}">${r}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="grafica"><canvas id="cv" aria-label="Gráfica de crecimiento del saldo"></canvas></div>
      <p class="sub" id="grafica-msg"></p>
    </div>`;
  dibujarGrafica();
}
$('#v-resumen').addEventListener('change', e => { if (e.target.dataset.graf === 'filtro') { filtroGraf = e.target.value; renderResumen(); } });

function dibujarGrafica() {
  if (vista !== 'resumen' || !S) return;
  const cv = $('#cv'); if (!cv) return;
  if (grafica) { grafica.destroy(); grafica = null; }
  if (typeof Chart === 'undefined') { $('#grafica-msg').textContent = 'No se pudo cargar la librería de gráficas (¿sin internet?).'; return; }
  const sr = S.serie, dias = { '1M': 30, '3M': 90, '6M': 180, '1A': 365, Todo: Infinity }[rango];
  const n = sr.fechas.length, ini = Math.max(0, n - dias);
  if (!n) { $('#grafica-msg').textContent = 'Todavía no hay historial para graficar.'; return; }
  $('#grafica-msg').textContent = '';
  const labels = sr.fechas.slice(ini), pesos = a => a.slice(ini).map(c => c / 100);
  const css = getComputedStyle(document.documentElement), tx = css.getPropertyValue('--tx2').trim(), brd = css.getPropertyValue('--brd').trim();
  const ids = idsFiltroGraf();
  const suma = (mapa) => labels.map((_, k) => ids.reduce((s, id) => s + ((mapa[id] || [])[ini + k] || 0), 0));
  let sets;
  if (modoGrafica === 'ap') {
    sets = S.apartados.filter(a => ids.includes(a.id) && sr.ap[a.id] && sr.ap[a.id].some(v => v > 0)).map(a => ({
      label: a.nombre + (S.cuentas.length > 1 ? ' · ' + (cuentaDeAp(a) || {}).banco : ''), data: pesos(sr.ap[a.id]), borderColor: colorDe(a),
      backgroundColor: colorDe(a) + '66', fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0
    }));
  } else {
    const saldo = suma(sr.ap), cap = suma(sr.cap || {});
    sets = [{ label: 'Capital aportado', data: cap.map(c => c / 100), borderColor: PALETA[1], backgroundColor: PALETA[1] + '66', fill: true, pointRadius: 0, borderWidth: 1.5 },
      { label: 'Intereses ganados', data: saldo.map((s, k) => (s - cap[k]) / 100), borderColor: PALETA[2], backgroundColor: PALETA[2] + '99', fill: true, pointRadius: 0, borderWidth: 1.5 }];
  }
  grafica = new Chart(cv, {
    type: 'line', data: { labels, datasets: sets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: tx, maxTicksLimit: 6, callback(v) { return fmtCorta(labels[v]); } }, grid: { color: brd } },
        y: { stacked: true, ticks: { color: tx, callback: v => oculto ? '' : '$' + v.toLocaleString('es-MX') }, grid: { color: brd } }
      },
      plugins: {
        legend: { labels: { color: tx, boxWidth: 12 } },
        tooltip: { callbacks: {
          title: it => fmtFecha(labels[it[0].dataIndex]),
          label: it => `${it.dataset.label}: ${oculto ? MASK : FMT.format(it.parsed.y)}`,
          footer: items => 'Total: ' + (oculto ? MASK : FMT.format(items.reduce((s, i) => s + i.parsed.y, 0)))
        } }
      }
    }
  });
}

// ---------- Movimientos ----------
function movsFiltrados() {
  const delaCuenta = F.cuenta ? new Set(S.apartados.filter(a => a.cuenta_id === F.cuenta).map(a => a.id)) : null;
  return S.movimientos.map((m, i) => ({ m, i })).filter(({ m }) =>
    (!delaCuenta || delaCuenta.has(m.apartado_id) || delaCuenta.has(m.destino_id)) &&
    (!F.ap || m.apartado_id === F.ap || m.destino_id === F.ap) && (!F.tipo || m.tipo === F.tipo) &&
    (!F.desde || m.fecha >= F.desde) && (!F.hasta || m.fecha <= F.hasta))
    .sort((a, b) => a.m.fecha < b.m.fecha ? 1 : a.m.fecha > b.m.fecha ? -1 : b.i - a.i).map(x => x.m);
}
function renderMovs() {
  const lista = movsFiltrados();
  const dep = lista.filter(m => m.tipo === 'deposito').reduce((s, m) => s + m.monto, 0);
  const ret = lista.filter(m => m.tipo === 'retiro').reduce((s, m) => s + m.monto, 0);
  const optsCu = ['<option value="">Todas las cuentas</option>'].concat((S.cuentas || []).filter(c => c.estado !== 'eliminado')
    .map(c => `<option value="${c.id}" ${F.cuenta === c.id ? 'selected' : ''}>${esc(etqCuenta(c))}</option>`)).join('');
  const optsAp = ['<option value="">Todos los apartados</option>'].concat(S.apartados.filter(a => (a.estado !== 'eliminado' || S.movimientos.some(m => m.apartado_id === a.id || m.destino_id === a.id)) && (!F.cuenta || a.cuenta_id === F.cuenta))
    .map(a => `<option value="${a.id}" ${F.ap === a.id ? 'selected' : ''}>${esc(a.nombre)}${a.estado !== 'activo' ? ' (' + a.estado + ')' : ''}</option>`)).join('');
  $('#v-movs').innerHTML = `
    <div class="card">
      <div class="filtros">
        <label>Cuenta<select data-filtro="cuenta">${optsCu}</select></label>
        <label>Apartado<select data-filtro="ap">${optsAp}</select></label>
        <label>Tipo<select data-filtro="tipo">${[['', 'Todos'], ['deposito', 'Depósitos'], ['retiro', 'Retiros'], ['traspaso', 'Traspasos'], ['ajuste', 'Ajustes']].map(([v, t]) => `<option value="${v}" ${F.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Desde<input type="date" data-filtro="desde" value="${F.desde}"></label>
        <label>Hasta<input type="date" data-filtro="hasta" value="${F.hasta}"></label>
      </div>
      <div class="fila entre" style="margin-top:10px">
        <span class="sub">${lista.length} movimiento(s) · Depósitos <b class="pos num">${fmt(dep)}</b> · Retiros <b class="neg num">${fmt(ret)}</b></span>
        <span class="fila"><button class="sec mini" data-acc="limpiar-filtros">Limpiar</button><button class="sec mini" data-acc="csv-movs">Exportar CSV</button></span>
      </div>
    </div>
    <div class="card">${lista.length ? `<ul class="lista">${lista.map(itemMov).join('')}</ul>` : '<div class="vacio">No hay movimientos con esos filtros.</div>'}</div>
    ${apsVisibles().length ? '<button class="fab" data-acc="nuevo-mov" aria-label="Nuevo movimiento">+</button>' : ''}`;
}
function itemMov(m) {
  const A = apById(m.apartado_id) || { nombre: '?' }, D = apById(m.destino_id);
  const T = { deposito: ['Depósito', 'pos', '+'], retiro: ['Retiro', 'neg', '−'], traspaso: ['Traspaso', '', ''], ajuste: ['Ajuste de conciliación', m.monto >= 0 ? 'pos' : 'neg', m.monto >= 0 ? '+' : '−'] }[m.tipo];
  const titulo = m.tipo === 'traspaso' ? `${esc(A.nombre)} → ${esc(D ? D.nombre : '?')}` : `${T[0]} · ${esc(A.nombre)}`;
  const cA = cuentaDeAp(A), cD = cuentaDeAp(D);
  const donde = m.tipo === 'traspaso' && cA && cD && cA.id !== cD.id ? `${esc(etqCuenta(cA))} → ${esc(etqCuenta(cD))}` : esc(etqCuenta(cA));
  return `<li>
    <div><div class="t"><span class="punto" style="--c:${colorDe(A)}"></span>${titulo}</div>
      <div class="m">${fmtFecha(m.fecha)} · ${donde}${m.nota ? ' · ' + esc(m.nota) : ''}</div></div>
    <div class="monto num ${T[1]}">${T[2]}${fmt(Math.abs(m.monto))}</div>
    ${m.tipo === 'ajuste' ? '' : `<div class="acc"><button class="sec mini" data-acc="editar-mov" data-id="${m.id}">Editar</button><button class="peligro mini" data-acc="borrar-mov" data-id="${m.id}">Borrar</button></div>`}
  </li>`;
}
$('#v-movs').addEventListener('change', e => {
  const k = e.target.dataset.filtro; if (!k) return;
  F[k] = e.target.value;
  if (k === 'cuenta') F.ap = '';
  renderMovs();
});

function formMovimiento(m) {
  const hoy = S.hoy, activos = apsVisibles();
  const lista = m && !activos.some(a => a.id === m.apartado_id) && apById(m.apartado_id) ? activos.concat(apById(m.apartado_id)) : activos;
  const opt = sel => lista.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.icono)} ${esc(a.nombre)} (${esc(etqCuenta(cuentaDeAp(a)))}) — ${fmt(a.saldo)}</option>`).join('');
  const tipo = m ? m.tipo : 'deposito';
  return `
    <div class="form">
      <label>Tipo<select name="tipo" id="f-tipo">${[['deposito', 'Depósito'], ['retiro', 'Retiro'], ['traspaso', 'Traspaso entre apartados (incluso de otra cuenta o banco)']].map(([v, t]) => `<option value="${v}" ${tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="dos">
        <label>Fecha<input type="date" name="fecha" required max="${hoy}" value="${m ? m.fecha : hoy}"></label>
        <label>Monto (MXN)<input name="monto" required inputmode="decimal" autocomplete="off" placeholder="0.00" value="${m ? cStr(m.monto) : ''}"></label>
      </div>
      <label><span id="l-ap">${tipo === 'traspaso' ? 'Desde' : 'Apartado'}</span><select name="apartado_id" required>${opt(m && m.apartado_id)}</select></label>
      <label id="w-dest" ${tipo === 'traspaso' ? '' : 'hidden'}>Hacia<select name="destino_id">${opt(m && m.destino_id)}</select></label>
      <label>Nota (opcional)<input name="nota" maxlength="200" value="${esc(m ? m.nota : '')}"></label>
    </div>`;
}
function abrirMov(m) {
  modal({
    titulo: m ? 'Editar movimiento' : 'Nuevo movimiento', html: formMovimiento(m),
    onOpen(f) {
      const ajustar = () => {
        const t = f.tipo.value; $('#w-dest', f).hidden = t !== 'traspaso'; $('#l-ap', f).textContent = t === 'traspaso' ? 'Desde' : 'Apartado';
        if (t === 'traspaso' && f.destino_id.value === f.apartado_id.value) {
          const otro = [...f.destino_id.options].find(o => o.value !== f.apartado_id.value); if (otro) f.destino_id.value = otro.value;
        }
      };
      f.tipo.addEventListener('change', ajustar); f.apartado_id.addEventListener('change', ajustar); ajustar();
    },
    async onSubmit(fd) {
      const d = Object.fromEntries(fd);
      if (d.tipo !== 'traspaso') d.destino_id = '';
      if (m) d.id = m.id;
      await mutar('movimiento_guardar', d, m ? 'Movimiento actualizado' : 'Movimiento registrado');
    }
  });
}

// ---------- Cuentas y apartados ----------
function filaAp(a) {
  const t = tasaVigente(a);
  return `<li>
      <div><div class="t"><span class="punto" style="--c:${colorDe(a)}"></span>${esc(a.icono)} ${esc(a.nombre)}${a.estado !== 'activo' ? `<span class="etiqueta">${a.estado}</span>` : ''}
        <span class="chip">${t ? esc(t.pct) + '%' + (t.propia ? '' : ' general') : 'sin tasa'}</span></div>
        <div class="m">Desde ${fmtFecha(a.fecha_inicio)} · Inicial ${fmt(a.saldo_inicial)}${a.notas ? ' · ' + esc(a.notas) : ''}</div></div>
      <div class="monto num">${fmt(a.saldo)}</div>
      <div class="acc">${a.estado === 'activo'
        ? `<button class="sec mini" data-acc="editar-ap" data-id="${a.id}">Editar</button><button class="sec mini" data-acc="tasa-ap" data-id="${a.id}">Tasa</button><button class="sec mini" data-acc="archivar-ap" data-id="${a.id}">Archivar</button><button class="peligro mini" data-acc="eliminar-ap" data-id="${a.id}">Eliminar</button>`
        : `<button class="sec mini" data-acc="reactivar-ap" data-id="${a.id}">Reactivar</button>`}</div></li>`;
}
function renderAps() {
  const grupos = gruposPorBanco();
  const arcAps = S.apartados.filter(a => a.estado === 'archivado');
  const arcCu = (S.cuentas || []).filter(c => c.estado === 'archivado');
  const tarjetaCuenta = x => {
    const c = x.cuenta, T = sumar(x.aps);
    return `<div class="card cuenta-card">
      <div class="fila entre"><div><h3>${esc(c.nombre)}</h3><div class="sub">${esc(c.banco)} · ${esc(textoCap(c))}${textoISR(c) ? ' · ' + esc(textoISR(c)) : ''}</div></div>
        <b class="num">${fmt(T.saldo)}</b></div>
      ${x.aps.length ? `<ul class="lista">${x.aps.map(filaAp).join('')}</ul>` : '<div class="vacio">Sin apartados todavía.</div>'}
      <div class="fila" style="margin-top:10px">
        <button class="primario mini" data-acc="nuevo-ap" data-id="${c.id}">+ Apartado</button>
        <button class="sec mini" data-acc="editar-cuenta" data-id="${c.id}">Editar cuenta</button>
        <button class="sec mini" data-acc="archivar-cuenta" data-id="${c.id}">Archivar</button>
        <button class="peligro mini" data-acc="eliminar-cuenta" data-id="${c.id}">Eliminar</button>
      </div></div>`;
  };
  $('#v-aps').innerHTML = `
    <div class="card"><div class="fila entre"><h2>Cuentas y apartados</h2><button class="primario" data-acc="nueva-cuenta">+ Nueva cuenta</button></div>
      <p class="sub">Estructura: <b>banco ▸ cuenta ▸ apartado</b>. La tasa de interés se asigna a cada apartado. Para mover dinero a otro apartado, cuenta o banco usa un <b>traspaso</b> en Movimientos. Para archivar o eliminar una cuenta o apartado debe estar en saldo cero; el historial siempre se conserva.</p></div>
    ${grupos.length ? grupos.map(g => `<section class="banco"><div class="banco-t"><h2>🏦 ${esc(g.banco)}</h2><b class="num">${fmt(sumar(g.cuentas.flatMap(x => x.aps)).saldo)}</b></div>${g.cuentas.map(tarjetaCuenta).join('')}</section>`).join('')
      : '<div class="card vacio">Aún no hay cuentas. Crea una con <b>+ Nueva cuenta</b> y después agrega sus apartados.</div>'}
    ${(arcAps.length || arcCu.length) ? `<div class="card"><div class="fila entre"><h3>Archivados (${arcAps.length + arcCu.length})</h3><button class="sec mini" data-acc="ver-arch">${verArchivados ? 'Ocultar' : 'Mostrar'}</button></div>
      ${verArchivados ? `${arcCu.length ? `<p class="sub">Cuentas</p><ul class="lista">${arcCu.map(c => `<li><div><div class="t">${esc(etqCuenta(c))}<span class="etiqueta">archivada</span></div></div><div></div><div class="acc"><button class="sec mini" data-acc="reactivar-cuenta" data-id="${c.id}">Reactivar</button></div></li>`).join('')}</ul>` : ''}
        ${arcAps.length ? `<p class="sub">Apartados</p><ul class="lista">${arcAps.map(filaAp).join('')}</ul>` : ''}` : ''}</div>` : ''}`;
}
function abrirCuenta(c) {
  const bancos = [...new Set((S.cuentas || []).map(x => x.banco))];
  modal({
    titulo: c ? 'Editar cuenta' : 'Nueva cuenta',
    html: `<div class="form">
      <label>Banco<input name="banco" required maxlength="40" list="dl-bancos" autocomplete="off" placeholder="BBVA, Nu, Santander…" value="${esc(c ? c.banco : '')}">
        <datalist id="dl-bancos">${bancos.map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
      <label>Nombre de la cuenta<input name="nombre" required maxlength="60" placeholder="Ahorro, Nómina, Cajitas…" value="${esc(c ? c.nombre : '')}"></label>
      <label>Capitalización de intereses
        <select name="capitalizacion"><option value="" ${c && c.capitalizacion ? '' : 'selected'}>Igual que Ajustes (${S.config.capitalizacion === 'mensual' ? 'mensual' : 'diaria'})</option>
          <option value="diaria" ${c && c.capitalizacion === 'diaria' ? 'selected' : ''}>Diaria — el interés se suma al saldo cada día</option>
          <option value="mensual" ${c && c.capitalizacion === 'mensual' ? 'selected' : ''}>Mensual — se acumula y se suma a fin de mes</option></select></label>
      <label>Retención de ISR (%)<input name="isr_pct" inputmode="decimal" placeholder="Vacío = igual que Ajustes (${esc(S.config.isr_pct)}%)" value="${esc(c ? c.isr_pct : '')}"></label>
      <label>Notas (opcional)<textarea name="notas" rows="2" maxlength="500">${esc(c ? c.notas : '')}</textarea></label>
      <p class="sub">La tasa de interés se captura en cada apartado.${c ? ' Cambiar la capitalización o el ISR recalcula el historial de esta cuenta.' : ''}</p>
    </div>`,
    async onSubmit(fd) { const d = Object.fromEntries(fd); if (c) d.id = c.id; await mutar('cuenta_guardar', d, c ? 'Cuenta actualizada' : 'Cuenta creada'); }
  });
}
function abrirAp(a, cuentaId) {
  const cuentas = cuentasActivas();
  if (!a && !cuentas.length) { alert('Primero crea una cuenta (banco y nombre).'); return; }
  modal({
    titulo: a ? 'Editar apartado' : 'Nuevo apartado',
    html: `<div class="form">
      ${a ? `<p class="sub">Cuenta: <b>${esc(etqCuenta(cuentaDeAp(a)))}</b> (no cambia; para mover dinero usa un traspaso)</p>`
        : `<label>Cuenta<select name="cuenta_id" required>${cuentas.map(c => `<option value="${c.id}" ${c.id === cuentaId ? 'selected' : ''}>${esc(etqCuenta(c))}</option>`).join('')}</select></label>`}
      <label>Nombre<input name="nombre" required maxlength="60" value="${esc(a ? a.nombre : '')}"></label>
      <div class="dos">
        <label>Saldo inicial (MXN)<input name="saldo_inicial" inputmode="decimal" placeholder="0.00" value="${a ? cStr(a.saldo_inicial) : ''}"></label>
        <label>Fecha de inicio<input type="date" name="fecha_inicio" required max="${S.hoy}" value="${a ? a.fecha_inicio : S.hoy}"></label>
      </div>
      ${a ? '' : `<label>Tasa anual (%) de este apartado<input name="tasa_pct" inputmode="decimal" placeholder="Vacío = usar la tasa general"></label>
        <p class="sub">Rige desde la fecha de inicio. Si cambia después, usa el botón <b>Tasa</b> del apartado.</p>`}
      <div class="dos">
        <label>Color<input type="color" name="color" value="${a && a.color ? a.color : PALETA[S.apartados.length % PALETA.length]}"></label>
        <label>Ícono (emoji, opcional)<input name="icono" maxlength="4" value="${esc(a ? a.icono : '')}"></label>
      </div>
      <label>Notas (opcional)<textarea name="notas" rows="2" maxlength="500">${esc(a ? a.notas : '')}</textarea></label>
      ${a ? '<p class="sub">Si cambias el saldo inicial o la fecha de inicio, todo el historial se recalcula.</p>' : ''}
    </div>`,
    async onSubmit(fd) { const d = Object.fromEntries(fd); if (a) d.id = a.id; await mutar('apartado_guardar', d, a ? 'Apartado actualizado' : 'Apartado creado'); }
  });
}
function abrirTasaAp(a) {
  const propias = S.tasas.filter(t => t.apartado_id === a.id).sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio));
  const v = tasaVigente(a);
  modal({
    titulo: `Tasa de ${a.nombre}`,
    html: `<div class="form">
      <p class="sub">Hoy: <b>${v ? esc(v.pct) + '%' + (v.propia ? ' (propia)' : ' (general)') : 'sin tasa'}</b>.
        ${propias.length ? 'Historial propio: ' + propias.map(t => `${fmtFecha(t.fecha_inicio)} → ${esc(t.tasa_pct)}%`).join(' · ') : 'Aún no tiene tasa propia.'}</p>
      <div class="dos">
        <label>Vigente desde<input type="date" name="fecha_inicio" required max="${S.hoy}" value="${S.hoy}"></label>
        <label>Tasa anual (%)<input name="tasa_pct" required inputmode="decimal" placeholder="10.00"></label>
      </div>
      <p class="sub">Agrega una fila nueva con la fecha en que empieza la tasa; los días anteriores no cambian. Para quitar una tasa propia ve a Ajustes ▸ Tasa anual.</p>
    </div>`,
    async onSubmit(fd) {
      const d = Object.fromEntries(fd); d.apartado_id = a.id;
      if (propias.some(t => t.fecha_inicio === d.fecha_inicio) && !confirm('Ya existe una tasa propia con esa fecha. ¿Reemplazarla? Se recalculará el historial desde esa fecha.')) throw new Error('No se guardó.');
      await mutar('tasa_guardar', d, 'Tasa guardada y recalculada');
    }
  });
}

// ---------- Conciliación ----------
function renderConc() {
  const hist = [...S.conciliaciones].reverse();
  const cuentas = cuentasActivas();
  const sel = (conc && conc.cuenta_id) || ultimaCuentaConc || (cuentas[0] || {}).id || '';
  $('#v-conc').innerHTML = `
    <div class="card">
      <h2>Conciliar con el banco</h2>
      <p class="sub">Elige la cuenta y captura el saldo real que muestra el banco <b>al cierre</b> de una fecha. La app lo compara contra la suma de los apartados de <b>esa cuenta</b>.</p>
      <form class="form" id="f-conc" style="margin-top:12px">
        <label>Cuenta<select name="cuenta_id" required>${cuentas.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(etqCuenta(c))}</option>`).join('')}</select></label>
        <div class="dos">
          <label>Fecha del saldo<input type="date" name="fecha" required max="${S.hoy}" value="${conc ? conc.fecha : S.hoy}"></label>
          <label>Saldo en el banco (MXN)<input name="saldo_banco" required inputmode="decimal" placeholder="0.00" value="${conc ? cStr(conc.saldo_banco) : ''}"></label>
        </div>
        <p class="err" id="err-conc" role="alert"></p>
        <button class="primario" type="submit" ${cuentas.length ? '' : 'disabled'}>Comparar</button>
      </form>
    </div>
    <div id="res-conc">${conc ? htmlResultadoConc() : ''}</div>
    <div class="card"><h3>Historial de conciliaciones</h3>
      ${hist.length ? `<ul class="lista">${hist.map(c => `<li><div><div class="t">${fmtFecha(c.fecha)} · ${esc(etqCuenta(cuentaById(c.cuenta_id)))} · Banco ${fmt(c.saldo_banco)}</div>
        <div class="m">App ${fmt(c.saldo_app)} · Diferencia ${fmtS(c.diferencia)} · ${c.ajuste ? 'Ajustado (' + esc(c.modo) + ')' : 'Sin ajuste'}${c.nota ? ' · ' + esc(c.nota) : ''}</div></div>
        <div></div><div class="acc"><button class="peligro mini" data-acc="borrar-conc" data-id="${c.id}">Borrar${c.ajuste ? ' (y deshacer ajuste)' : ''}</button></div></li>`).join('')}</ul>` : '<div class="vacio">Aún no hay conciliaciones.</div>'}</div>`;
}
function htmlResultadoConc() {
  const p = conc, ok = p.diferencia === 0;
  const aps = S.apartados.filter(a => a.cuenta_id === p.cuenta_id && a.estado === 'activo');
  return `<div class="card">
    <table class="tabla num"><tbody>
      <tr><td>Cuenta</td><td class="r"><b>${esc(etqCuenta(cuentaById(p.cuenta_id)))}</b></td></tr>
      <tr><td>Saldo según el banco</td><td class="r"><b>${fmt(p.saldo_banco)}</b></td></tr>
      <tr><td>Suma de sus apartados (${fmtFecha(p.fecha)})</td><td class="r"><b>${fmt(p.saldo_app)}</b></td></tr>
      <tr><td>Diferencia</td><td class="r"><b class="${ok ? 'pos' : p.diferencia > 0 ? 'pos' : 'neg'}">${ok ? 'Cuadra ✓' : fmtS(p.diferencia)}</b></td></tr>
    </tbody></table>
    ${ok ? '<p class="sub">No hay nada que ajustar. Puedes guardar la conciliación como constancia.</p>' : `
    <p class="sub">${p.diferencia > 0 ? 'El banco tiene más de lo que calcula la app (por ejemplo, intereses reales mayores).' : 'El banco tiene menos de lo que calcula la app.'}</p>
    <div class="form" style="margin-top:10px" id="opc-conc">
      <label>¿Qué hacemos con la diferencia?
        <select id="c-modo"><option value="ninguno" ${p.modo === 'ninguno' ? 'selected' : ''}>Solo registrar la diferencia (sin ajustar)</option>
          <option value="proporcional" ${p.modo === 'proporcional' ? 'selected' : ''}>Ajustar proporcional al saldo de cada apartado</option>
          <option value="manual" ${p.modo === 'manual' ? 'selected' : ''}>Ajustar manualmente por apartado</option></select></label>
      ${p.modo === 'ninguno' ? '' : `<table class="tabla num"><thead><tr><th>Apartado</th><th class="r">Saldo</th><th class="r">Ajuste</th></tr></thead><tbody>
        ${aps.map(a => `<tr><td>${esc(a.nombre)}</td><td class="r">${fmt(p.saldos[a.id] || 0)}</td><td class="r">${p.modo === 'proporcional'
          ? fmtS(p.reparto_proporcional[a.id] || 0)
          : `<input class="r-man" data-ap="${a.id}" inputmode="decimal" style="width:110px;text-align:right" value="${esc(p.manual[a.id] ?? '')}" placeholder="0.00">`}</td></tr>`).join('')}
        </tbody></table>
        ${p.modo === 'manual' ? `<p class="sub" id="suma-man">${textoSumaManual()}</p>` : ''}`}
      <label>Nota (opcional)<input id="c-nota" maxlength="200" value="${esc(p.nota || '')}"></label>
    </div>`}
    <p class="err" id="err-aplicar" role="alert"></p>
    <div class="botones"><button class="primario" data-acc="aplicar-conc">${ok || p.modo === 'ninguno' ? 'Guardar conciliación' : 'Guardar y aplicar ajuste'}</button></div>
  </div>`;
}
function textoSumaManual() {
  const suma = Object.values(conc.manual).reduce((s, v) => s + (parseMontoLocal(v) || 0), 0), falta = conc.diferencia - suma;
  return falta === 0 ? `✓ El reparto suma ${fmtS(suma)}, igual que la diferencia.` : `Suma ${fmtS(suma)}; faltan ${fmtS(falta)} para llegar a la diferencia de ${fmtS(conc.diferencia)}.`;
}
$('#v-conc').addEventListener('submit', async e => {
  if (e.target.id !== 'f-conc') return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target)), b = botonEnvio(e); b.disabled = true; $('#err-conc').textContent = '';
  try {
    const p = await api('conciliar_previa', fd);
    ultimaCuentaConc = p.cuenta_id;
    const man = {}; Object.entries(p.reparto_proporcional).forEach(([id, v]) => { man[id] = cStr(v); });
    conc = { ...p, modo: p.diferencia === 0 ? 'ninguno' : 'proporcional', manual: man, nota: '' };
    renderConc();
  } catch (er) { $('#err-conc').textContent = er.message; } finally { b.disabled = false; }
});
$('#v-conc').addEventListener('change', e => { if (e.target.id === 'c-modo') { conc.nota = $('#c-nota')?.value || ''; conc.modo = e.target.value; $('#res-conc').innerHTML = htmlResultadoConc(); } });
$('#v-conc').addEventListener('input', e => {
  if (e.target.classList.contains('r-man')) { conc.manual[e.target.dataset.ap] = e.target.value; $('#suma-man').textContent = textoSumaManual(); }
  if (e.target.id === 'c-nota') conc.nota = e.target.value;
});
async function aplicarConc() {
  const err = $('#err-aplicar'); err.textContent = '';
  const datos = { cuenta_id: conc.cuenta_id, fecha: conc.fecha, saldo_banco: cStr(conc.saldo_banco), nota: conc.nota || '', aplicar: conc.modo !== 'ninguno' && conc.diferencia !== 0, modo: conc.modo };
  if (conc.modo === 'manual') datos.reparto = conc.manual;
  try { await mutar('conciliar', datos, 'Conciliación guardada'); conc = null; renderConc(); }
  catch (er) { err.textContent = er.message; }
}

// ---------- Ajustes ----------
function renderCfg() {
  const c = S.config;
  $('#v-cfg').innerHTML = `
    <div class="dos-col">
    <div class="card"><h2>Valores globales de intereses</h2>
      <p class="sub">Se usan en las cuentas que no definen los suyos (cada cuenta puede tener su propia capitalización e ISR).</p>
      <form class="form" id="f-cfg" style="margin-top:10px">
        <label>Capitalización
          <select name="capitalizacion"><option value="diaria" ${c.capitalizacion === 'diaria' ? 'selected' : ''}>Diaria — el interés se suma al saldo cada día</option>
            <option value="mensual" ${c.capitalizacion === 'mensual' ? 'selected' : ''}>Mensual — se acumula y se suma al saldo a fin de mes</option></select></label>
        <label>Retención de ISR (%) — solo para mostrar rendimiento neto<input name="isr_pct" inputmode="decimal" value="${esc(c.isr_pct)}"></label>
        <p class="sub">Cambiar estos valores recalcula el historial de las cuentas que los heredan.</p>
        <p class="err" id="err-cfg" role="alert"></p>
        <button class="primario" type="submit">Guardar</button>
      </form></div>
    <div class="card"><h2>Tasas anuales (historial)</h2>
      <p class="sub">Cada apartado usa su <b>tasa propia</b> vigente ese día; si no tiene, la <b>general</b>. Interés sobre ${c.dias_anio} días.</p>
      <table class="tabla num"><thead><tr><th>Aplica a</th><th>Desde</th><th class="r">Tasa</th><th></th></tr></thead><tbody>
        ${S.tasas.slice().sort((a, b) => (a.apartado_id || '').localeCompare(b.apartado_id || '') || a.fecha_inicio.localeCompare(b.fecha_inicio)).map(t => `<tr><td>${t.apartado_id ? esc(nomAp(t.apartado_id) || '?') + ` <small class="sub">${esc((cuentaDeAp(apById(t.apartado_id)) || {}).banco || '')}</small>` : '<b>General</b>'}</td><td>${fmtFecha(t.fecha_inicio)}</td><td class="r">${esc(t.tasa_pct)}%</td><td class="r"><button class="peligro mini" data-acc="borrar-tasa" data-id="${t.fecha_inicio}" data-ap="${esc(t.apartado_id)}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin tasa registrada: no se generan intereses.</td></tr>'}
      </tbody></table>
      <form class="form" id="f-tasa" style="margin-top:12px">
        <label>Aplica a<select name="apartado_id"><option value="">General (para apartados sin tasa propia)</option>
          ${S.apartados.filter(a => a.estado !== 'eliminado').map(a => `<option value="${a.id}">Solo ${esc(a.nombre)} (${esc((cuentaDeAp(a) || {}).banco || '')})</option>`).join('')}</select></label>
        <div class="dos"><label>Vigente desde<input type="date" name="fecha_inicio" required max="${S.hoy}" value="${S.hoy}"></label>
          <label>Tasa anual (%)<input name="tasa_pct" required inputmode="decimal" placeholder="10.00"></label></div>
        <p class="err" id="err-tasa" role="alert"></p>
        <button class="sec" type="submit">Agregar / actualizar tasa</button>
      </form></div>
    </div>
    <div class="card"><h2>Privacidad</h2>
      <p class="sub">El botón ${'👁'} de la barra superior oculta o muestra todos los montos de la app en este dispositivo. Ahora: <b>${oculto ? 'ocultos' : 'visibles'}</b>.</p>
      <div class="botones" style="justify-content:flex-start;margin-top:10px"><button class="sec" data-acc="alternar-ojo">${oculto ? 'Mostrar montos' : 'Ocultar montos'}</button></div></div>
    <div class="card"><h2>Exportar y respaldo</h2>
      <p class="sub">Descarga tus datos en CSV (se abren en Excel). Los archivos contienen los montos reales aunque estén ocultos en pantalla. El respaldo automático semanal se configura en Apps Script (ver docs/DESPLIEGUE.md).</p>
      <div class="fila" style="margin-top:10px">
        <button class="sec" data-acc="csv-movs-todos">Movimientos CSV</button>
        <button class="sec" data-acc="csv-saldos">Saldos diarios CSV</button>
        <button class="sec" data-acc="csv-aps">Resumen de apartados CSV</button>
        <button class="sec" data-acc="recalcular">Recalcular intereses</button>
      </div></div>
    <div class="card"><div class="fila entre"><h2>Registro de cambios</h2><button class="sec mini" data-acc="ver-cambios">Cargar últimos 50</button></div>
      <div id="cambios"></div></div>
    <div class="card"><h2>Conexión</h2>
      <p class="sub">App <b>v${APP_VERSION}</b> · Servidor (Apps Script) <b>v${esc(S.version)}</b>${S.version.split('.').slice(0, 2).join('.') !== APP_VERSION.split('.').slice(0, 2).join('.') ? ' <b class="neg">⚠ versiones distintas: publica la que falte</b>' : ''} · Hoy (México): ${fmtFecha(S.hoy)}<br>Datos guardados solo en tu Google Sheets; este dispositivo guarda la URL y el token.</p>
      <div class="botones" style="justify-content:flex-start;margin-top:10px"><button class="peligro" data-acc="salir">Cerrar sesión en este dispositivo</button></div></div>`;
}
$('#v-cfg').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target)), b = botonEnvio(e); b.disabled = true;
  const errEl = e.target.id === 'f-cfg' ? $('#err-cfg') : $('#err-tasa'); errEl.textContent = '';
  if (e.target.id === 'f-tasa' && S.tasas.some(t => t.fecha_inicio === fd.fecha_inicio && (t.apartado_id || '') === fd.apartado_id) &&
      !confirm('Ya existe una tasa con esa fecha para ese destino. ¿Reemplazarla? Se recalculará el historial desde esa fecha.')) { b.disabled = false; return; }
  try { await mutar(e.target.id === 'f-cfg' ? 'config_guardar' : 'tasa_guardar', fd, 'Guardado y recalculado'); }
  catch (er) { errEl.textContent = er.message; b.disabled = false; }
});

// ---------- CSV ----------
const celda = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function descargarCSV(nombre, filas) {
  const blob = new Blob(['﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${nombre}_${S.hoy}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const bancoDe = id => (cuentaDeAp(apById(id)) || {}).banco || '';
const cuentaNomDe = id => (cuentaDeAp(apById(id)) || {}).nombre || '';
function csvMovs(lista) {
  descargarCSV('movimientos', [['fecha', 'tipo', 'banco', 'cuenta', 'apartado', 'banco_destino', 'cuenta_destino', 'destino', 'monto', 'nota']].concat(
    lista.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1).map(m => [m.fecha, m.tipo, bancoDe(m.apartado_id), cuentaNomDe(m.apartado_id), nomAp(m.apartado_id), bancoDe(m.destino_id), cuentaNomDe(m.destino_id), nomAp(m.destino_id), cStr(m.monto), m.nota])));
}
function csvSaldos() {
  const sr = S.serie, ids = S.apartados.filter(a => sr.ap[a.id]);
  descargarCSV('saldos_diarios', [['fecha'].concat(ids.map(a => `${bancoDe(a.id)} / ${a.nombre}`), ['total', 'capital_total', 'intereses_total'])].concat(
    sr.fechas.map((f, i) => [f].concat(ids.map(a => cStr(sr.ap[a.id][i])), [cStr(sr.total[i]), cStr(sr.capital[i]), cStr(sr.intereses[i])]))));
}
function csvAps() {
  descargarCSV('apartados', [['banco', 'cuenta', 'apartado', 'estado', 'tasa_vigente', 'saldo', 'capital', 'intereses', 'interes_hoy', 'interes_mes', 'rendimiento_bruto', 'rendimiento_neto']].concat(
    S.apartados.map(a => [bancoDe(a.id), cuentaNomDe(a.id), a.nombre, a.estado, (tasaVigente(a) || {}).pct || '', cStr(a.saldo), cStr(a.capital), cStr(a.intereses), cStr(a.hoy), cStr(a.mes), cStr(a.bruto), cStr(a.neto)])));
}

// ---------- Acciones por clic ----------
const acciones = {
  'ver-movs'(id) { F.cuenta = ''; F.ap = id; F.tipo = F.desde = F.hasta = ''; renderMovs(); irA('movs'); },
  modo(id) { modoGrafica = id; renderResumen(); },
  rango(id) { rango = id; renderResumen(); },
  'alternar-ojo'() { $('#btn-ojo').click(); },
  'nuevo-mov'() { abrirMov(null); },
  'editar-mov'(id) { abrirMov(S.movimientos.find(m => m.id === id)); },
  async 'borrar-mov'(id) {
    const m = S.movimientos.find(x => x.id === id);
    if (!confirm(`¿Borrar este ${m.tipo} de ${fmt(m.monto)} del ${fmtFecha(m.fecha)}?\nSe recalculará todo el historial.`)) return;
    try { await mutar('movimiento_borrar', { id }, 'Movimiento borrado'); } catch (e) { alert(e.message); }
  },
  'limpiar-filtros'() { F.cuenta = F.ap = F.tipo = F.desde = F.hasta = ''; renderMovs(); },
  'csv-movs'() { csvMovs(movsFiltrados()); },
  'csv-movs-todos'() { csvMovs(S.movimientos); },
  'csv-saldos'() { csvSaldos(); },
  'csv-aps'() { csvAps(); },
  'nueva-cuenta'() { abrirCuenta(null); },
  'editar-cuenta'(id) { abrirCuenta(cuentaById(id)); },
  async 'archivar-cuenta'(id) {
    if (!confirm(`¿Archivar "${etqCuenta(cuentaById(id))}"? Solo es posible sin apartados activos.`)) return;
    try { await mutar('cuenta_estado', { id, estado: 'archivado' }, 'Cuenta archivada'); } catch (e) { alert(e.message); }
  },
  async 'eliminar-cuenta'(id) {
    if (!confirm(`¿Eliminar "${etqCuenta(cuentaById(id))}"?\nSu historial se conserva. Solo es posible sin apartados.`)) return;
    try { await mutar('cuenta_estado', { id, estado: 'eliminado' }, 'Cuenta eliminada'); } catch (e) { alert(e.message); }
  },
  async 'reactivar-cuenta'(id) { try { await mutar('cuenta_estado', { id, estado: 'activo' }, 'Cuenta reactivada'); } catch (e) { alert(e.message); } },
  'nuevo-ap'(id) { abrirAp(null, id); },
  'editar-ap'(id) { abrirAp(apById(id)); },
  'tasa-ap'(id) { abrirTasaAp(apById(id)); },
  async 'archivar-ap'(id) {
    if (!confirm(`¿Archivar "${apById(id).nombre}"? Dejará de aparecer en listas y formularios (el historial se conserva).`)) return;
    try { await mutar('apartado_estado', { id, estado: 'archivado' }, 'Apartado archivado'); } catch (e) { alert(e.message); }
  },
  async 'eliminar-ap'(id) {
    if (!confirm(`¿Eliminar "${apById(id).nombre}"?\nSu historial de movimientos se conserva. Solo es posible si su saldo es cero.`)) return;
    try { await mutar('apartado_estado', { id, estado: 'eliminado' }, 'Apartado eliminado'); } catch (e) { alert(e.message); }
  },
  async 'reactivar-ap'(id) { try { await mutar('apartado_estado', { id, estado: 'activo' }, 'Apartado reactivado'); } catch (e) { alert(e.message); } },
  'ver-arch'() { verArchivados = !verArchivados; renderAps(); },
  'aplicar-conc'() { aplicarConc(); },
  async 'borrar-conc'(id) {
    if (!confirm('¿Borrar esta conciliación? Si generó ajustes, también se deshacen.')) return;
    try { await mutar('conciliacion_borrar', { id }, 'Conciliación borrada'); } catch (e) { alert(e.message); }
  },
  async 'borrar-tasa'(id, btn) {
    if (!confirm(`¿Quitar la tasa vigente desde ${fmtFecha(id)}? Se recalcula el historial desde esa fecha.`)) return;
    try { await mutar('tasa_borrar', { fecha_inicio: id, apartado_id: btn.dataset.ap || '' }, 'Tasa eliminada'); } catch (e) { alert(e.message); }
  },
  async recalcular() { try { S = await api('recalcular'); renderTodo(); toast('Intereses recalculados'); } catch (e) { alert(e.message); } },
  async 'ver-cambios'() {
    try {
      const l = await api('cambios', { limite: 50 });
      $('#cambios').innerHTML = l.length ? `<ul class="lista">${l.map(c => `<li><div><div class="t">${esc(c.entidad)} · ${esc(c.accion)}</div><div class="m">${esc(c.fecha_hora.replace('T', ' '))} — ${esc(oculto ? c.resumen.replace(/-?\$[\d,]+\.\d{2}/g, MASK) : c.resumen)}</div></div><div></div></li>`).join('')}</ul>` : '<div class="vacio">Sin cambios registrados.</div>';
    } catch (e) { alert(e.message); }
  },
  salir() { if (!confirm('¿Cerrar sesión en este dispositivo? Tendrás que volver a pegar la URL y el token.')) return; LS.del('apartados.url'); LS.del('apartados.token'); location.reload(); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-acc]'); if (b && acciones[b.dataset.acc]) acciones[b.dataset.acc](b.dataset.id, b); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('article[data-acc]')) { e.preventDefault(); e.target.click(); } });

// ---------- Ayuda ----------
function renderAyuda() {
  const sec = (t, html, abierta = false) => `<details class="card ayuda"${abierta ? ' open' : ''}><summary>${t}</summary>${html}</details>`;
  $('#v-ayuda').innerHTML = `
    <div class="card"><div class="fila entre"><h2>Instrucciones de uso</h2><button class="sec mini" data-acc="cerrar-ayuda">Volver</button></div>
      <p class="sub">Esta app lleva el control de tu dinero en <b>varios bancos y cuentas</b>, dividido en <b>apartados</b> (objetivos de ahorro), y cuánto interés ha ganado cada uno. La estructura es <b>banco ▸ cuenta ▸ apartado ▸ tasa</b>.</p></div>
    ${sec('Primeros pasos', `<ol>
      <li>En <b>Cuentas ▸ + Nueva cuenta</b> captura el <b>banco</b> y el nombre de la cuenta (por ejemplo, "BBVA · Ahorro"). Repite por cada cuenta o banco que uses.</li>
      <li>En cada cuenta, <b>+ Apartado</b>: nombre, <b>saldo inicial</b>, <b>fecha de inicio</b> (desde cuándo ese dinero está ahí) y la <b>tasa anual</b> de ese apartado.</li>
      <li>Registra tus movimientos en <b>Movimientos</b> (botón <b>+</b>).</li>
      <li>De vez en cuando compara cada cuenta con su banco en <b>Conciliar</b>.</li></ol>`, true)}
    ${sec('Resumen', `<p>Arriba, el <b>saldo total</b> de todas tus cuentas y bancos (capital, intereses, interés de hoy, del mes y acumulado). Abajo, cada banco con su subtotal y, dentro, cada cuenta con sus apartados. La etiqueta <b>✓ Cuadra</b> confirma que la suma coincide con el total calculado. Toca un apartado para ver sus movimientos.</p>
      <p>En la <b>gráfica de crecimiento</b> usa el selector <b>Ver</b> para filtrar por todo, un banco, una cuenta o un apartado, y los botones para cambiar entre "por apartado" y "capital vs. interés" y el rango de fechas.</p>`)}
    ${sec('Cuentas y bancos', `<ul>
      <li>El <b>banco</b> es un texto que escribes al crear la cuenta; las cuentas con el mismo banco se agrupan juntas.</li>
      <li>Cada cuenta puede tener su propia <b>capitalización</b> (diaria o mensual) y <b>retención de ISR</b>; si las dejas vacías usa los valores globales de Ajustes.</li>
      <li>Un apartado pertenece a una sola cuenta y no cambia. Para mover dinero a otro apartado, cuenta o banco, haz un <b>traspaso</b>: el total no cambia, solo los saldos de cada cuenta.</li>
      <li>Archivar o eliminar una cuenta exige que no tenga apartados; para apartados, saldo en cero. El historial se conserva.</li></ul>`)}
    ${sec('Apartados y tasas', `<ul>
      <li>La tasa se asigna <b>a cada apartado</b> al crearlo. Si cambia, usa el botón <b>Tasa</b> del apartado y agrega una fila nueva con la fecha en que empieza: los días anteriores no cambian.</li>
      <li>Si un apartado no tiene tasa propia usa la <b>tasa general</b> (Ajustes). Sin ninguna tasa no se generan intereses (verás "sin tasa").</li>
      <li>Editar o quitar una fila de tasa existente sí recalcula esos días.</li>
      <li><b>Editar</b> cambia nombre, notas, color o ícono. Cambiar el saldo inicial o la fecha de inicio recalcula el historial.</li></ul>`)}
    ${sec('Movimientos', `<ul>
      <li><b>Depósito</b> suma a un apartado; <b>retiro</b> resta; <b>traspaso</b> mueve dinero entre apartados (también de otra cuenta o banco).</li>
      <li>La app <b>bloquea</b> cualquier retiro o traspaso que deje un apartado en negativo, y fechas futuras.</li>
      <li>Puedes <b>editar</b> o <b>borrar</b> movimientos antiguos: se recalcula todo el historial. Si el cambio dejara un saldo negativo en algún día, se rechaza.</li>
      <li>Un movimiento del día D empieza a generar interés el día siguiente.</li>
      <li>Filtra por cuenta, apartado, tipo y fechas, y exporta a CSV.</li></ul>`)}
    ${sec('Intereses', `<ul>
      <li>Interés diario = saldo del apartado al cierre del día anterior × tasa anual ÷ 365, redondeado a centavo.</li>
      <li><b>Capitalización diaria:</b> el interés se suma al saldo cada día. <b>Mensual:</b> se acumula y se suma al saldo a fin de mes.</li>
      <li>La <b>retención de ISR</b> solo sirve para mostrar el rendimiento neto; no cambia los saldos.</li></ul>`)}
    ${sec('Conciliar con el banco', `<ol>
      <li>Elige la <b>cuenta</b>, captura la fecha y el saldo real que muestra ese banco <b>al cierre</b> de ese día y toca <b>Comparar</b>. Se compara contra los apartados de esa cuenta.</li>
      <li>Si hay diferencia (por ejemplo, intereses reales distintos a los calculados), elige: solo registrarla, repartirla <b>proporcional</b> al saldo de cada apartado de la cuenta, o repartirla <b>manualmente</b>.</li>
      <li>El ajuste queda como movimiento. Si te equivocas, borra la conciliación en el historial y se deshace.</li></ol>`)}
    ${sec('Privacidad: ocultar montos', `<p>El botón <b>👁</b> de la barra superior oculta todos los montos (se ven como ${MASK}) en resúmenes, listas, tablas y gráfica; vuelve a tocarlo para mostrarlos. Se recuerda en cada dispositivo. Los formularios de edición y los archivos CSV sí muestran los montos reales.</p>`)}
    ${sec('Instalar en el celular', `<ul><li><b>Android (Chrome):</b> menú ⋮ ▸ Instalar app.</li>
      <li><b>iPhone (Safari):</b> Compartir ▸ Añadir a pantalla de inicio.</li>
      <li>En cada dispositivo pega una vez la URL de tu Web App y tu token.</li></ul>`)}
    ${sec('Respaldos y seguridad', `<ul>
      <li>Tus datos viven en tu Google Sheets. Cada domingo se hace una copia automática en tu Drive (carpeta <i>Respaldos Apartados</i>).</li>
      <li>Descarga CSV desde <b>Ajustes</b> de vez en cuando y guárdalos en otro lugar.</li>
      <li>El <b>token</b> es tu contraseña: no lo compartas. Si se filtra, ejecuta <code>rotarToken</code> en Apps Script.</li>
      <li>Evita editar la hoja a mano; todo se recalcula desde Cuentas, Apartados, Movimientos, Tasas y Conciliaciones.</li></ul>`)}
    ${sec('Problemas comunes', `<ul>
      <li><b>"Token incorrecto":</b> vuelve a copiarlo de tu gestor de contraseñas, sin espacios.</li>
      <li><b>"No hay conexión":</b> revisa internet y que la URL termine en <code>/exec</code>.</li>
      <li><b>"No cuadra" o saldo negativo:</b> alguien editó la hoja a mano. Revisa Ajustes ▸ Registro de cambios o restaura un respaldo.</li>
      <li><b>Versiones distintas</b> (Ajustes ▸ Conexión): publica la parte que falta (Apps Script o archivos de la web).</li>
      <li>Si no ves cambios después de una actualización de la app, ciérrala por completo y ábrela de nuevo.</li></ul>`)}`;
}
$('#nombre-app').textContent = NOMBRE_APP;
$('#version-app').textContent = 'v' + APP_VERSION;
document.title = NOMBRE_APP;
$('#btn-ayuda').addEventListener('click', () => irA('ayuda'));
acciones['cerrar-ayuda'] = () => irA('resumen');
renderAyuda();

// ---------- Arranque ----------
function renderTodo() {
  if (!S) return;
  if (!S.integridad.ok) aviso('⚠ La suma de los apartados no coincide con el total calculado. Revisa la pestaña Cambios de tu hoja o ejecuta "Recalcular intereses".');
  else aviso('');
  renderResumen(); renderMovs(); renderAps(); renderConc(); renderCfg();
}
async function cargar(manual = false) {
  const btn = $('#btn-refrescar'); btn.classList.add('girando');
  try {
    S = await api('estado');
    renderTodo();
    if (manual) toast('Actualizado');
  } catch (e) {
    if (e.codigo === 'no_autorizado') return mostrarConexion('El token ya no es válido. Vuelve a pegarlo.');
    aviso('No se pudieron cargar los datos: ' + e.message);
    if (!S) $('#v-resumen').innerHTML = '<div class="cargando">Sin datos. Toca ↻ para reintentar.</div>';
  } finally { btn.classList.remove('girando'); }
}
function mostrarConexion(msg = '') {
  $('#conexion').hidden = false; $('#err-conexion').textContent = msg;
  const f = $('#form-conexion'); f.url.value = CFG.url;
}
$('#form-conexion').addEventListener('submit', async e => {
  e.preventDefault();
  const url = e.target.url.value.trim(), token = e.target.token.value.trim(), b = botonEnvio(e); b.disabled = true; $('#err-conexion').textContent = '';
  try {
    await api('estado', {}, { url, token });
    CFG = { url, token }; LS.set('apartados.url', url); LS.set('apartados.token', token);
    $('#conexion').hidden = true; e.target.token.value = '';
    await cargar();
  } catch (er) { $('#err-conexion').textContent = er.message; } finally { b.disabled = false; }
});

$('#v-resumen').innerHTML = '<div class="cargando">Cargando…</div>';
if (!CFG.url || !CFG.token) mostrarConexion(); else cargar();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
