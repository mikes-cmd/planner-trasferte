// ==========================================
// STATO GLOBALE DATI E VARIABILI DI ORDINAMENTO
// ==========================================
let tecnici = []; // {nome: '...', funzione: '...', competenza: '...'}
let missioni = [];
let luoghi = []; 
let prodotti = [];
let piattaforme = [];
let scopi = [];
let problematiche = [];
let soluzioni = [];
let codiciProblematica = [];

// Variabili per Asset Management / As-Maintained
let sistemiDeployati = [];
let sottoinsiemi = [];
let catalogoECP = [];
let applicazioneECP = [];

// Variabili per SQLite e Lock
let SQL = null;
let sqlDB = null;
let dbFileHandle = null;
let currentUser = localStorage.getItem('fsm_user') || '';
let isReadOnly = false;
let heartbeatInterval = null;

let timeline, miniTimeline, map, mapLayer, mapLuoghi, mapLuoghiLayer, chartLuoghi, chartAssiemi;

let sortColPlanner = 'inizio'; let sortDescPlanner = true;
let sortColRitorni = 'data'; let sortDescRitorni = true;

const COLORI = ['#2563eb', '#059669', '#ea580c', '#0ea5e9', '#dc2626', '#16a34a', '#c2410c', '#0891b2', '#0d9488', '#b91c1c', '#ca8a04', '#4338ca'];
function getColorForTecnico(nome) { let hash = 0; for (let i=0; i<nome.length; i++) hash = nome.charCodeAt(i) + ((hash<<5)-hash); return COLORI[Math.abs(hash) % COLORI.length]; }
function getInitials(name) { return name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase(); }

function escapeSql(str) { return String(str || '').replace(/'/g, "''"); }
function dateToSql(d) { if(!d) return ''; return String(d).substring(0, 10); }

const parseExcelNumber = (val) => { const p = parseFloat(String(val).replace(',', '.')); return isNaN(p) ? 0 : p; };
const parseExcelDate = (val) => {
    if(!val) return "";
    if(val instanceof Date) return new Date(val.getTime() - val.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    if(typeof val === 'number') return new Date(Math.round((val - 25569) * 86400 * 1000)).toISOString().split('T')[0];
    if(typeof val === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(val)) { const p = val.split(/[\/\-]/); return `${p[2].substring(0,4)}-${p[1]}-${p[0]}`; }
    return String(val).substring(0, 10);
};

// ==========================================
// GESTIONE LOCK E SALVATAGGIO
// ==========================================
function chiediUtente() {
    if (!currentUser) {
        try {
            if (typeof require !== 'undefined') { const os = require('os'); currentUser = os.userInfo().username || os.hostname(); }
            else { currentUser = "Utente_" + Math.floor(Math.random() * 1000); }
        } catch(e) { currentUser = "Utente_" + Math.floor(Math.random() * 1000); }
        localStorage.setItem('fsm_user', currentUser);
    }
}

async function salvaDbSuDisco() {
    if (!dbFileHandle || !sqlDB) return;
    try {
        const data = sqlDB.export();
        const writable = await dbFileHandle.createWritable();
        await writable.write(data);
        await writable.close();
    } catch(e) { console.error("Errore scrittura file:", e); }
}

async function acquisisciLock() {
    isReadOnly = false;
    sqlDB.run(`UPDATE ConfigurazioneLock SET InUso=1, Utente='${escapeSql(currentUser)}', TimestampLock=${Date.now()}, UltimoHeartbeat=${Date.now()}`);
    await salvaDbSuDisco();
    avviaHeartbeat();
}

function avviaHeartbeat() {
    if(heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
        if(isReadOnly || !dbFileHandle) return;
        sqlDB.run(`UPDATE ConfigurazioneLock SET UltimoHeartbeat=${Date.now()}`);
        await salvaDbSuDisco();
    }, 2 * 60 * 1000);
}

async function rilasciaLockManuale() {
    if (isReadOnly || !sqlDB) return;
    sqlDB.run(`UPDATE ConfigurazioneLock SET InUso=0, UltimoHeartbeat=${Date.now()}`);
    await salvaDbSuDisco();
    if(heartbeatInterval) clearInterval(heartbeatInterval);
    alert("Database sbloccato correttamente. Ora gli altri utenti possono aprirlo in scrittura.");
    isReadOnly = true; 
    impostaUIInBaseAlLock('Nessuno');
}

window.addEventListener('beforeunload', (e) => {
    if(!isReadOnly && sqlDB && dbFileHandle) {
        sqlDB.run(`UPDATE ConfigurazioneLock SET InUso=0, UltimoHeartbeat=${Date.now()}`);
        try { sqlDB.export(); } catch(err){}
    }
});

function impostaUIInBaseAlLock(utenteLock) {
    const statusText = document.getElementById('home-status-text');
    const statusDot = document.getElementById('home-status-dot');
    const btnSblocca = document.getElementById('btn-rilascia-lock');

    if (isReadOnly) {
        statusText.innerText = `IN SOLA LETTURA (In uso da: ${utenteLock})`;
        statusDot.className = `w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black bg-orange-500 animate-pulse`;
        if(btnSblocca) btnSblocca.classList.add('hidden');
    } else {
        statusText.innerText = `DB ATTIVO (${currentUser})`;
        statusDot.className = `w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black bg-emerald-500`;
        if(btnSblocca) btnSblocca.classList.remove('hidden');
    }
}

// ==========================================
// MOTORE SQLITE E INDEXED_DB
// ==========================================
const DB_NAME = 'PlannerDB_Store'; const STORE_NAME = 'HandleStore';
function openIndexedDB() { return new Promise((res, rej) => { const req = indexedDB.open(DB_NAME, 1); req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
async function salvaFileHandle(handle) { try { const db = await openIndexedDB(); const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(handle, 'ultimoFileDB'); } catch (e) {} }
async function recuperaFileHandle() { try { const db = await openIndexedDB(); return new Promise((res) => { const tx = db.transaction(STORE_NAME, 'readonly'); const req = tx.objectStore(STORE_NAME).get('ultimoFileDB'); req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); }); } catch (e) { return null; } }

async function preparaMotoreSQL() { if (!SQL) SQL = await window.initSqlJs(); }

async function controllaFileAllAvvio() {
    const handleMemorizzato = await recuperaFileHandle();
    if (handleMemorizzato) {
        try {
            const permission = await handleMemorizzato.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                await preparaMotoreSQL();
                dbFileHandle = handleMemorizzato;
                const file = await dbFileHandle.getFile();
                await elaboraFileSqlite(file);
            }
        } catch(e) {}
    }
}

// ==========================================
// ROUTING SCHERMATE E TAB
// ==========================================
function navigaA(screenName) {
    if(!dbFileHandle && !sqlDB && screenName !== 'home') alert("Attenzione: Nessun database collegato!");
    document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenName}`).classList.add('active');
    if(screenName === 'planner') switchTab('pianifica');
    if(screenName === 'ritorni') switchTabRitorni('dash');
    if(screenName === 'asmaintained') switchTabAsMaintained('salute');
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('bg-blue-100', 'text-blue-800', 'border-black'); b.classList.add('text-slate-700', 'border-transparent'); });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-btn-${tabId}`);
    if(btn) { btn.classList.remove('text-slate-700', 'border-transparent'); btn.classList.add('bg-blue-100', 'text-blue-800', 'border-black'); }
    
	if (tabId === 'timeline') {
        setTimeout(() => {
            popolaFiltriTimeline();
            if (!timeline) {
                initTimeline();
            } else {
                timeline.redraw();
                aggiornaTimeline();
            }
            timelineZoom('mese');
        }, 150);
    }
    if (tabId === 'mappa' && map) { setTimeout(() => { map.invalidateSize(); if(!document.getElementById('map-date-picker').value) impostaMappaOggi(); aggiornaMappa(); }, 100); }
    if (tabId === 'pianifica' && miniTimeline) { setTimeout(() => { miniTimeline.redraw(); aggiornaMiniTimeline(); }, 100); }
    if (tabId === 'luoghi') { setTimeout(() => { renderStatisticheLuoghi(); }, 100); }
}

function switchTabRitorni(tabId) {
    // Distrugge l'istanza Chart.js prima di nascondere il canvas per evitare loop di resize
    if (chartAssiemi) {
        chartAssiemi.destroy();
        chartAssiemi = null;
    }

    document.querySelectorAll('.ritorni-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn-rit').forEach(b => { b.classList.remove('bg-rose-100', 'text-rose-900', 'border-black'); b.classList.add('text-slate-700', 'border-transparent'); });
    document.getElementById(`view-rit-${tabId}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-btn-rit-${tabId}`);
    if(btn) { btn.classList.remove('text-slate-700', 'border-transparent'); btn.classList.add('bg-rose-100', 'text-rose-900', 'border-black'); }
    
    if (tabId === 'dash') {
        renderTabellaProblematiche();
    }
    if (tabId === 'assiemi') { 
        popolaFiltriAssiemi(); 
        // Delay minimo per attendere che il DOM abbia rimosso la classe 'hidden'
        setTimeout(() => { renderAnalisiAssiemi(); }, 50); 
    }
}

function switchTabAsMaintained(tabId) {
    document.querySelectorAll('.tab-content-asm').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn-asm').forEach(b => { b.classList.remove('bg-amber-100', 'text-amber-900', 'border-black'); b.classList.add('text-slate-700', 'border-transparent'); });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-btn-${tabId}`);
    if(btn) { btn.classList.remove('text-slate-700', 'border-transparent'); btn.classList.add('bg-amber-100', 'text-amber-900', 'border-black'); }
}

// ==========================================
// DRAG & DROP, IMPORT DB / EXCEL
// ==========================================
function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  if(!dropZone) return;
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-slate-500'); dropZone.classList.remove('border-slate-600'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('border-slate-500'); dropZone.classList.add('border-slate-600'); });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); dropZone.classList.remove('border-slate-500'); dropZone.classList.add('border-slate-600');
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const item = e.dataTransfer.items[0];
        if (item.kind === 'file') {
            try {
                const fileHandle = await item.getAsFileSystemHandle();
                if(fileHandle.name.endsWith('.xlsx')){ const file = await fileHandle.getFile(); return elaboraFileExcel(file); }
                if (fileHandle && fileHandle.kind === 'file') {
                    await preparaMotoreSQL();
                    dbFileHandle = fileHandle;
                    await salvaFileHandle(dbFileHandle);
                    const file = await dbFileHandle.getFile();
                    await elaboraFileSqlite(file);
                }
            } catch(err) { console.warn(err); }
        }
    }
  });
}

function estraiDatiDaSQL() {
    try {
        const resTec = sqlDB.exec("SELECT * FROM Tecnici"); 
        if(resTec.length) {
            tecnici = resTec[0].values.map(row => ({
                nome: row[0], 
                funzione: row[1] || 'Tecnico',
                competenza: row[2] || 'Non specificata'
            }));
        }
        
        const resLuo = sqlDB.exec("SELECT * FROM Luoghi"); if(resLuo.length) luoghi = resLuo[0].values.map(row => ({ ID_Luogo: row[0], lat: row[1], lon: row[2] }));
        const resProd = sqlDB.exec("SELECT * FROM Prodotti"); if(resProd.length) prodotti = resProd[0].values.map(row => ({ PN: row[0], NomeProdotto: row[1] }));
		try {
            const resCod = sqlDB.exec("SELECT ID_CodiceProblematica, Descrizione FROM CodiciProblematica");
            if (resCod.length && resCod[0].values) {
                codiciProblematica = resCod[0].values.map(row => ({
                    id: String(row[0] || '').trim(),
                    desc: String(row[1] || '').trim()
                }));
            }
        } catch (e) {
            console.warn("Errore lettura codici da SQL, tentativo fallback su SELECT *:", e);
            const resCod = sqlDB.exec("SELECT * FROM CodiciProblematica");
            if (resCod.length && resCod[0].values) {
                codiciProblematica = resCod[0].values.map(row => ({
                    id: String(row[0] || '').trim(),
                    desc: String(row[1] || '').trim()
                }));
            }
        }
		
        const resMiss = sqlDB.exec("SELECT * FROM Trasferte");
        if(resMiss.length) {
            missioni = resMiss[0].values.map(row => {
                const pn = row[9] || ''; const pMatch = prodotti.find(p => p.PN === pn);
                return { id: row[0], tecnico: row[1] || '', destinazione: row[2] || '', inizio: row[3] || '', fine: row[4] || '', scopo: row[5] || '', lat: row[6] || 0, lon: row[7] || 0, piattaforma: row[8] || '', prodottoId: pn, prodottoNome: pMatch ? pMatch.NomeProdotto : '', serialNumber: row[10] || '', allegatiLocali: row[11] || '', allegatiAggiuntivi: row[12] || '' };
            });
            piattaforme = [...new Set(missioni.map(m => m.piattaforma).filter(Boolean))].map(p => ({ label: p }));
            scopi = [...new Set(missioni.map(m => m.scopo).filter(Boolean))].map(s => ({ label: s }));
        }

        const resProb = sqlDB.exec("SELECT * FROM Problematiche"); if(resProb.length) problematiche = resProb[0].values.map(row => ({ id: row[0], id_missione: row[1], pn_assieme: row[2] || '', nome_assieme: row[3] || '', data: row[4] || '', codice: row[5] || '', desc: row[6] || '', sintomi: row[7] || '' }));
        const resSol = sqlDB.exec("SELECT * FROM Soluzioni"); if(resSol.length) soluzioni = resSol[0].values.map(row => ({ id: row[0], id_problema: row[1], data: row[2] || '', azione: row[3] || '', esito: row[4] || '' }));

        try {
            const resSistemi = sqlDB.exec("SELECT * FROM SistemiDeployati"); if(resSistemi.length) sistemiDeployati = resSistemi[0].values.map(row => ({ id: row[0], piattaforma: row[1], prodottoId: row[2], serialNumber: row[3] }));
            const resSotto = sqlDB.exec("SELECT * FROM Sottoinsiemi"); if(resSotto.length) sottoinsiemi = resSotto[0].values.map(row => ({ id: row[0], sistemaId: row[1], nome: row[2], stato: row[3], aggiornamento: row[4], problemaId: row[5] }));
            const resCatECP = sqlDB.exec("SELECT * FROM CatalogoECP"); if(resCatECP.length) catalogoECP = resCatECP[0].values.map(row => ({ id_ecp: row[0], prodottoId: row[1], desc: row[2] }));
            const resAppECP = sqlDB.exec("SELECT * FROM ApplicazioneECP"); if(resAppECP.length) applicazioneECP = resAppECP[0].values.map(row => ({ id: row[0], sistemaId: row[1], ecpId: row[2], stato: row[3], dataApplicazione: row[4], missioneId: row[5] }));
            
            popolaFiltriAsMaintained();
            popolaFiltroMappaProdotti();
        } catch(err) { console.warn("Tabelle Asset Management mancanti."); }
    } catch (err) { console.error("Errore lettura tabelle:", err); }

    inizializzaUIPlanner();
    setupAutocomplete();
    if(document.getElementById('screen-ritorni').classList.contains('active')) renderTabellaProblematiche();
    if(document.getElementById('screen-asmaintained').classList.contains('active')) switchTabAsMaintained('salute');
}

async function elaboraFileExcel(fileBlob) {
    document.getElementById('home-status-text').innerText = "Lettura file Excel in corso...";
    await preparaMotoreSQL();
    
    return new Promise(resolve => {
        const r = new FileReader();
        r.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array', cellDates: true });
                sqlDB = new SQL.Database();
                
                sqlDB.run(`
                    CREATE TABLE ConfigurazioneLock (InUso INTEGER, Utente TEXT, TimestampLock INTEGER, UltimoHeartbeat INTEGER);
                    CREATE TABLE Tecnici (Tecnico TEXT, Funzione TEXT, Competenza TEXT);
                    CREATE TABLE Luoghi (ID_Luogo TEXT, lat REAL, lon REAL);
                    CREATE TABLE Prodotti (PN TEXT, NomeProdotto TEXT);
                    CREATE TABLE CodiciProblematica (ID_CodiceProblematica TEXT, Descrizione TEXT);
                    CREATE TABLE Trasferte (ID_Missione INTEGER PRIMARY KEY, ID_Operatore TEXT, Luogo_ID TEXT, DataInizio TEXT, DataFine TEXT, Scopo TEXT, lat REAL, lon REAL, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT, AllegatiLocali TEXT, AllegatiAggiuntivi TEXT);
                    CREATE TABLE Problematiche (ID_Problema INTEGER PRIMARY KEY, Missione_ID INTEGER, PNAssieme TEXT, NomeAssieme TEXT, DataSegnalazione TEXT, CodiceProblematica_ID TEXT, DescrizioneProblema TEXT, Sintomi TEXT);
                    CREATE TABLE Soluzioni (Soluzione_ID INTEGER PRIMARY KEY, Problema_ID INTEGER, DataSoluzione TEXT, Azione TEXT, Esito TEXT);
                    CREATE TABLE SistemiDeployati (ID_Sistema INTEGER PRIMARY KEY, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT);
                    CREATE TABLE Sottoinsiemi (ID_Sottoinsieme INTEGER PRIMARY KEY, Sistema_ID INTEGER, NomeSottoinsieme TEXT, StatoSalute TEXT, UltimoAggiornamento TEXT, Problema_ID INTEGER);
                    CREATE TABLE CatalogoECP (ID_ECP TEXT PRIMARY KEY, Prodotto_ID TEXT, Descrizione TEXT);
                    CREATE TABLE ApplicazioneECP (ID_Applicazione INTEGER PRIMARY KEY, Sistema_ID INTEGER, ECP_ID TEXT, StatoApplicazione TEXT, DataApplicazione TEXT, Missione_ID INTEGER);
                    INSERT INTO ConfigurazioneLock VALUES (0, '', 0, 0);
                `);

                if (wb.Sheets["Tecnici"]) XLSX.utils.sheet_to_json(wb.Sheets["Tecnici"]).forEach(r => { if(r.Tecnico || r.Nome) sqlDB.run(`INSERT INTO Tecnici VALUES ('${escapeSql(r.Tecnico || r.Nome)}', '${escapeSql(r.Funzione || 'Tecnico')}', '${escapeSql(r.Competenza || 'Non specificata')}')`); });
                if (wb.Sheets["Luoghi"]) XLSX.utils.sheet_to_json(wb.Sheets["Luoghi"]).forEach(r => { const id = r.ID_Luogo || r.Nome || ''; if(id) sqlDB.run(`INSERT INTO Luoghi VALUES ('${escapeSql(id)}', ${parseExcelNumber(r.lat)}, ${parseExcelNumber(r.lon)})`); });
                if (wb.Sheets["Prodotti"]) XLSX.utils.sheet_to_json(wb.Sheets["Prodotti"]).forEach(r => { const pn = r.PN || r.ID_Prodotto || ''; if(pn) sqlDB.run(`INSERT INTO Prodotti VALUES ('${escapeSql(pn)}', '${escapeSql(r.NomeProdotto || r.Nome || r.Descrizione)}')`); });

if (wb.Sheets["CodiciProblematica"]) {
    XLSX.utils.sheet_to_json(wb.Sheets["CodiciProblematica"]).forEach(r => { 
        const keys = Object.keys(r);
        const idKey = keys.find(k => k.match(/^(id|codice|id_codiceproblematica)$/i));
        const descKey = keys.find(k => k.match(/^(desc|descrizione|nome)$/i));
        const id = idKey ? r[idKey] : ''; 
        const desc = descKey ? r[descKey] : '';
        if(id) sqlDB.run(`INSERT INTO CodiciProblematica VALUES ('${escapeSql(id)}', '${escapeSql(desc)}')`); 
    });
}
                if (wb.Sheets["Trasferte"]) XLSX.utils.sheet_to_json(wb.Sheets["Trasferte"]).forEach(r => { const id = parseExcelNumber(r.ID_Missione); const pn = r.PN || r.Prodotto_ID || ''; if(id) sqlDB.run(`INSERT INTO Trasferte VALUES (${id}, '${escapeSql(r.ID_Operatore || r.Tecnico)}', '${escapeSql(r.Luogo_ID || r.Destinazione)}', '${parseExcelDate(r.DataInizio)}', '${parseExcelDate(r.DataFine)}', '${escapeSql(r.Scopo)}', ${parseExcelNumber(r.lat)}, ${parseExcelNumber(r.lon)}, '${escapeSql(r.Piattaforma)}', '${escapeSql(pn)}', '${escapeSql(r.SerialNumber)}', '${escapeSql(r.AllegatiLocali)}', '${escapeSql(r.AllegatiAggiuntivi)}')`); });
                if (wb.Sheets["Problematiche"]) XLSX.utils.sheet_to_json(wb.Sheets["Problematiche"]).forEach(r => { const id = parseExcelNumber(r.ID_Problema || r.ID || r.Id); const id_miss = parseExcelNumber(r.Missione_ID || r.ID_Missione || r.Missione); if(id) sqlDB.run(`INSERT INTO Problematiche VALUES (${id}, ${id_miss}, '${escapeSql(r.PNAssieme)}', '${escapeSql(r.NomeAssieme)}', '${parseExcelDate(r.DataSegnalazione || r.Data || r.Data_Rilevamento)}', '${escapeSql(r.CodiceProblematica_ID || r.Codice_Problema || r.Codice)}', '${escapeSql(r.DescrizioneProblema || r.Descrizione)}', '${escapeSql(r.Sintomi || r.Sintomo)}')`); });
                if (wb.Sheets["Soluzioni"]) XLSX.utils.sheet_to_json(wb.Sheets["Soluzioni"]).forEach(r => { const id = parseExcelNumber(r.Soluzione_ID || r.ID_Soluzione || r.ID || r.Id); const id_prob = parseExcelNumber(r.Problema_ID || r.ID_Problema || r.Problema); if(id) sqlDB.run(`INSERT INTO Soluzioni VALUES (${id}, ${id_prob}, '${parseExcelDate(r.DataSoluzione || r.Data || r.Data_Soluzione)}', '${escapeSql(r.Azione || r.Azione_Correttiva)}', '${escapeSql(r.Esito || r.Stato)}')`); });
                
                if (wb.Sheets["SistemiDeployati"]) XLSX.utils.sheet_to_json(wb.Sheets["SistemiDeployati"]).forEach(r => { const id = parseExcelNumber(r.ID_Sistema || r.ID); if(id) sqlDB.run(`INSERT INTO SistemiDeployati VALUES (${id}, '${escapeSql(r.Piattaforma)}', '${escapeSql(r.Prodotto_ID || r.PN)}', '${escapeSql(r.SerialNumber || r.SN)}')`); });
                if (wb.Sheets["Sottoinsiemi"]) XLSX.utils.sheet_to_json(wb.Sheets["Sottoinsiemi"]).forEach(r => { const id = parseExcelNumber(r.ID_Sottoinsieme || r.ID); const id_sist = parseExcelNumber(r.Sistema_ID || r.Sistema); const id_prob = parseExcelNumber(r.Problema_ID); if(id) sqlDB.run(`INSERT INTO Sottoinsiemi VALUES (${id}, ${id_sist}, '${escapeSql(r.NomeSottoinsieme || r.Nome)}', '${escapeSql(r.StatoSalute || r.Stato)}', '${parseExcelDate(r.UltimoAggiornamento || r.Data)}', ${id_prob})`); });
                if (wb.Sheets["CatalogoECP"]) XLSX.utils.sheet_to_json(wb.Sheets["CatalogoECP"]).forEach(r => { const id = r.ID_ECP || r.ECP_ID || r.ID || ''; if(id) sqlDB.run(`INSERT INTO CatalogoECP VALUES ('${escapeSql(id)}', '${escapeSql(r.Prodotto_ID || r.PN)}', '${escapeSql(r.Descrizione || r.Desc)}')`); });
                if (wb.Sheets["ApplicazioneECP"]) XLSX.utils.sheet_to_json(wb.Sheets["ApplicazioneECP"]).forEach(r => { const id = parseExcelNumber(r.ID_Applicazione || r.ID); const id_sist = parseExcelNumber(r.Sistema_ID || r.Sistema); const id_miss = parseExcelNumber(r.Missione_ID || r.ID_Missione); if(id) sqlDB.run(`INSERT INTO ApplicazioneECP VALUES (${id}, ${id_sist}, '${escapeSql(r.ECP_ID)}', '${escapeSql(r.StatoApplicazione || r.Stato)}', '${parseExcelDate(r.DataApplicazione || r.DataPianificata || r.Data)}', ${id_miss})`); });

                chiediUtente();
                dbFileHandle = null; 
                isReadOnly = true; 
                
                document.getElementById('btn-salva-sqlite').classList.remove('hidden');
                impostaUIInBaseAlLock('Simulazione Excel (Sola Lettura)');
                estraiDatiDaSQL();
                
                alert("File Excel convertito in SQLite e caricato in memoria per l'ambiente di sviluppo!\n\nNota: La modalità è Sola Lettura. Clicca 'Salva .SQLite' se vuoi renderlo permanente e scrivibile.");
                resolve();
            } catch(e) { console.error(e); resolve(); }
        };
        r.readAsArrayBuffer(fileBlob);
    });
}

async function importaDaExcelPicker() {
    if (!window.showOpenFilePicker) return alert("Browser non supportato per File System Access API.");
    try {
        const [handle] = await window.showOpenFilePicker({ types: [{ accept: {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']} }] });
        const file = await handle.getFile();
        await elaboraFileExcel(file);
    } catch(e) {}
}

async function salvaNuovoSQLite() {
    if (!sqlDB) return alert("Nessun database in memoria.");
    if (!window.showSaveFilePicker) return alert("Browser non supportato per il salvataggio file.");
    try {
        const handle = await window.showSaveFilePicker({ suggestedName: 'FSM_Database.sqlite', types: [{ accept: {'application/x-sqlite3': ['.sqlite', '.db']} }] });
        const data = sqlDB.export();
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        
        dbFileHandle = handle;
        await salvaFileHandle(dbFileHandle);
        isReadOnly = false;
        document.getElementById('btn-salva-sqlite').classList.add('hidden');
        impostaUIInBaseAlLock(currentUser);
        alert("Database salvato con successo e connesso in lettura/scrittura!");
    } catch(e) { console.error(e); }
}

async function creaNuovoDatabase() {
    if (!window.showSaveFilePicker) return alert("Browser non supportato.");
    await preparaMotoreSQL();
    try {
        dbFileHandle = await window.showSaveFilePicker({ suggestedName: 'FSM_Database.sqlite' });
        await salvaFileHandle(dbFileHandle);
        chiediUtente();
        
        sqlDB = new SQL.Database();
        sqlDB.run(`
            CREATE TABLE ConfigurazioneLock (InUso INTEGER, Utente TEXT, TimestampLock INTEGER, UltimoHeartbeat INTEGER);
            CREATE TABLE Tecnici (Tecnico TEXT, Funzione TEXT, Competenza TEXT);
            CREATE TABLE Luoghi (ID_Luogo TEXT, lat REAL, lon REAL);
            CREATE TABLE Prodotti (PN TEXT, NomeProdotto TEXT);
            CREATE TABLE CodiciProblematica (ID_CodiceProblematica TEXT, Descrizione TEXT);
            CREATE TABLE Trasferte (ID_Missione INTEGER PRIMARY KEY, ID_Operatore TEXT, Luogo_ID TEXT, DataInizio TEXT, DataFine TEXT, Scopo TEXT, lat REAL, lon REAL, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT, AllegatiLocali TEXT, AllegatiAggiuntivi TEXT);
            CREATE TABLE Problematiche (ID_Problema INTEGER PRIMARY KEY, Missione_ID INTEGER, PNAssieme TEXT, NomeAssieme TEXT, DataSegnalazione TEXT, CodiceProblematica_ID TEXT, DescrizioneProblema TEXT, Sintomi TEXT);
            CREATE TABLE Soluzioni (Soluzione_ID INTEGER PRIMARY KEY, Problema_ID INTEGER, DataSoluzione TEXT, Azione TEXT, Esito TEXT);
            CREATE TABLE SistemiDeployati (ID_Sistema INTEGER PRIMARY KEY, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT);
            CREATE TABLE Sottoinsiemi (ID_Sottoinsieme INTEGER PRIMARY KEY, Sistema_ID INTEGER, NomeSottoinsieme TEXT, StatoSalute TEXT, UltimoAggiornamento TEXT, Problema_ID INTEGER);
            CREATE TABLE CatalogoECP (ID_ECP TEXT PRIMARY KEY, Prodotto_ID TEXT, Descrizione TEXT);
            CREATE TABLE ApplicazioneECP (ID_Applicazione INTEGER PRIMARY KEY, Sistema_ID INTEGER, ECP_ID TEXT, StatoApplicazione TEXT, DataApplicazione TEXT, Missione_ID INTEGER);
            INSERT INTO ConfigurazioneLock VALUES (0, '', 0, 0);
        `);

        tecnici=[]; missioni=[]; luoghi=[]; problematiche=[]; soluzioni=[]; prodotti=[]; codiciProblematica=[];
        sistemiDeployati=[]; sottoinsiemi=[]; catalogoECP=[]; applicazioneECP=[];
        
        await acquisisciLock();
        impostaUIInBaseAlLock(currentUser);
        inizializzaUIPlanner();
        alert("Database SQLite creato!");
    } catch(e) {}
}

async function collegaDatabaseSync() {
    if (!window.showOpenFilePicker) return alert("Browser non supportato.");
    await preparaMotoreSQL();
    try {
        [dbFileHandle] = await window.showOpenFilePicker({ types: [{ accept: {'application/x-sqlite3': ['.sqlite', '.db']} }] });
        await salvaFileHandle(dbFileHandle);
        const file = await dbFileHandle.getFile();
        await elaboraFileSqlite(file);
    } catch(e) {}
}

function elaboraFileSqlite(fileBlob) {
    return new Promise(resolve => {
        const r = new FileReader();
        r.onload = async (e) => {
            const uInt8Array = new Uint8Array(e.target.result);
            sqlDB = new SQL.Database(uInt8Array);
            chiediUtente();

            let lockData = { InUso: 0, Utente: '', TimestampLock: 0, UltimoHeartbeat: 0 };
            try {
                const resLock = sqlDB.exec("SELECT InUso, Utente, TimestampLock, UltimoHeartbeat FROM ConfigurazioneLock");
                if (resLock.length) lockData = { InUso: resLock[0].values[0][0], Utente: resLock[0].values[0][1], TimestampLock: resLock[0].values[0][2], UltimoHeartbeat: resLock[0].values[0][3] };
            } catch (err) {
                sqlDB.run("CREATE TABLE ConfigurazioneLock (InUso INTEGER, Utente TEXT, TimestampLock INTEGER, UltimoHeartbeat INTEGER)");
                sqlDB.run("INSERT INTO ConfigurazioneLock VALUES (0, '', 0, 0)");
            }

            const NOW = Date.now();
            const LOCK_TIMEOUT = 5 * 60 * 1000;
            
            if (lockData.InUso === 1 && (NOW - lockData.UltimoHeartbeat) < LOCK_TIMEOUT && lockData.Utente !== currentUser) {
                alert(`🔒 DATABASE BLOCCATO\nIl database è attualmente in uso da: ${lockData.Utente}.\nIl sistema verrà aperto in SOLA LETTURA per prevenire la corruzione dei dati.`);
                isReadOnly = true;
            } else {
                await acquisisciLock();
                lockData.Utente = currentUser;
            }

            impostaUIInBaseAlLock(lockData.Utente);
            estraiDatiDaSQL();
            resolve();
        };
        r.readAsArrayBuffer(fileBlob);
    });
}

async function syncData() {
    if (!sqlDB || isReadOnly) return;
    
    let lockVals = [1, currentUser, Date.now(), Date.now()];
    try {
        const resLock = sqlDB.exec("SELECT InUso, Utente, TimestampLock, UltimoHeartbeat FROM ConfigurazioneLock");
        if (resLock.length) lockVals = resLock[0].values[0];
    } catch(e){}
    
    sqlDB.run(`
        DROP TABLE IF EXISTS ConfigurazioneLock; CREATE TABLE ConfigurazioneLock (InUso INTEGER, Utente TEXT, TimestampLock INTEGER, UltimoHeartbeat INTEGER);
        DROP TABLE IF EXISTS Tecnici; CREATE TABLE Tecnici (Tecnico TEXT, Funzione TEXT, Competenza TEXT);
        DROP TABLE IF EXISTS Luoghi; CREATE TABLE Luoghi (ID_Luogo TEXT, lat REAL, lon REAL);
        DROP TABLE IF EXISTS Prodotti; CREATE TABLE Prodotti (PN TEXT, NomeProdotto TEXT);
        DROP TABLE IF EXISTS CodiciProblematica; CREATE TABLE CodiciProblematica (ID_CodiceProblematica TEXT, Descrizione TEXT);
        DROP TABLE IF EXISTS Trasferte; CREATE TABLE Trasferte (ID_Missione INTEGER PRIMARY KEY, ID_Operatore TEXT, Luogo_ID TEXT, DataInizio TEXT, DataFine TEXT, Scopo TEXT, lat REAL, lon REAL, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT, AllegatiLocali TEXT, AllegatiAggiuntivi TEXT);
        DROP TABLE IF EXISTS Problematiche; CREATE TABLE Problematiche (ID_Problema INTEGER PRIMARY KEY, Missione_ID INTEGER, PNAssieme TEXT, NomeAssieme TEXT, DataSegnalazione TEXT, CodiceProblematica_ID TEXT, DescrizioneProblema TEXT, Sintomi TEXT);
        DROP TABLE IF EXISTS Soluzioni; CREATE TABLE Soluzioni (Soluzione_ID INTEGER PRIMARY KEY, Problema_ID INTEGER, DataSoluzione TEXT, Azione TEXT, Esito TEXT);
        DROP TABLE IF EXISTS SistemiDeployati; CREATE TABLE SistemiDeployati (ID_Sistema INTEGER PRIMARY KEY, Piattaforma TEXT, Prodotto_ID TEXT, SerialNumber TEXT);
        DROP TABLE IF EXISTS Sottoinsiemi; CREATE TABLE Sottoinsiemi (ID_Sottoinsieme INTEGER PRIMARY KEY, Sistema_ID INTEGER, NomeSottoinsieme TEXT, StatoSalute TEXT, UltimoAggiornamento TEXT, Problema_ID INTEGER);
        DROP TABLE IF EXISTS CatalogoECP; CREATE TABLE CatalogoECP (ID_ECP TEXT PRIMARY KEY, Prodotto_ID TEXT, Descrizione TEXT);
        DROP TABLE IF EXISTS ApplicazioneECP; CREATE TABLE ApplicazioneECP (ID_Applicazione INTEGER PRIMARY KEY, Sistema_ID INTEGER, ECP_ID TEXT, StatoApplicazione TEXT, DataApplicazione TEXT, Missione_ID INTEGER);
    `);

    sqlDB.run(`INSERT INTO ConfigurazioneLock VALUES (${lockVals[0]}, '${escapeSql(lockVals[1])}', ${lockVals[2]}, ${lockVals[3]})`);
    tecnici.forEach(t => sqlDB.run(`INSERT INTO Tecnici VALUES ('${escapeSql(t.nome)}', '${escapeSql(t.funzione)}', '${escapeSql(t.competenza)}')`));
    luoghi.forEach(l => sqlDB.run(`INSERT INTO Luoghi VALUES ('${escapeSql(l.ID_Luogo)}', ${l.lat}, ${l.lon})`));
    prodotti.forEach(p => sqlDB.run(`INSERT INTO Prodotti VALUES ('${escapeSql(p.PN)}', '${escapeSql(p.NomeProdotto)}')`));
    codiciProblematica.forEach(c => sqlDB.run(`INSERT INTO CodiciProblematica VALUES ('${escapeSql(c.id)}', '${escapeSql(c.desc)}')`));
    missioni.forEach(m => sqlDB.run(`INSERT INTO Trasferte VALUES (${m.id}, '${escapeSql(m.tecnico)}', '${escapeSql(m.destinazione)}', '${m.inizio}', '${m.fine}', '${escapeSql(m.scopo)}', ${m.lat}, ${m.lon}, '${escapeSql(m.piattaforma)}', '${escapeSql(m.prodottoId)}', '${escapeSql(m.serialNumber)}', '${escapeSql(m.allegatiLocali)}', '${escapeSql(m.allegatiAggiuntivi)}')`));
    problematiche.forEach(p => sqlDB.run(`INSERT INTO Problematiche VALUES (${p.id}, ${p.id_missione}, '${escapeSql(p.pn_assieme)}', '${escapeSql(p.nome_assieme)}', '${p.data}', '${escapeSql(p.codice)}', '${escapeSql(p.desc)}', '${escapeSql(p.sintomi)}')`));
    soluzioni.forEach(s => sqlDB.run(`INSERT INTO Soluzioni VALUES (${s.id}, ${s.id_problema}, '${s.data}', '${escapeSql(s.azione)}', '${escapeSql(s.esito)}')`));
    sistemiDeployati.forEach(s => sqlDB.run(`INSERT INTO SistemiDeployati VALUES (${s.id}, '${escapeSql(s.piattaforma)}', '${escapeSql(s.prodottoId)}', '${escapeSql(s.serialNumber)}')`));
    sottoinsiemi.forEach(s => sqlDB.run(`INSERT INTO Sottoinsiemi VALUES (${s.id}, ${s.sistemaId}, '${escapeSql(s.nome)}', '${escapeSql(s.stato)}', '${s.aggiornamento}', ${s.problemaId || 0})`));
    catalogoECP.forEach(e => sqlDB.run(`INSERT INTO CatalogoECP VALUES ('${escapeSql(e.id_ecp)}', '${escapeSql(e.prodottoId)}', '${escapeSql(e.desc)}')`));
    applicazioneECP.forEach(a => sqlDB.run(`INSERT INTO ApplicazioneECP VALUES (${a.id}, ${a.sistemaId}, '${escapeSql(a.ecpId)}', '${escapeSql(a.stato)}', '${a.dataApplicazione}', ${a.missioneId || 0})`));

    await salvaDbSuDisco();
}

// ==========================================
// ASSET MANAGEMENT, AI COPILOT & MTBF
// ==========================================

function calcolaMTBFAssieme(pn, nomeAssieme) {
    const guasti = problematiche.filter(p => 
        String(p.pn_assieme).trim().toLowerCase() === String(pn).trim().toLowerCase() && 
        String(p.nome_assieme).trim().toLowerCase() === String(nomeAssieme).trim().toLowerCase()
    );
    const snAttivi = sistemiDeployati.filter(s => String(s.prodottoId).trim().toLowerCase() === String(pn).trim().toLowerCase()).length || 1;
    const giorniOsservazione = 365; 
    const tempoOperativoCumulato = snAttivi * giorniOsservazione;
    
    if (guasti.length === 0) return { mtbf: `> ${tempoOperativoCumulato}`, guasti: 0 };
    return { mtbf: String(Math.round(tempoOperativoCumulato / guasti.length)), guasti: guasti.length };
}

function calcolaMTBFSistema(pn) {
    const guasti = problematiche.filter(p => String(p.pn_assieme).trim().toLowerCase() === String(pn).trim().toLowerCase());
    const snAttivi = sistemiDeployati.filter(s => String(s.prodottoId).trim().toLowerCase() === String(pn).trim().toLowerCase()).length || 1;
    const giorniOsservazione = 365; 
    const tempoOperativoCumulato = snAttivi * giorniOsservazione;
    
    if (guasti.length === 0) return { mtbf: `> ${tempoOperativoCumulato}`, guasti: 0 };
    return { mtbf: String(Math.round(tempoOperativoCumulato / guasti.length)), guasti: guasti.length };
}

function getTopOffenders() {
    const conteggi = {};
    problematiche.forEach(p => {
        const codObj = codiciProblematica.find(c => String(c.id).trim().toLowerCase() === String(p.codice).trim().toLowerCase());
        const codiceId = codObj ? codObj.id : (p.codice || 'Sconosciuto');
        const codiceDesc = codObj ? codObj.desc : 'Descrizione non disponibile';
        
        const key = `${codiceId}|||${codiceDesc}`;
        conteggi[key] = (conteggi[key] || 0) + 1;
    });

    return Object.entries(conteggi)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => {
            const [id, desc] = key.split('|||');
            return { id, desc, count };
        });
}

async function assistenteCopilot(testoGrezzo) {
    const ENDPOINT_AZIENDALE = "https://ai-copilot.azienda.local/v1/completions";
    const API_KEY = "TOKEN_AUTORIZZAZIONE_LOCALE";
    document.getElementById('ai-loading').classList.remove('hidden');
    try {
        const response = await fetch(ENDPOINT_AZIENDALE, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
            body: JSON.stringify({
                model: "modello-aziendale-approvato",
                prompt: `Riscrivi in modo professionale, sintetico a punti elenco. Estrai 3 parole chiave.\n\n${testoGrezzo}`,
                max_tokens: 250, temperature: 0.3
            })
        });
        const data = await response.json();
        return data.choices[0].text.trim();
    } catch (error) {
        console.warn("Copilot non raggiungibile, fallback locale.");
        alert("Copilot Aziendale offline. Verifica la rete o la VPN.");
        return testoGrezzo;
    } finally {
        document.getElementById('ai-loading').classList.add('hidden');
    }
}

async function applicaMagiaAI() {
    const textarea = document.getElementById('segnala-prob-desc');
    if(textarea.value.trim().length < 10) return alert("Inserisci più dettagli per usare l'AI.");
    textarea.value = await assistenteCopilot(textarea.value);
}

function popolaFiltriAsMaintained() {
    const pnUnici = [...new Set(sistemiDeployati.map(s => s.prodottoId))].sort();
    let opt = '<option value="">-- Seleziona --</option>' + pnUnici.map(pn => `<option value="${pn}">${pn}</option>`).join('');
    document.getElementById('asm-salute-pn').innerHTML = opt;
    document.getElementById('asm-ecp-pn').innerHTML = opt;
}

function popolaFiltroMappaProdotti() {
    const pnMap = [...new Set(missioni.map(m => m.prodottoId).filter(Boolean))].sort();
    document.getElementById('filter-mappa-prodotto').innerHTML = '<option value="">Tutti i prodotti</option>' + pnMap.map(pn => `<option value="${pn}">${pn}</option>`).join('');
}

function aggiornaFiltroSN(tab) {
    const pn = document.getElementById(`asm-${tab}-pn`).value;
    const snSelect = document.getElementById(`asm-${tab}-sn`);
    if(!pn) { snSelect.innerHTML = '<option value="">-- Tutti --</option>'; return; }
    const sns = sistemiDeployati.filter(s => s.prodottoId === pn).map(s => s.serialNumber).sort();
    snSelect.innerHTML = '<option value="">-- Tutti --</option>' + sns.map(sn => `<option value="${sn}">${sn}</option>`).join('');
}

function filtraSalute() {
    const query = document.getElementById('search-salute').value.toLowerCase();
    document.querySelectorAll('.salute-row').forEach(row => { row.style.display = row.getAttribute('data-search').includes(query) ? '' : 'none'; });
}

function filtraECP() {
    const query = document.getElementById('search-ecp').value.toLowerCase();
    document.querySelectorAll('.ecp-row').forEach(row => { row.style.display = row.getAttribute('data-search').includes(query) ? '' : 'none'; });
}

function calcolaStatoGlobale(id_sistema) {
    const sub = sottoinsiemi.filter(s => s.sistemaId === id_sistema);
    if (sub.length === 0) return { stato: 'Sconosciuto', colore: 'bg-slate-200 text-slate-800 border-slate-400' };
    const critici = sub.filter(s => String(s.stato).toLowerCase() === 'critico').length;
    const degradati = sub.filter(s => String(s.stato).toLowerCase() === 'degradato').length;
    if (critici > 0) return { stato: 'Critico', colore: 'bg-rose-100 text-rose-900 border-rose-600' };
    if (degradati > 0) return { stato: 'Degradato', colore: 'bg-amber-100 text-amber-900 border-amber-500' };
    return { stato: 'Operativo', colore: 'bg-emerald-100 text-emerald-900 border-emerald-600' };
}

function renderTabellaSalute() {
    const pnFiltro = document.getElementById('asm-salute-pn').value;
    const snFiltro = document.getElementById('asm-salute-sn').value;
    const nascondiSub = document.getElementById('asm-salute-nosub').checked;
    const container = document.getElementById('tabella-salute-container');

    if(!pnFiltro) { container.innerHTML = '<div class="p-6 text-center font-bold text-slate-500">Seleziona un Part Number per visualizzare i dati.</div>'; return; }

    let sistemi = sistemiDeployati.filter(s => s.prodottoId === pnFiltro);
    if(snFiltro) sistemi = sistemi.filter(s => s.serialNumber === snFiltro);
    if(sistemi.length === 0) { container.innerHTML = '<div class="p-6 text-center font-bold text-slate-500">Nessun sistema trovato per i criteri selezionati.</div>'; return; }

    const rowsHTML = sistemi.map(sistema => {
        const subs = sottoinsiemi.filter(s => s.sistemaId === sistema.id);
        const globale = calcolaStatoGlobale(sistema.id);
        const statsSist = calcolaMTBFSistema(sistema.prodottoId);
        const badgeMTBFSist = `<span class="text-[9px] font-extrabold text-blue-600 bg-blue-50 border border-blue-300 px-1.5 py-0.5 rounded shadow-sm inline-block mt-1.5" title="Guasti totali per piattaforma: ${statsSist.guasti}">MTBF Globale: ${statsSist.mtbf} gg</span>`;
        const searchStr = `${sistema.piattaforma} ${sistema.prodottoId} ${sistema.serialNumber} ${subs.map(s=>s.nome).join(' ')}`.toLowerCase();
        
        if (nascondiSub) {
            const badgeGlobale = `<span class="text-[10px] font-extrabold px-2 py-1 rounded border ${globale.colore}">${globale.stato.toUpperCase()}</span>`;
            const probsSistema = subs.filter(s => s.problemaId).map(s => s.problemaId);
            const countProbs = probsSistema.length;
            const missSistema = [...new Set(probsSistema.map(pid => { const p = problematiche.find(x => x.id === pid); return p ? p.id_missione : null; }).filter(Boolean))];
            
            const linkGuasti = countProbs > 0 ? `<button onclick="apriDettaglioProblema(${probsSistema[0]});" class="text-[10px] bg-rose-100 hover:bg-rose-200 border border-rose-600 text-rose-900 px-2 py-1.5 rounded font-bold shadow-sm transition-colors cursor-pointer w-full text-center">${countProbs} Guasti Registrati</button>` : '<span class="text-slate-400 text-xs">-</span>';
            const linkMiss = missSistema.length > 0 ? `<button onclick="apriDettaglioMissione(${missSistema[0]});" class="text-[10px] bg-blue-100 hover:bg-blue-200 border border-blue-600 text-blue-900 px-2 py-1.5 rounded font-bold shadow-sm transition-colors cursor-pointer w-full text-center">${missSistema.length} Trasferte Associate</button>` : '<span class="text-slate-400 text-xs">-</span>';

					return `
                    <div class="grid grid-cols-9 border-t border-slate-100 first:border-0 items-center min-h-[44px]">
                        <div class="col-span-4 p-2 pl-4 pr-4 flex justify-between items-center border-r border-slate-200">
                            <div class="flex flex-col items-start">
                                <span class="text-xs font-bold text-slate-800">${sub.nome}</span>
                                <span class="text-[9px] font-mono text-slate-500 font-extrabold mt-0.5 block">SN: ${sistema.serialNumber}</span>
                                ${badgeMTBF}
                            </div>
                            <span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${bg}">${sub.stato}</span>
                        </div>
                        <div class="col-span-2 p-2 px-4 border-r border-slate-200 flex justify-center items-center h-full">${linkGuasto}</div>
                        <div class="col-span-3 p-2 px-4 pr-4 flex justify-center items-center h-full">${linkMissHTML}</div>
                    </div>`;
        } else {
            const subRowsHTML = subs.length === 0 
                ? '<div class="p-4 text-xs text-slate-500 font-bold italic">Nessun sottoinsieme tracciato.</div>'
                : subs.map(sub => {
                    let bg = 'bg-emerald-100 text-emerald-900 border-emerald-500';
                    if (sub.stato === 'Degradato') bg = 'bg-amber-100 text-amber-900 border-amber-500';
                    if (sub.stato === 'Critico') bg = 'bg-rose-100 text-rose-900 border-rose-500';
                    
                    let linkedProb = sub.problemaId; let linkedMiss = null;
                    if(linkedProb && linkedProb !== 0) { const prob = problematiche.find(p => p.id === linkedProb); if(prob) linkedMiss = prob.id_missione; }

                    const linkGuasto = linkedProb && linkedProb !== 0 ? `<button onclick="apriDettaglioProblema(${linkedProb});" class="text-[10px] bg-rose-100 hover:bg-rose-200 border border-rose-600 text-rose-900 px-2 py-1 rounded font-bold shadow-sm transition-colors cursor-pointer w-full text-center">Guasto #${linkedProb}</button>` : '<div class="text-center"><span class="text-slate-400 text-xs">-</span></div>';
                    const linkMissHTML = linkedMiss && linkedMiss !== 0 ? `<button onclick="apriDettaglioMissione(${linkedMiss});" class="text-[10px] bg-blue-100 hover:bg-blue-200 border border-blue-600 text-blue-900 px-2 py-1 rounded font-bold shadow-sm transition-colors cursor-pointer w-full text-center">Trasferta #${linkedMiss}</button>` : '<div class="text-center"><span class="text-slate-400 text-xs">-</span></div>';

                    const stats = calcolaMTBFAssieme(sistema.prodottoId, sub.nome);
                    const badgeMTBF = `<span class="text-[9px] font-extrabold text-blue-600 bg-white border border-blue-300 px-1.5 py-0.5 rounded shadow-sm inline-block mt-1" title="Guasti registrati per questo sottoinsieme: ${stats.guasti}">MTBF: ${stats.mtbf} gg</span>`;

                    return `
                    <div class="grid grid-cols-9 border-t border-slate-100 first:border-0 items-center min-h-[44px]">
                        <div class="col-span-4 p-2 pl-4 pr-4 flex justify-between items-center border-r border-slate-200">
                            <div class="flex flex-col items-start">
                                <span class="text-xs font-bold text-slate-800">${sub.nome}</span>
                                <div><span class="text-[9px] font-mono text-slate-500 font-extrabold mt-0.5 block">SN: ${sistema.serialNumber}</span></div>
                                ${badgeMTBF}
                            </div>
                            <span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${bg}">${sub.stato}</span>
                        </div>
                        <div class="col-span-2 p-2 px-4 border-r border-slate-200 flex justify-center items-center h-full">${linkGuasto}</div>
                        <div class="col-span-3 p-2 px-4 pr-4 flex justify-center items-center h-full">${linkMissHTML}</div>
                    </div>`;
                }).join('');

            return `
            <div class="salute-row grid grid-cols-12 hover:bg-slate-50 transition-colors items-stretch border-t border-slate-200" data-search="${searchStr}">
                <div class="col-span-3 p-4 border-r border-slate-300 flex flex-col pt-4">
                    <b class="text-slate-900 block text-sm">${sistema.piattaforma}</b>
                    <div><span class="text-[11px] font-mono font-extrabold bg-white border border-slate-400 text-slate-800 px-1.5 py-0.5 rounded mt-1.5 inline-block">SN: ${sistema.serialNumber}</span></div>
                    <div>${badgeMTBFSist}</div>
                </div>
                <div class="col-span-9 flex flex-col justify-center">${subRowsHTML}</div>
            </div>`;
        }
    }).join('');

    container.innerHTML = `
    <div class="mb-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <h3 class="text-base font-extrabold text-white bg-slate-800 px-4 py-2 flex items-center justify-between">
            <span>Prodotto Base PN: <span class="text-blue-300 font-mono">${pnFiltro}</span></span>
        </h3>
        <div class="overflow-x-auto p-4">
            <div class="border-2 border-black rounded-lg overflow-hidden flex flex-col bg-white shadow-sm">
                <div class="grid grid-cols-12 bg-slate-100 text-[11px] uppercase font-extrabold text-slate-700 border-b-2 border-black">
                    <div class="col-span-3 p-3 pl-4 border-r border-slate-300">Piattaforma / SN</div>
                    <div class="col-span-4 p-3 border-r border-slate-300">Sottoinsiemi & Stato</div>
                    <div class="col-span-2 p-3 border-r border-slate-300 text-center">Guasti Correlati</div>
                    <div class="col-span-3 p-3 text-center pr-4">Trasferte Associate</div>
                </div>
                <div class="divide-y-2 divide-slate-200">
                    ${rowsHTML}
                </div>
            </div>
        </div>
    </div>`;
}

function renderMatriceECP() {
    const pnFiltro = document.getElementById('asm-ecp-pn').value;
    const snFiltro = document.getElementById('asm-ecp-sn').value;
    const container = document.getElementById('matrice-ecp-container');
    
    if(!pnFiltro) { container.innerHTML = '<p class="text-slate-500 font-bold text-center mt-6">Seleziona un Part Number per visualizzare i dati.</p>'; return; }

    let sistemiPN = sistemiDeployati.filter(s => s.prodottoId === pnFiltro);
    if(snFiltro) sistemiPN = sistemiPN.filter(s => s.serialNumber === snFiltro);
    if(sistemiPN.length === 0) { container.innerHTML = '<p class="text-slate-500 font-bold text-center mt-6">Nessun sistema trovato per i criteri selezionati.</p>'; return; }

    const ecpTeoriche = catalogoECP.filter(e => e.prodottoId === pnFiltro);
    if(ecpTeoriche.length === 0) { container.innerHTML = '<p class="text-slate-500 font-bold text-center mt-6">Nessuna ECP associata a questo Part Number.</p>'; return; }

    const thECP = ecpTeoriche.map(ecp => `<th class="p-3 border border-slate-300 text-center min-w-[150px] align-top"><span class="block font-extrabold">${ecp.id_ecp}</span><span class="block text-[9px] font-bold mt-1 text-slate-500 leading-tight whitespace-normal">${ecp.desc}</span></th>`).join('');
    
    const trSistemi = sistemiPN.map(sist => {
        const searchStr = `${sist.piattaforma} ${sist.serialNumber}`.toLowerCase();
        const tdECP = ecpTeoriche.map(ecp => {
            const app = applicazioneECP.find(a => a.sistemaId === sist.id && a.ecpId === ecp.id_ecp);
            const stato = app ? app.stato.toLowerCase() : 'da applicare';
            const data = app ? app.dataApplicazione : '';
            const missId = app ? app.missioneId : 0;
            
            let bg = 'bg-rose-100 text-rose-900 border-rose-300'; let icon = '❌';
            if (stato === 'pianificata') { bg = 'bg-amber-100 text-amber-900 border-amber-300'; icon = '⏳'; }
            if (stato === 'applicata' || stato === 'aggiornata') { bg = 'bg-emerald-100 text-emerald-900 border-emerald-300'; icon = '✅'; }

            const onDblClick = missId && missId !== 0 ? `ondblclick="apriDettaglioMissione(${missId})" class="p-2 border border-slate-300 text-center relative group cursor-pointer hover:bg-slate-200 transition-colors" title="Doppio clic per visualizzare la missione associata"` : `class="p-2 border border-slate-300 text-center relative group"`;

            return `
            <td ${onDblClick}>
                <div class="flex flex-col items-center justify-center p-2 rounded border ${bg} h-full min-h-[60px] shadow-sm">
                    <span class="text-[10px] font-extrabold uppercase block tracking-wider">${icon} ${stato}</span>
                    ${data ? `<span class="text-[11px] font-bold block mt-1.5 opacity-80">${data}</span>` : '<span class="text-[10px] opacity-40 mt-1 block">-</span>'}
                </div>
            </td>`;
        }).join('');

        return `<tr class="ecp-row" data-search="${searchStr}"><td class="p-3 border border-slate-300 font-bold text-slate-800 bg-slate-50">${sist.piattaforma} <br><span class="font-mono text-xs font-extrabold bg-white border border-slate-300 px-1 py-0.5 rounded inline-block mt-1">SN: ${sist.serialNumber}</span></td>${tdECP}</tr>`;
    }).join('');

    container.innerHTML = `
    <div class="mb-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <h3 class="text-base font-extrabold text-white bg-slate-800 px-4 py-2 flex items-center justify-between"><span>Prodotto Base PN: <span class="text-blue-300 font-mono">${pnFiltro}</span></span></h3>
        <div class="overflow-x-auto p-4">
            <table class="w-full text-left text-sm border-collapse">
                <thead class="bg-slate-200 text-slate-800 text-[11px] uppercase font-extrabold">
                    <tr><th class="p-3 border border-slate-300 min-w-[220px] align-bottom">Piattaforma / SN</th>${thECP}</tr>
                </thead>
                <tbody>${trSistemi}</tbody>
            </table>
        </div>
    </div>`;
}

// ==========================================
// RITORNI DAL CAMPO: NUOVA ANALISI ASSIEMI
// ==========================================

function popolaFiltriAssiemi() {
    const pnUnici = [...new Set(problematiche.map(p => p.pn_assieme))].filter(Boolean).sort();
    document.getElementById('rit-assiemi-pn').innerHTML = '<option value="">-- Seleziona --</option>' + pnUnici.map(pn => `<option value="${pn}">${pn}</option>`).join('');
}

function aggiornaFiltroAssiemi() {
    const pn = document.getElementById('rit-assiemi-pn').value;
    const assiemiSelect = document.getElementById('rit-assiemi-nome');
    if(!pn) { assiemiSelect.innerHTML = '<option value="">-- Tutti --</option>'; renderAnalisiAssiemi(); return; }
    
    const assiemiUnici = [...new Set(problematiche.filter(p => String(p.pn_assieme).trim().toLowerCase() === String(pn).trim().toLowerCase()).map(p => p.nome_assieme))].filter(Boolean).sort();
    assiemiSelect.innerHTML = '<option value="">-- Tutti --</option>' + assiemiUnici.map(a => `<option value="${a}">${a}</option>`).join('');
    renderAnalisiAssiemi();
}

function renderAnalisiAssiemi() {
    const pn = document.getElementById('rit-assiemi-pn').value;
    const assieme = document.getElementById('rit-assiemi-nome').value;
    const containerTbl = document.getElementById('tabella-assiemi');
    
    if(!pn) { 
        containerTbl.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 font-bold">Seleziona un prodotto per visualizzare i guasti.</td></tr>';
        if(chartAssiemi) chartAssiemi.destroy();
        return; 
    }

    let filtered = problematiche.filter(p => String(p.pn_assieme).trim().toLowerCase() === String(pn).trim().toLowerCase());
    if(assieme) filtered = filtered.filter(p => String(p.nome_assieme).trim().toLowerCase() === String(assieme).trim().toLowerCase());

    if(filtered.length === 0) {
        containerTbl.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 font-bold">Nessun guasto trovato.</td></tr>';
        if(chartAssiemi) chartAssiemi.destroy();
        return;
    }

    // Tabella
    containerTbl.innerHTML = filtered.map(p => {
        const m = missioni.find(x => x.id === p.id_missione) || {destinazione: 'Sconosciuta', tecnico: 'N/D'}; 
        const sol = soluzioni.filter(x => x.id_problema === p.id);
        const isRisolto = sol.some(x => String(x.esito).trim().toLowerCase() === 'positivo' || String(x.esito).trim().toLowerCase() === 'risolto');
        const statoHtml = isRisolto ? `<span class="px-2 py-1 bg-emerald-100 text-emerald-900 border-2 border-emerald-600 text-[10px] font-extrabold rounded">CHIUSO</span>` : `<span class="px-2 py-1 bg-rose-100 text-rose-900 border-2 border-rose-600 text-[10px] font-extrabold rounded">APERTO</span>`;
		const codObj = codiciProblematica.find(c => String(c.id).trim().toLowerCase() === String(p.codice).trim().toLowerCase());
		const codId = String(p.codice || 'N/D').trim();
        const codDesc = getDescrizioneCodiceDalDB(codId);
        const strCodice = `
            <div class="flex flex-col">
                <span class="font-mono font-extrabold text-slate-900 text-xs">${codId}</span>
                ${codDesc ? `<span class="text-[11px] font-semibold text-slate-600 leading-tight mt-1">${codDesc}</span>` : ''}
            </div>`;
		const strDesc = `<div class="mb-2"><span class="text-[10px] uppercase font-bold text-slate-400">Descrizione</span><br><b class="text-slate-900 text-xs">${p.desc || 'N/D'}</b></div><div><span class="text-[10px] uppercase font-bold text-slate-400">Sintomi</span><br><span class="text-xs font-bold text-slate-700">${p.sintomi || 'N/D'}</span></div>`;
        
        return `<tr ondblclick="apriDettaglioProblema(${p.id})" class="hover:bg-blue-50 transition-colors cursor-pointer"><td class="p-4 pl-6 align-top border-r border-slate-300"><span class="text-sm text-slate-900 font-extrabold">${p.data}</span><br><span class="text-[9px] font-mono text-slate-500 font-extrabold mt-1 block">Sub: ${p.nome_assieme || 'N/D'}</span></td><td class="p-4 text-xs align-top border-r border-slate-300"><b class="text-slate-900 text-sm">${m.destinazione}</b><br><span class="text-slate-700 font-bold">${m.tecnico.replace(/;/g, ', ')}</span></td><td class="p-4 text-xs align-top bg-slate-50 border-r border-slate-300">${strCodice}</td><td class="p-4 text-xs align-top border-r border-slate-300">${strDesc}</td><td class="p-4 text-center align-top">${statoHtml}</td></tr>`;
    }).join('');

    // Statistiche Torta
    const conteggi = {};
    filtered.forEach(p => {
        const codObj = codiciProblematica.find(c => String(c.id) === String(p.codice));
        const etichetta = codObj ? `${codObj.id} - ${codObj.desc}` : (p.codice || 'Sconosciuto');
        conteggi[etichetta] = (conteggi[etichetta] || 0) + 1;
    });
    
    const labels = Object.keys(conteggi);
    const data = Object.values(conteggi);
    const bgColors = labels.map((_, i) => COLORI[i % COLORI.length]);

	const canvas = document.getElementById('chart-assiemi');
    if (!canvas) return;
    
    if (chartAssiemi) {
        chartAssiemi.destroy();
        chartAssiemi = null;
    }

    // Se il contenitore è nascosto, non istanziare Chart.js
    if (canvas.offsetParent === null) return;

    const ctx = canvas.getContext('2d');
    chartAssiemi = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: bgColors, borderColor: '#000', borderWidth: 2 }] },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            resizeDelay: 100, // Evita micro-riallocazioni continue
            plugins: { 
                legend: { 
                    position: 'bottom', 
                    labels: { font: { weight: 'bold', size: 10 }, color: '#0f172a' } 
                } 
            } 
        }
    });
}

// ==========================================
// LOGICA GESTIONE TRASFERTE E ORDINAMENTO
// ==========================================
function sortPlanner(col) { if (sortColPlanner === col) { sortDescPlanner = !sortDescPlanner; } else { sortColPlanner = col; sortDescPlanner = false; } renderTabella(); }
function sortRitorni(col) { if (sortColRitorni === col) { sortDescRitorni = !sortDescRitorni; } else { sortColRitorni = col; sortDescRitorni = false; } renderTabellaProblematiche(); }

function filtraPlanner() {
    const query = document.getElementById('search-planner').value.toLowerCase();
    document.querySelectorAll('#tabella-corpo tr.planner-row').forEach(row => { row.style.display = row.getAttribute('data-search').includes(query) ? '' : 'none'; });
}

function inizializzaUIPlanner() { popolaSelectTecnici(); renderTabella(); renderListaTeam(); renderListaLuoghi(); aggiornaTimeline(); aggiornaMiniTimeline(); aggiornaMappa(); }

function calcolaProssimoId(array, propId = 'id') { return array.length > 0 ? Math.max(...array.map(x => parseInt(x[propId], 10) || 0)) + 1 : 1; }

async function salvaMissione(e) {
    e.preventDefault();
    if(isReadOnly) return alert("Modalità Sola Lettura: impossibile salvare modifiche.");
    const tec = document.getElementById('input-tecnico').value;
    const dest = document.getElementById('input-destinazione').value.trim();
    const ini = document.getElementById('input-inizio').value;
    const fine = document.getElementById('input-fine').value;
    if(!tec) return alert("Seleziona tecnico.");
    if (fine < ini) return alert("Data fine non coerente (precede la data di inizio).");

    const arrayOps = tec.split(';').map(s=>s.trim()).filter(Boolean);
    let conflitto = null;
    for (let op of arrayOps) {
        const sovrappone = missioni.some(m => { const mOps = m.tecnico.split(';').map(s=>s.trim()).filter(Boolean); return mOps.includes(op) && ini <= m.fine && fine >= m.inizio; });
        if (sovrappone) { conflitto = op; break; }
    }
    if (conflitto) return alert(`Impossibile assegnare la missione: il tecnico ${conflitto} ha già una trasferta in queste date.`);
    
    let lat=0, lon=0;
    let lCache = luoghi.find(l => String(l.ID_Luogo).trim().toLowerCase() === dest.toLowerCase());
    if(lCache) { lat = lCache.lat; lon = lCache.lon; } else if (selectedGeo) { lat = selectedGeo.lat; lon = selectedGeo.lon; luoghi.push({ ID_Luogo: dest, lat, lon }); }
    
    const prodottoNome = document.getElementById('input-prodotto').value.trim();
    const prodottoPn = document.getElementById('input-pn').value.trim();
    if (prodottoPn && !prodotti.some(p => String(p.PN).trim().toLowerCase() === prodottoPn.toLowerCase())) prodotti.push({ PN: prodottoPn, NomeProdotto: prodottoNome || "Prodotto Auto-inserito" });

    missioni.push({
        id: calcolaProssimoId(missioni), tecnico: tec, destinazione: dest, inizio: ini, fine: fine, lat, lon, 
        scopo: document.getElementById('input-scopo').value, piattaforma: document.getElementById('input-piattaforma').value,
        prodottoNome, prodottoId: prodottoPn, serialNumber: document.getElementById('input-serial').value, 
        allegatiLocali: document.getElementById('input-allegati').value, allegatiAggiuntivi: document.getElementById('input-allegati-agg').value
    });
    
    await syncData();
	mostraNotificaConferma("Trasferta assegnata con successo!");
    e.target.reset(); document.getElementById('input-tecnico').value=''; selectedGeo=null;
    document.querySelectorAll('.tecnico-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('custom-select-value').innerText = "Seleziona...";
    setupAutocomplete(); inizializzaUIPlanner(); switchTab('timeline');
}

function toggleDropdown(e) { if(e)e.stopPropagation(); document.getElementById('custom-select-options').classList.toggle('hidden'); }
function updateSelectedTecnici() {
  const c = document.querySelectorAll('.tecnico-checkbox:checked');
  const sel = Array.from(c).map(x=>x.value);
  document.getElementById('input-tecnico').value = sel.join('; ');
  document.getElementById('custom-select-value').innerHTML = sel.length ? `<b class="text-slate-900">${sel.join(', ')}</b>` : "Seleziona...";
  aggiornaMiniTimeline();
}

function filtraTecnici(inputId, itemClass) {
    const q = document.getElementById(inputId).value.toLowerCase();
    document.querySelectorAll(itemClass).forEach(el => {
        el.style.display = el.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
}

function popolaSelectTecnici() {
  document.getElementById('custom-select-options').innerHTML = 
    `<div class="p-2 sticky top-0 bg-white border-b border-slate-200 z-10"><input type="text" id="search-tecnico" onkeyup="filtraTecnici('search-tecnico', '.tecnico-item')" placeholder="Filtra operatore..." class="input-modern py-1 text-xs w-full" onclick="event.stopPropagation()"></div>` +
    tecnici.map(t => `<label class="tecnico-item flex items-center gap-2 p-2 hover:bg-slate-100 cursor-pointer border-b border-slate-200" onclick="event.stopPropagation()"><input type="checkbox" value="${t.nome || t}" class="tecnico-checkbox w-5 h-5 accent-blue-600 border-2 border-black" onchange="updateSelectedTecnici()"><span class="text-sm font-bold">${t.nome || t} <span class="text-[10px] text-slate-500 font-normal">(${t.funzione || ''})</span></span></label>`).join('');
  
  const modContainer = document.getElementById('mod-tecnici-list');
  if (modContainer) modContainer.innerHTML = 
    `<div class="mb-2"><input type="text" id="search-mod-tecnico" onkeyup="filtraTecnici('search-mod-tecnico', '.mod-tecnico-item')" placeholder="Filtra operatore..." class="input-modern py-1 text-xs w-full"></div>` +
    tecnici.map(t => `<label class="mod-tecnico-item flex items-center gap-2 p-2 hover:bg-slate-200 cursor-pointer rounded border border-transparent hover:border-slate-300"><input type="checkbox" value="${t.nome || t}" class="mod-tecnico-checkbox w-5 h-5 accent-blue-600 border-2 border-black"><div class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold border-2 border-black" style="background-color: ${getColorForTecnico(t.nome || t)}">${getInitials(t.nome || t)}</div><span class="font-extrabold text-slate-900">${t.nome || t} <span class="text-[10px] text-slate-500 font-normal">(${t.funzione || ''})</span></span></label>`).join('');
}

function renderListaTeam() { 
    const lista = document.getElementById('lista-team');
    if (tecnici.length === 0) { lista.innerHTML = '<tr><td colspan="4" class="py-4 text-slate-400 font-bold text-center">Nessun tecnico presente.</td></tr>'; return; }
    lista.innerHTML = tecnici.map((t, idx) => `
    <tr class="hover:bg-slate-50 transition-colors group">
        <td class="p-3 border-r border-slate-300">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-extrabold border-2 border-black shadow-[0_2px_0_0_#000]" style="background-color: ${getColorForTecnico(t.nome || t)}">${getInitials(t.nome || t)}</div>
                <span class="font-extrabold text-slate-900">${t.nome || t}</span>
            </div>
        </td>
        <td class="p-3 border-r border-slate-300 font-bold text-slate-700">${t.funzione || '-'}</td>
        <td class="p-3 border-r border-slate-300 font-bold text-slate-700">${t.competenza || '-'}</td>
        <td class="p-3 text-center">
            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex justify-center gap-2">
                <button onclick="modificaTecnico(${idx})" class="px-3 py-1.5 bg-slate-100 border-2 border-black rounded-lg text-xs font-bold hover:bg-slate-200">Modifica</button>
                <button onclick="rimuoviTecnico(${idx})" class="px-3 py-1.5 bg-red-100 border-2 border-black rounded-lg text-xs font-bold text-red-900 hover:bg-red-200">Rimuovi</button>
            </div>
        </td>
    </tr>`).join('');
}

async function aggiungiTecnico() { 
    if(isReadOnly) return alert("Modalità Sola Lettura."); 
    const n = document.getElementById('nuovo-tecnico-nome').value.trim(); 
    const f = document.getElementById('nuovo-tecnico-funzione').value.trim() || 'Tecnico';
    const c = document.getElementById('nuovo-tecnico-competenza').value;
    if(n && !tecnici.some(x => x.nome === n)) { tecnici.push({nome: n, funzione: f, competenza: c}); await syncData(); document.getElementById('nuovo-tecnico-nome').value=''; document.getElementById('nuovo-tecnico-funzione').value=''; inizializzaUIPlanner(); } 
}

async function modificaTecnico(idx) { 
    if(isReadOnly) return alert("Modalità Sola Lettura."); 
    const oldT = tecnici[idx]; 
    const vecchioNome = oldT.nome || oldT;
    const nuovoNome = prompt("Rinomina anagrafica:", vecchioNome); 
    if (nuovoNome === null) return;
    const nuovaFunzione = prompt("Modifica Ruolo/Funzione:", oldT.funzione || 'Tecnico'); 
    if (nuovaFunzione === null) return;
    const nuovaComp = prompt("Modifica Competenza (Elettronica, Meccanica, Sistemistica):", oldT.competenza || 'Non specificata');
    if (nuovaComp === null) return;

    const nomeFinale = nuovoNome.trim() || vecchioNome;
    if (nomeFinale !== vecchioNome && tecnici.some(x => (x.nome || x) === nomeFinale)) return alert("Nominativo esistente!"); 
    
    tecnici[idx] = {nome: nomeFinale, funzione: nuovaFunzione.trim(), competenza: nuovaComp.trim()}; 
    if (nomeFinale !== vecchioNome) {
        missioni.forEach(m => { let ops = String(m.tecnico).split(';').map(s=>s.trim()); if (ops.includes(vecchioNome)) { ops[ops.indexOf(vecchioNome)] = nomeFinale; m.tecnico = ops.join('; '); }}); 
    }
    await syncData(); inizializzaUIPlanner(); 
}

async function rimuoviTecnico(idx) { 
    if(isReadOnly) return alert("Modalità Sola Lettura."); 
    const nome = tecnici[idx].nome || tecnici[idx];
    if (confirm(`Rimuovere ${nome}?`)) { tecnici.splice(idx, 1); await syncData(); inizializzaUIPlanner(); } 
}

function getStatoMissione(inizioStr, fineStr) {
    const oggi = new Date().toISOString().split('T')[0];
    if (fineStr < oggi) return `<span class="px-2 py-1 bg-slate-200 text-slate-900 rounded-md text-[10px] uppercase font-extrabold border-2 border-black">Conclusa</span>`;
    if (inizioStr > oggi) return `<span class="px-2 py-1 bg-blue-100 text-blue-900 rounded-md text-[10px] uppercase font-extrabold border-2 border-black">Futura</span>`;
    return `<span class="px-2 py-1 bg-emerald-300 text-emerald-900 border-2 border-black rounded-md text-[10px] uppercase font-extrabold flex items-center gap-1.5 w-max"><span class="w-2 h-2 bg-emerald-600 rounded-full animate-pulse border border-black"></span>In Corso</span>`;
}

function renderTabella() {
    const corpo = document.getElementById('tabella-corpo');
    if (missioni.length === 0) { corpo.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 font-bold">Nessun dato registrato.</td></tr>'; return; }
    
    let arr = [...missioni];
    const oggi = new Date().toISOString().split('T')[0];
    arr.sort((a,b) => {
        let valA = a[sortColPlanner] || ''; let valB = b[sortColPlanner] || '';
        if(sortColPlanner === 'stato') { valA = a.fine < oggi ? 0 : (a.inizio > oggi ? 2 : 1); valB = b.fine < oggi ? 0 : (b.inizio > oggi ? 2 : 1); }
        if (valA < valB) return sortDescPlanner ? 1 : -1; if (valA > valB) return sortDescPlanner ? -1 : 1; return 0;
    });

    corpo.innerHTML = arr.map(m=> {
        const ops = m.tecnico.split(';').map(s=>s.trim()).filter(Boolean);
        const badges = ops.map(op => `<div class="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold border-2 border-black shadow-sm" style="background-color: ${getColorForTecnico(op)}" title="${op}">${getInitials(op)}</div>`).join('');
        const searchStr = `${m.tecnico} ${m.destinazione} ${m.scopo} ${m.piattaforma || ''} ${m.prodottoNome || ''} ${m.prodottoId || ''} ${m.serialNumber || ''}`.toLowerCase().replace(/"/g, '&quot;');
        return `<tr ondblclick="apriDettaglioMissione(${m.id})" class="planner-row hover:bg-blue-50 group transition-colors cursor-pointer" data-search="${searchStr}"><td class="p-4 pl-6 border-r border-slate-300"><div class="flex items-center gap-1.5 mb-1">${badges}</div><div class="font-bold text-slate-900 text-xs">${m.tecnico.replace(/;/g, ', ')}</div></td><td class="p-4 border-r border-slate-300">${getStatoMissione(m.inizio, m.fine)}</td><td class="p-4 border-r border-slate-300"><b class="text-slate-900">${m.destinazione}</b> <span class="text-[11px] font-bold text-slate-600 bg-slate-200 px-1 rounded ml-1 border border-slate-300">${m.piattaforma || 'N/D'}</span><br><span class="text-xs font-medium text-slate-800">${m.scopo}</span></td><td class="p-4 border-r border-slate-300 text-xs font-extrabold text-slate-900">${new Date(m.inizio).toLocaleDateString('it-IT')}<br><span class="text-slate-600 font-bold">a ${new Date(m.fine).toLocaleDateString('it-IT')}</span></td><td class="p-4 pr-6 text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"><button onclick="apriModificaMissione(${m.id})" class="px-4 py-2 bg-slate-100 border-2 border-black rounded-lg text-xs font-bold mr-2">Edit</button><button onclick="eliminaMissione(${m.id})" class="px-4 py-2 bg-red-100 border-2 border-black rounded-lg text-xs font-bold text-red-900">Del</button></td></tr>`;
    }).join('');
}

function apriDettaglioMissione(id) {
    const m = missioni.find(x => x.id === id); if (!m) return;
    let probsMissione = problematiche.filter(p => p.id_missione === m.id);
    let probHTML = probsMissione.length === 0 ? `<p class="text-sm font-bold text-slate-500">Nessun guasto registrato.</p>` :
        probsMissione.map(p => {
            const codObj = codiciProblematica.find(c => String(c.id) === String(p.codice)); const strCodice = codObj ? `${codObj.id}` : (p.codice || 'N/D');
            return `<div class="bg-rose-50 border-2 border-rose-300 p-3 rounded-xl mb-3 shadow-inner"><div class="flex justify-between items-center mb-1"><span class="text-xs font-extrabold text-rose-900">${p.data} - Codice: ${strCodice}</span><button onclick="document.getElementById('modal-dettaglio-missione').classList.add('hidden'); apriDettaglioProblema(${p.id});" class="text-[10px] font-bold bg-white border-2 border-black px-2 py-1 rounded hover:bg-slate-100 transition-colors">Vedi Dettaglio Guasto</button></div><p class="text-sm font-bold text-slate-900">${p.desc}</p>${p.sintomi ? `<p class="text-xs text-slate-700 mt-1">Sintomo: ${p.sintomi}</p>` : ''}</div>`;
        }).join('');

    const isFutura = m.inizio > new Date().toISOString().split('T')[0];
    let btnSegnala = isFutura ? `<button disabled class="px-4 py-2 bg-slate-200 text-slate-400 font-extrabold text-xs rounded-xl border-2 border-slate-300 cursor-not-allowed">Trasferta Futura</button>` : `<button onclick="apriSegnalaProblemaDaMissione(${m.id})" class="px-4 py-2 bg-rose-600 text-white font-extrabold text-xs rounded-xl border-2 border-black shadow-[0_3px_0_0_#000]">+ Segnala Problema</button>`;

    document.getElementById('dettaglio-missione-content').innerHTML = `
        <div class="mb-5 pb-5 border-b-2 border-black"><h3 class="text-3xl font-extrabold text-slate-900 mb-1">Missione: ${m.destinazione}</h3><p class="text-sm font-bold text-slate-600 bg-slate-200 inline-block px-2 py-1 rounded-md border border-slate-300">ID: ${m.id} | Dal ${new Date(m.inizio).toLocaleDateString('it-IT')} al ${new Date(m.fine).toLocaleDateString('it-IT')}</p></div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
            <div><span class="text-[10px] font-extrabold text-slate-500 uppercase">Team</span><br><b class="text-base text-slate-900">${m.tecnico.replace(/;/g, '<br>')}</b></div>
            <div><span class="text-[10px] font-extrabold text-slate-500 uppercase">Scopo</span><br><span class="text-sm font-bold text-slate-800">${m.scopo || 'N/D'}</span></div>
            <div><span class="text-[10px] font-extrabold text-slate-500 uppercase">Piattaforma</span><br><span class="text-sm font-extrabold text-slate-800">${m.piattaforma || 'N/D'}</span></div>
            <div class="bg-slate-100 p-2 rounded border-2 border-black"><span class="text-[10px] font-extrabold text-slate-600 uppercase">Prodotto</span><br><span class="text-sm font-extrabold text-slate-900">${m.prodottoNome || 'N/D'}</span></div>
            <div class="bg-slate-100 p-2 rounded border-2 border-black"><span class="text-[10px] font-extrabold text-slate-600 uppercase">PN</span><br><span class="text-sm font-extrabold text-slate-900">${m.prodottoId || 'N/D'}</span></div>
            <div class="bg-slate-100 p-2 rounded border-2 border-black"><span class="text-[10px] font-extrabold text-slate-600 uppercase">SN</span><br><span class="text-sm font-extrabold text-slate-900 font-mono">${m.serialNumber || 'N/D'}</span></div>
            <div class="col-span-2 md:col-span-3"><span class="text-[10px] font-extrabold text-slate-500 uppercase">Allegati</span><br><span class="text-[11px] font-bold text-blue-700 break-all">${m.allegatiLocali || ''}<br>${m.allegatiAggiuntivi || ''}</span></div>
        </div>
        <div class="bg-slate-100 p-6 rounded-2xl border-2 border-black shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]"><div class="flex justify-between items-center mb-4 border-b-2 border-slate-300 pb-3"><h4 class="text-lg font-extrabold text-slate-900">Guasti / Problematiche</h4>${btnSegnala}</div><div class="max-h-64 overflow-y-auto pr-2">${probHTML}</div></div>
    `;
    document.getElementById('modal-dettaglio-missione').classList.remove('hidden');
}

function apriModificaMissione(id) {
  if(window.event) window.event.stopPropagation();
  if(isReadOnly) return alert("Modalità Sola Lettura: impossibile modificare i dati. Salva il file come SQLite per abilitare la scrittura.");
  const m = missioni.find(x => x.id === id); if (!m) return;
  document.getElementById('mod-id').value = m.id;
  const arrayOps = m.tecnico.split(';').map(s=>s.trim());
  document.querySelectorAll('.mod-tecnico-checkbox').forEach(cb => cb.checked = arrayOps.includes(cb.value));
  document.getElementById('mod-destinazione').value = m.destinazione; modSelectedGeo = { lat: m.lat, lon: m.lon, name: m.destinazione };
  document.getElementById('mod-scopo').value = m.scopo; document.getElementById('mod-inizio').value = m.inizio; document.getElementById('mod-fine').value = m.fine;
  document.getElementById('mod-piattaforma').value = m.piattaforma || ''; document.getElementById('mod-prodotto').value = m.prodottoNome || '';
  document.getElementById('mod-pn').value = m.prodottoId || ''; document.getElementById('mod-serial').value = m.serialNumber || '';
  document.getElementById('mod-allegati').value = m.allegatiLocali || ''; document.getElementById('mod-allegati-agg').value = m.allegatiAggiuntivi || '';
  document.getElementById('mod-alert').classList.add('hidden'); document.getElementById('modal-modifica-missione').classList.remove('hidden');
}
function chiudiModale() { document.getElementById('modal-modifica-missione').classList.add('hidden'); }

async function salvaModificaMissione(e) {
  e.preventDefault(); if(isReadOnly) return alert("Sola Lettura");
  const id = parseFloat(document.getElementById('mod-id').value);
  const checkedBoxes = Array.from(document.querySelectorAll('.mod-tecnico-checkbox:checked')).map(cb => cb.value);
  const alertBox = document.getElementById('mod-alert');
  if(checkedBoxes.length === 0) { alertBox.innerText = "Seleziona almeno un operatore."; alertBox.classList.remove('hidden'); return; }
  const tecnico = checkedBoxes.join('; '); const destinazione = document.getElementById('mod-destinazione').value.trim();
  const inizio = document.getElementById('mod-inizio').value; const fine = document.getElementById('mod-fine').value;
  if (fine < inizio) { alertBox.innerText = "Data fine non coerente."; alertBox.classList.remove('hidden'); return; }

  let conflitto = null;
  for (let op of checkedBoxes) {
      const sovrappone = missioni.some(m => { if (m.id === id) return false; const mOps = m.tecnico.split(';').map(s=>s.trim()).filter(Boolean); return mOps.includes(op) && inizio <= m.fine && fine >= m.inizio; });
      if (sovrappone) { conflitto = op; break; }
  }
  if (conflitto) { alertBox.innerText = `Impossibile salvare: il tecnico ${conflitto} è già impegnato in queste date.`; alertBox.classList.remove('hidden'); return; }

  let geo = modSelectedGeo;
  if (!geo || String(geo.name).trim().toLowerCase() !== destinazione.toLowerCase()) { let lCache = luoghi.find(l => String(l.ID_Luogo).trim().toLowerCase() === destinazione.toLowerCase()); if(lCache) geo = {lat: lCache.lat, lon: lCache.lon, name: destinazione}; }

  const prodottoNome = document.getElementById('mod-prodotto').value.trim(); const prodottoPn = document.getElementById('mod-pn').value.trim();
  if (prodottoPn && !prodotti.some(p => String(p.PN).trim().toLowerCase() === prodottoPn.toLowerCase())) prodotti.push({ PN: prodottoPn, NomeProdotto: prodottoNome || "Prodotto Auto-inserito" });
  const piattaforma = document.getElementById('mod-piattaforma').value; if (piattaforma && !piattaforme.some(p => String(p.label).trim().toLowerCase() === piattaforma.trim().toLowerCase())) piattaforme.push({ label: piattaforma });
  const scopo = document.getElementById('mod-scopo').value; if (scopo && !scopi.some(s => String(s.label).trim().toLowerCase() === scopo.trim().toLowerCase())) scopi.push({ label: scopo });

  const mIndex = missioni.findIndex(x => x.id === id);
  if (mIndex > -1) { missioni[mIndex] = { id, tecnico, destinazione, inizio, fine, scopo, piattaforma, prodottoNome, prodottoId: prodottoPn, serialNumber: document.getElementById('mod-serial').value, allegatiLocali: document.getElementById('mod-allegati').value, allegatiAggiuntivi: document.getElementById('mod-allegati-agg').value, lat: geo ? geo.lat : missioni[mIndex].lat, lon: geo ? geo.lon : missioni[mIndex].lon }; }
  
  await syncData(); chiudiModale(); setupAutocomplete(); inizializzaUIPlanner();
}

async function eliminaMissione(id) { if(window.event) window.event.stopPropagation(); if(isReadOnly) return alert("Modalità Sola Lettura: impossibile salvare modifiche. Esporta il DB in SQLite per abilitare la scrittura."); if (confirm("Procedere con l'eliminazione definitiva del record?")) { missioni = missioni.filter(m => m.id !== id); await syncData(); inizializzaUIPlanner(); } }

function bindAutocomplete(inputId, listId, onSelectCallback) {
  const input = document.getElementById(inputId); const list = document.getElementById(listId); let debounceTimeout;
  input.addEventListener('input', function() {
    const query = this.value.trim(); onSelectCallback(null); clearTimeout(debounceTimeout);
    if (query.length < 2) { list.classList.add('hidden'); return; }
    debounceTimeout = setTimeout(async () => {
      const match = luoghi.filter(l => String(l.ID_Luogo).toLowerCase().includes(query.toLowerCase()));
      if(match.length > 0) { list.innerHTML = match.map(m=>`<div onmousedown="selGeo('${inputId}','${listId}', '${m.ID_Luogo.replace(/'/g,"\\'")}',${m.lat},${m.lon})"><b>${m.ID_Luogo}</b> (Archivio Interno)</div>`).join(''); list.classList.remove('hidden'); } 
      else { try { const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3`); const data = await res.json(); if (data.length === 0) { list.classList.add('hidden'); return; } list.innerHTML = data.map(f=>`<div onmousedown="selGeo('${inputId}','${listId}','${f.display_name.split(',')[0].replace(/'/g,"\\'")}',${f.lat},${f.lon})"><b>${f.display_name.split(',')[0]}</b><br><span class="text-[10px] text-slate-500">${f.display_name}</span></div>`).join(''); list.classList.remove('hidden'); } catch (e) { list.classList.add('hidden'); } }
    }, 400);
  });
  input.addEventListener('blur', () => { setTimeout(() => list.classList.add('hidden'), 200); });
}

function selGeo(inId, lsId, nome, lat, lon) { document.getElementById(inId).value = nome; if(inId === 'input-destinazione') selectedGeo = {lat, lon, name: nome}; if(inId === 'mod-destinazione') modSelectedGeo = {lat, lon, name: nome}; document.getElementById(lsId).classList.add('hidden'); }

function bindAutocompleteLocal(inputId, listId, array, propKey, propDesc = null, idNameTarget = null) {
    const input = document.getElementById(inputId); const list = document.getElementById(listId); if (!input || !list) return;
    input.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase(); if (query.length < 1) { list.classList.add('hidden'); return; }
        const match = array.filter(item => String(item[propKey]).toLowerCase().includes(query) || (propDesc && String(item[propDesc]).toLowerCase().includes(query)));
        if(match.length > 0) { list.innerHTML = match.map(m => { const descHtml = propDesc ? `<span class="text-xs text-slate-500 font-bold">- ${m[propDesc]}</span>` : ''; return `<div onmousedown="document.getElementById('${inputId}').value='${String(m[propKey]).replace(/'/g,"\\'")}'; if('${idNameTarget}') { document.getElementById('${idNameTarget}').value='${String(m[propDesc]).replace(/'/g,"\\'")}'; } document.getElementById('${listId}').classList.add('hidden');"><b>${m[propKey]}</b> ${descHtml}</div>`; }).join(''); list.classList.remove('hidden'); } else { list.classList.add('hidden'); }
    });
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 200));
}

function setupAutocomplete() {
  bindAutocomplete('input-destinazione', 'autocomplete-list', (geo) => selectedGeo = geo); bindAutocomplete('mod-destinazione', 'mod-autocomplete-list', (geo) => modSelectedGeo = geo);
  bindAutocompleteLocal('input-pn', 'autocomplete-pn-list', prodotti, 'PN', 'NomeProdotto', 'input-prodotto'); bindAutocompleteLocal('mod-pn', 'mod-autocomplete-pn-list', prodotti, 'PN', 'NomeProdotto', 'mod-prodotto');
  bindAutocompleteLocal('input-piattaforma', 'autocomplete-piattaforma-list', piattaforme, 'label'); bindAutocompleteLocal('mod-piattaforma', 'mod-autocomplete-piattaforma-list', piattaforme, 'label');
  bindAutocompleteLocal('input-scopo', 'autocomplete-scopo-list', scopi, 'label'); bindAutocompleteLocal('mod-scopo', 'mod-autocomplete-scopo-list', scopi, 'label');
}

// TIMELINES E MAPPA TRASFERTE
function creaPreviewHTML(m, tecnicoCorrente) {
  const target = tecnicoCorrente || m.tecnico; const initials = getInitials(target);
  return `<div class="font-sans text-left min-w-[240px]"><div class="flex items-center gap-2 mb-3 pb-3 border-b-2 border-slate-300"><div class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold border-2 border-black shadow-[0_2px_0_0_#000]" style="background-color: ${getColorForTecnico(target)}">${initials}</div><span class="font-extrabold text-slate-900 text-base">${target}</span></div><div class="font-extrabold text-slate-900 text-sm mb-1">📍 ${m.destinazione}</div><div class="text-xs font-bold text-slate-700 mb-3 leading-snug">🎯 ${m.scopo || 'Nessuno scopo indicato'}</div><div class="text-[10px] font-extrabold text-slate-600 mb-2 bg-slate-100 p-1.5 rounded border border-slate-300">📅 Dal: <span class="text-slate-900">${new Date(m.inizio).toLocaleDateString('it-IT')}</span> <br>⏳ Al: <span class="text-slate-900">${new Date(m.fine).toLocaleDateString('it-IT')}</span></div>${m.piattaforma ? `<div class="text-[10px] font-bold text-slate-600 mt-1">🛳️ Piattaforma: <b class="text-slate-900">${m.piattaforma}</b></div>` : ''}${m.prodottoNome ? `<div class="text-[10px] font-bold text-slate-600 mt-1">📦 Prodotto: <b class="text-slate-900">${m.prodottoNome}</b></div>` : ''}${m.prodottoId ? `<div class="text-[10px] font-bold text-slate-600 mt-1">🏷️ Part Number (PN): <b class="text-slate-900">${m.prodottoId}</b></div>` : ''}${m.serialNumber ? `<div class="text-[10px] font-bold text-slate-600 mt-1">🔢 Serial: <b class="text-slate-900 font-mono">${m.serialNumber}</b></div>` : ''}</div>`;
}

function formatTimelineItem(m, opTarget) { 
    let dStart = m.inizio;
    let dEnd = m.fine;
    if (!dStart || isNaN(new Date(dStart).getTime())) { dStart = new Date().toISOString().split('T')[0]; }
    if (!dEnd || isNaN(new Date(dEnd).getTime())) { dEnd = dStart; }
    let endDateObj = new Date(dEnd);
    endDateObj.setDate(endDateObj.getDate() + 1); 
    
    return { 
        id: m.id + "_" + opTarget, 
        group: opTarget, 
        content: `<span class="truncate block text-[11px] leading-tight">${m.destinazione || 'Missione'}</span>`, 
        title: creaPreviewHTML(m, opTarget), 
        start: dStart, 
        end: endDateObj.toISOString().split('T')[0], 
        style: `background-color:${getColorForTecnico(opTarget)}; color:white; border:1px solid #000; border-radius:4px; font-weight:700; padding:2px 4px;` 
    }; 
}

function initTimeline() {
    const container = document.getElementById('timeline');
    if (!container) return;
    
    if (timeline) {
        try { timeline.destroy(); } catch(e) {}
        timeline = null;
    }

	const options = {
        orientation: 'top',
        locale: 'it',
        height: '100%',               // Fa riempire l'intero contenitore definito nell'HTML
        verticalScroll: true,         // Abilita lo scrollbar interno per i gruppi (tecnici)
        zoomKey: 'ctrlKey',           // Zoom con rotellina + Ctrl
        stack: false,                 // Sovrappone elementi nello stesso gruppo
        margin: { item: { horizontal: 2, vertical: 4 }, axis: 5 },
        groupOrder: 'content'         // Ordina alfabeticamente i tecnici
    };

    timeline = new vis.Timeline(container, new vis.DataSet([]), new vis.DataSet([]), options);
    
    timeline.on('doubleClick', function (props) {
        if (props.item) {
            const id_miss = parseInt(String(props.item).split('_')[0], 10);
            if (!isNaN(id_miss)) apriDettaglioMissione(id_miss);
        }
    });

    aggiornaTimeline();
}
	
function initMiniTimeline() { miniTimeline = new vis.Timeline(document.getElementById('mini-timeline'), [], [], {orientation:'top', locale:'it', stack: true}); const o=new Date(); miniTimeline.setWindow(new Date(o.getTime()-15*86400000), new Date(o.getTime()+15*86400000)); }

// Popola i menu a tendina delle funzioni e delle competenze presenti in anagrafica
function popolaFiltriTimeline() {
    const fSelect = document.getElementById('timeline-filter-funzione');
    const cSelect = document.getElementById('timeline-filter-competenza');
    if (!fSelect || !cSelect) return;

    const curF = fSelect.value;
    const curC = cSelect.value;

    const funzioniUniche = [...new Set(tecnici.map(t => t.funzione).filter(Boolean))].sort();
    const competenzeUniche = [...new Set(tecnici.map(t => t.competenza).filter(Boolean))].sort();

    fSelect.innerHTML = '<option value="">Tutte le funzioni</option>' + 
        funzioniUniche.map(f => `<option value="${f}">${f}</option>`).join('');
    cSelect.innerHTML = '<option value="">Tutte le competenze</option>' + 
        competenzeUniche.map(c => `<option value="${c}">${c}</option>`).join('');

    fSelect.value = curF;
    cSelect.value = curC;
}

function resetFiltriTimeline() {
    const nInput = document.getElementById('timeline-filter-nome');
    const fSelect = document.getElementById('timeline-filter-funzione');
    const cSelect = document.getElementById('timeline-filter-competenza');
    if (nInput) nInput.value = '';
    if (fSelect) fSelect.value = '';
    if (cSelect) cSelect.value = '';
    aggiornaTimeline();
}

function aggiornaTimeline() {
    if (!timeline) return;

    popolaFiltriTimeline();

    // Lettura dei valori di filtro
    const filtroNome = (document.getElementById('timeline-filter-nome')?.value || '').trim().toLowerCase();
    const filtroFunz = (document.getElementById('timeline-filter-funzione')?.value || '').trim().toLowerCase();
    const filtroComp = (document.getElementById('timeline-filter-competenza')?.value || '').trim().toLowerCase();

    // Mappa veloce per cercare attributi del tecnico
    const techMap = new Map();
    tecnici.forEach(t => {
        const nome = typeof t === 'string' ? t : (t.nome || '');
        const funz = typeof t === 'string' ? '' : (t.funzione || '');
        const comp = typeof t === 'string' ? '' : (t.competenza || '');
        if (nome) techMap.set(nome.trim().toLowerCase(), { nome: nome.trim(), funzione: funz, competenza: comp });
    });

    // Raccoglie tutti i tecnici che soddisfano i criteri di filtro
    const candidati = new Set();
    
    // Prima include chi è registrato in anagrafica tecnici
    techMap.forEach(info => {
        const matchNome = !filtroNome || info.nome.toLowerCase().includes(filtroNome);
        const matchFunz = !filtroFunz || info.funzione.toLowerCase() === filtroFunz;
        const matchComp = !filtroComp || info.competenza.toLowerCase() === filtroComp;

        if (matchNome && matchFunz && matchComp) {
            candidati.add(info.nome);
        }
    });

    // Controlla anche se ci sono tecnici citati nelle trasferte ma assenti da anagrafica (se non si filtrano funzione/competenza)
    if (!filtroFunz && !filtroComp) {
        missioni.forEach(m => {
            String(m.tecnico || '').split(';').map(s => s.trim()).filter(Boolean).forEach(op => {
                if (!filtroNome || op.toLowerCase().includes(filtroNome)) {
                    candidati.add(op);
                }
            });
        });
    }

    const itemsRaw = [];

    // Genera gli elementi timeline solo per i tecnici ammessi dai filtri
    missioni.forEach(m => {
        if (!m.inizio) return;
        
        let dStart = new Date(m.inizio);
        if (isNaN(dStart.getTime())) return;

        let dEnd = m.fine ? new Date(m.fine) : new Date(m.inizio);
        if (isNaN(dEnd.getTime())) dEnd = new Date(dStart);
        dEnd.setDate(dEnd.getDate() + 1);

        const startStr = dStart.toISOString().split('T')[0];
        const endStr = dEnd.toISOString().split('T')[0];

        const ops = String(m.tecnico || '').split(';').map(s => s.trim()).filter(Boolean);
        ops.forEach(op => {
            if (candidati.has(op)) {
                itemsRaw.push({
                    id: `${m.id}_${op}`,
                    group: op,
                    content: `<b class="px-1 text-xs text-white">${m.destinazione || 'Missione'}</b>`,
                    title: creaPreviewHTML(m, op),
                    start: startStr,
                    end: endStr,
                    style: `background-color:${getColorForTecnico(op)}; color:white; border:1px solid #000; border-radius:6px; font-weight:700; font-size:11px;`
                });
            }
        });
    });

	const groupsRaw = Array.from(candidati).sort().map(t => ({
        id: t,
        content: `<div class="font-bold text-xs text-slate-900 truncate px-1" title="${t}">${t}</div>`
    }));

    timeline.setData({
        groups: new vis.DataSet(groupsRaw),
        items: new vis.DataSet(itemsRaw)
    });
}

function aggiornaMiniTimeline() { if(!miniTimeline) return; const inputT = document.getElementById('input-tecnico'); if(!inputT) return; const sel = inputT.value.split(';').map(s=>s.trim()).filter(Boolean); if(!sel.length) { miniTimeline.setGroups([]); miniTimeline.setItems([]); return; } const groups = sel.map(t=>({id:t, content:`<span class="font-extrabold text-[10px] p-1 text-slate-800">${t}</span>`})); const items = []; missioni.forEach(m=>{ m.tecnico.split(';').map(s=>s.trim()).forEach(op=> {if(sel.includes(op)) items.push(formatTimelineItem(m, op));}); }); miniTimeline.setGroups(new vis.DataSet(groups)); miniTimeline.setItems(new vis.DataSet(items)); }
function timelineZoom(tipo) { if (!timeline) return; const n = new Date(); if (tipo === 'oggi') { timeline.setOptions({ timeAxis: { scale: 'day', step: 1 } }); timeline.moveTo(n); } else if (tipo === 'mese') { timeline.setOptions({ timeAxis: { scale: 'day', step: 1 } }); timeline.setWindow(new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)); } else if (tipo === 'trimestre') { timeline.setOptions({ timeAxis: { scale: 'week', step: 1 } }); timeline.setWindow(new Date(n.getFullYear(), Math.floor(n.getMonth()/3)*3, 1), new Date(n.getFullYear(), Math.floor(n.getMonth()/3)*3 + 3, 0)); } else if (tipo === 'anno') { timeline.setOptions({ timeAxis: { scale: 'month', step: 1 } }); timeline.setWindow(new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear(), 11, 31)); } }

// FUNZIONI MAPPE E GRAFICI
function initMap() { 
map = L.map('map', { minZoom: 2, maxZoom: 8 }).setView([30, 15], 3);
if (typeof WORLD_GEOJSON !== 'undefined') { L.geoJSON(WORLD_GEOJSON, { style: { fillColor: '#e2e8f0', weight: 1, opacity: 1, color: '#64748b', fillOpacity: 0.8 } }).addTo(map); document.getElementById('map').style.backgroundColor = '#cbd5e1'; } 
else { L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map); }
mapLayer = L.layerGroup().addTo(map); 
}
function initMapLuoghi() { 
if(mapLuoghi) return;
mapLuoghi = L.map('map-luoghi', { minZoom: 2, maxZoom: 8 }).setView([30, 15], 3);
if (typeof WORLD_GEOJSON !== 'undefined') { L.geoJSON(WORLD_GEOJSON, { style: { fillColor: '#e2e8f0', weight: 1, opacity: 1, color: '#64748b', fillOpacity: 0.8 } }).addTo(mapLuoghi); document.getElementById('map-luoghi').style.backgroundColor = '#cbd5e1'; } 
else { L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapLuoghi); }
mapLuoghiLayer = L.layerGroup().addTo(mapLuoghi); 
}

function impostaMappaOggi() { const dateInput = document.getElementById('map-date-picker'); if(dateInput) dateInput.value = new Date().toISOString().split('T')[0]; aggiornaMappa(); }
function aggiornaMappa() {
    if(!mapLayer) return; mapLayer.clearLayers(); const d = document.getElementById('map-date-picker').value; if(!d) return;
    const attivi = missioni.filter(m=>m.inizio<=d && m.fine>=d && m.lat!==0); const bounds = []; const tecniciInMappa = new Set(); const usate = {};
    attivi.forEach(m => { const ops = m.tecnico.split(';').map(s=>s.trim()).filter(Boolean); ops.forEach(op => { tecniciInMappa.add(op); let lat = m.lat, lon = m.lon; let cK = `${lat.toFixed(1)}_${lon.toFixed(1)}`; if(!usate[cK]) usate[cK]=0; let count=usate[cK]++; if(count>0) { const a=count*(Math.PI/4); const r=0.1*Math.ceil(count/4); lat+=Math.cos(a)*r; lon+=Math.sin(a)*r; } const mk = L.circleMarker([lat, lon], {radius:10, fillColor:getColorForTecnico(op), color:'#000', weight:3, fillOpacity:1}).bindTooltip(creaPreviewHTML(m, op), { direction: 'top', className: 'custom-tooltip', offset: [0, -10] }).addTo(mapLayer); mk.on('dblclick', function() { apriDettaglioMissione(m.id); }); bounds.push([lat, lon]); }); });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 7 });
    const leg = document.getElementById('map-legend-list'); if(leg) { if(tecniciInMappa.size===0) leg.innerHTML = '<li class="text-xs text-slate-500 font-bold italic">Nessun tecnico in trasferta.</li>'; else leg.innerHTML = Array.from(tecniciInMappa).sort().map(t=>`<li class="flex items-center gap-3 text-sm font-extrabold text-slate-900"><span class="w-4 h-4 rounded-full border-2 border-black shadow-[0_2px_0_0_#000] flex-shrink-0" style="background-color: ${getColorForTecnico(t)}"></span><span class="truncate">${t}</span></li>`).join(''); }
}

function renderStatisticheLuoghi() { 
    if (!document.getElementById('map-luoghi')) return;
    if (!mapLuoghi) initMapLuoghi();
    mapLuoghiLayer.clearLayers();
    
    const filtroPn = document.getElementById('filter-mappa-prodotto').value;
    const missFiltrate = filtroPn ? missioni.filter(m => m.prodottoId === filtroPn) : missioni;

    const conteggi = {};
    missFiltrate.forEach(m => {
        const l = m.destinazione;
        if(l && m.lat !== 0) { 
            if(!conteggi[l]) conteggi[l] = {count: 0, lat: m.lat, lon: m.lon};
            conteggi[l].count++;
        }
    });
    
    const bounds = [];
    Object.keys(conteggi).forEach(luogoNome => {
        const data = conteggi[luogoNome];
        const radius = Math.min(8 + (data.count * 3), 35);
        const mk = L.circleMarker([data.lat, data.lon], {radius: radius, fillColor: '#ea580c', color:'#000', weight:2, fillOpacity:0.8})
            .bindTooltip(`<div class="text-center"><b class="text-slate-900">${luogoNome}</b><br><span class="text-xs font-bold">Visite: ${data.count}</span></div>`, { direction: 'top', className: 'custom-tooltip', offset: [0, -10] })
            .addTo(mapLuoghiLayer);
        bounds.push([data.lat, data.lon]);
    });
    if (bounds.length > 0) mapLuoghi.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
    mapLuoghi.invalidateSize();
    
    const labels = Object.keys(conteggi).sort((a,b) => conteggi[b].count - conteggi[a].count);
    const chartData = labels.map(l => conteggi[l].count);
    const bgColors = labels.map((_, i) => COLORI[i % COLORI.length]);
    
    const ctx = document.getElementById('chart-luoghi').getContext('2d');
    if(chartLuoghi) chartLuoghi.destroy();
    
    chartLuoghi = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: chartData, backgroundColor: bgColors, borderColor: '#000', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: {font: {weight: 'bold', size: 10}, color: '#0f172a'} } } }
    });
}

// ==========================================
// LOGICA GESTIONE RITORNI DAL CAMPO E AI
// ==========================================

function getDescrizioneCodiceDalDB(codice) {
    if (!codice) return '';
    const codNormalizzato = String(codice).trim().toLowerCase();
    
    // Cerca nell'array globale (già popolato in estraiDatiDaSQL)
    const trovato = codiciProblematica.find(c => String(c.id).trim().toLowerCase() === codNormalizzato);
    if (trovato && trovato.desc) return trovato.desc;
    
    return '';
}

function renderTopOffenders() {
    const list = document.getElementById('top-offenders-list');
    if (!list) return;

    const conteggi = {};
    problematiche.forEach(p => {
        const cod = String(p.codice || 'N/D').trim().toUpperCase();
        if (cod && cod !== 'N/D') {
            conteggi[cod] = (conteggi[cod] || 0) + 1;
        }
    });

    const top = Object.entries(conteggi)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (top.length === 0) {
        list.innerHTML = '<li class="text-slate-400 italic">Nessun guasto registrato</li>';
        return;
    }

    list.innerHTML = top.map(([cod, count]) => {
        const desc = getDescrizioneCodiceDalDB(cod);
        return `
            <li class="flex justify-between items-start gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
                <div class="flex flex-col flex-grow leading-tight min-w-0">
                    <span class="font-mono font-extrabold text-rose-900 text-xs">${cod}</span>
                    <span class="text-[11px] font-semibold text-slate-700 leading-snug mt-0.5 ${!desc ? 'italic text-slate-400' : ''}">${desc || 'Descrizione N/D'}</span>
                </div>
                <span class="bg-rose-100 text-rose-900 border border-rose-300 font-extrabold text-xs px-2.5 py-1 rounded-md flex-shrink-0 shadow-sm">${count}</span>
            </li>`;
    }).join('');
}

function apriSegnalaProblemaDaMissione(id_miss) {
    const m = missioni.find(x => x.id === id_miss); if(!m) return;
    document.getElementById('modal-dettaglio-missione').classList.add('hidden'); document.getElementById('segnala-prob-missione-id').value = m.id; document.getElementById('segnala-prob-missione-label').innerText = `${m.destinazione} (${m.inizio}) - ${m.tecnico}`;
    document.getElementById('segnala-prob-pn').value = m.prodottoId || ''; document.getElementById('segnala-prob-nome-assieme').value = m.prodottoNome || '';
    document.getElementById('segnala-prob-codice').innerHTML = '<option value="">-- Seleziona Codice --</option>' + codiciProblematica.map(c=>`<option value="${c.id}">[${c.id}] ${c.desc}</option>`).join('');
    document.getElementById('modal-segnala-problema').classList.remove('hidden');
}

function filtraGuasti() { const query = document.getElementById('search-guasti').value.toLowerCase(); document.querySelectorAll('#tabella-problematiche tr.guasto-row').forEach(row => { row.style.display = row.getAttribute('data-search').includes(query) ? '' : 'none'; }); }

function getDescrizioneCodiceDalDB(codice) {
    if (!codice) return '';
    const codNorm = String(codice).trim().toLowerCase();
    
    // 1. Cerca nell'array estratto dalla tabella SQL
    const trovato = codiciProblematica.find(c => String(c.id || '').trim().toLowerCase() === codNorm);
    if (trovato && trovato.desc && trovato.desc.trim() !== '') {
        return trovato.desc;
    }

    // 2. Se vuoto o non agganciato da SQL, interroga direttamente la tabella SQL in memoria
    if (sqlDB) {
        try {
            const q = sqlDB.exec(`SELECT Descrizione FROM CodiciProblematica WHERE LOWER(TRIM(ID_CodiceProblematica)) = '${escapeSql(codNorm)}'`);
            if (q.length && q[0].values.length && q[0].values[0][0]) {
                return String(q[0].values[0][0]);
            }
        } catch(e) {}
    }
    return '';
}

function renderTabellaProblematiche() {
    const t = document.getElementById('tabella-problematiche');
    if(!problematiche.length) { t.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500 font-bold">Nessuna problematica registrata.</td></tr>'; return; }
    let arr = [...problematiche];
    arr.sort((a,b) => { let valA = a[sortColRitorni] || ''; let valB = b[sortColRitorni] || ''; if(sortColRitorni === 'stato') { valA = soluzioni.some(s => s.id_problema === a.id && (String(s.esito).trim().toLowerCase() === 'positivo' || String(s.esito).trim().toLowerCase() === 'risolto')) ? 1 : 0; valB = soluzioni.some(s => s.id_problema === b.id && (String(s.esito).trim().toLowerCase() === 'positivo' || String(s.esito).trim().toLowerCase() === 'risolto')) ? 1 : 0; } if (valA < valB) return sortDescRitorni ? 1 : -1; if (valA > valB) return sortDescRitorni ? -1 : 1; return 0; });

    t.innerHTML = arr.map(p => {
        const m = missioni.find(x => x.id === p.id_missione) || {destinazione: 'Sconosciuta', tecnico: 'N/D'}; const sol = soluzioni.filter(x => x.id_problema === p.id);
        const isRisolto = sol.some(x => String(x.esito).trim().toLowerCase() === 'positivo' || String(x.esito).trim().toLowerCase() === 'risolto');
        const statoHtml = isRisolto ? `<span class="px-2 py-1 bg-emerald-100 text-emerald-900 border-2 border-emerald-600 text-[10px] font-extrabold rounded">CHIUSO</span>` : `<span class="px-2 py-1 bg-rose-100 text-rose-900 border-2 border-rose-600 text-[10px] font-extrabold rounded">APERTO</span>`;

		const codId = String(p.codice || 'N/D').trim();
        const codDesc = getDescrizioneCodiceDalDB(codId);
        const strCodice = `
            <div class="flex flex-col">
                <span class="font-mono font-extrabold text-slate-900 text-xs">${codId}</span>
                ${codDesc ? `<span class="text-[11px] font-semibold text-slate-600 leading-tight mt-1">${codDesc}</span>` : ''}
            </div>`;

		const strAssieme = `<b class="text-slate-900">PN:</b> <span class="font-mono font-bold text-slate-800">${p.pn_assieme || 'N/D'}</span><br><span class="text-[10px] font-bold text-slate-600 mt-1 block">${p.nome_assieme || 'N/D'}</span>`;
        const strDesc = `<div class="mb-2"><span class="text-[10px] uppercase font-bold text-slate-400">Descrizione</span><br><b class="text-slate-900 text-xs">${p.desc || 'N/D'}</b></div><div><span class="text-[10px] uppercase font-bold text-slate-400">Sintomi</span><br><span class="text-xs font-bold text-slate-700">${p.sintomi || 'N/D'}</span></div>`;
        const searchStr = `${p.desc} ${p.sintomi} ${p.codice} ${p.pn_assieme} ${p.nome_assieme} ${m.destinazione} ${m.tecnico}`.toLowerCase().replace(/"/g, '&quot;');
        return `<tr ondblclick="apriDettaglioProblema(${p.id})" class="guasto-row hover:bg-blue-50 transition-colors cursor-pointer" data-search="${searchStr}"><td class="p-4 pl-6 align-top w-32 border-r border-slate-300"><span class="text-sm text-slate-900 font-extrabold">${p.data}</span></td><td class="p-4 text-xs align-top w-48 border-r border-slate-300"><b class="text-slate-900 text-sm">${m.destinazione}</b><br><span class="text-slate-700 font-bold">${m.tecnico.replace(/;/g, ', ')}</span></td><td class="p-4 text-xs align-top w-48 bg-slate-50 border-r border-slate-300">${strCodice}</td><td class="p-4 text-xs align-top w-48 border-r border-slate-300">${strAssieme}</td><td class="p-4 text-xs align-top border-r border-slate-300">${strDesc}</td><td class="p-4 pr-6 w-32 align-top text-center">${statoHtml}<br><span class="text-[10px] text-slate-600 font-extrabold mt-2 block">${sol.length} int.</span></td></tr>`;
    }).join('');
    renderTopOffenders();
}

function apriDettaglioProblema(id_prob) {
    const p = problematiche.find(x => x.id === id_prob); if(!p) return;
    const m = missioni.find(x => x.id === p.id_missione) || {destinazione: 'N/D', tecnico: 'N/D', inizio: ''}; const sols = soluzioni.filter(x => x.id_problema === p.id);
    
    let htmlSols = sols.length === 0 ? `<p class="text-slate-500 font-bold text-sm bg-slate-100 p-4 rounded-xl border-2 border-slate-300">Nessun intervento registrato. Aggiungine uno qui sotto.</p>` : sols.map(s => {
        const ok = (String(s.esito).trim().toLowerCase() === 'positivo' || String(s.esito).trim().toLowerCase() === 'risolto');
        return `<div class="border-l-8 ${ok ?'border-emerald-600 bg-emerald-50':'border-rose-600 bg-rose-50'} p-4 rounded-r-xl mb-3 border-y-2 border-r-2 border-black shadow-sm"><div class="flex justify-between items-center mb-2"><span class="text-sm font-extrabold text-slate-900">${s.data}</span><span class="text-[10px] font-extrabold ${ok ?'text-emerald-900 bg-emerald-200 border-emerald-600':'text-rose-900 bg-rose-200 border-rose-600'} uppercase border-2 px-2 py-0.5 rounded shadow-sm">${s.esito}</span></div><p class="text-sm font-bold text-slate-800">${s.azione}</p></div>`;
    }).join('');

    const codObj = codiciProblematica.find(c => String(c.id) === String(p.codice)); const strCodice = codObj ? `${codObj.id} - ${codObj.desc}` : (p.codice || 'N/D');

    document.getElementById('dettaglio-problema-content').innerHTML = `
        <div class="bg-slate-100 p-5 rounded-2xl border-2 border-black mb-6 shadow-inner"><div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 pb-4 border-b-2 border-slate-300"><div><span class="text-[10px] font-extrabold text-slate-600 uppercase">Data Segnalazione</span><br><span class="font-extrabold text-slate-900 text-base">${p.data}</span></div><div><span class="text-[10px] font-extrabold text-slate-600 uppercase">Codice Guasto</span><br><span class="font-extrabold text-slate-900 font-mono bg-white px-1 border border-slate-300 rounded inline-block mt-1">${strCodice}</span></div><div><span class="text-[10px] font-extrabold text-slate-600 uppercase">PN Assieme</span><br><span class="font-extrabold text-slate-900 font-mono">${p.pn_assieme || 'N/D'}</span></div><div><span class="text-[10px] font-extrabold text-slate-600 uppercase">Nome Assieme</span><br><span class="font-extrabold text-slate-900">${p.nome_assieme || 'N/D'}</span></div></div><div class="mb-4"><span class="text-[10px] font-extrabold text-slate-600 uppercase">Riferimento Missione</span><br><span class="text-sm font-extrabold text-slate-900 bg-white px-2 py-1 border border-slate-300 rounded inline-block mt-1">${m.destinazione} (${m.inizio}) - ${m.tecnico}</span></div><div class="bg-white p-3 rounded-xl border border-slate-300 mb-3"><span class="text-[10px] font-extrabold text-slate-500 uppercase">Descrizione Problema</span><br><p class="text-sm text-slate-900 font-bold mt-1">${p.desc || 'N/D'}</p></div><div class="bg-white p-3 rounded-xl border border-slate-300"><span class="text-[10px] font-extrabold text-slate-500 uppercase">Sintomi</span><br><p class="text-sm text-slate-900 font-bold mt-1">${p.sintomi || 'N/D'}</p></div></div>
        <h4 class="text-lg font-extrabold text-slate-900 mb-3 pb-1 border-b-2 border-black">Cronologia Interventi</h4><div class="max-h-60 overflow-y-auto pr-2 mb-2">${htmlSols}</div>
    `;
    document.getElementById('sol-problema').value = p.id;
    document.getElementById('modal-dettaglio-problema').classList.remove('hidden');
}

async function salvaProblematicaSingola(e) { e.preventDefault(); if(isReadOnly) return alert("Sola Lettura"); const id_miss = parseInt(document.getElementById('segnala-prob-missione-id').value); if(isNaN(id_miss)) return alert("Errore ID Missione."); problematiche.push({ id: calcolaProssimoId(problematiche), id_missione: id_miss, data: document.getElementById('segnala-prob-data').value, codice: document.getElementById('segnala-prob-codice').value, desc: document.getElementById('segnala-prob-desc').value, sintomi: document.getElementById('segnala-prob-sintomi').value, pn_assieme: document.getElementById('segnala-prob-pn').value, nome_assieme: document.getElementById('segnala-prob-nome-assieme').value }); await syncData(); e.target.reset(); document.getElementById('modal-segnala-problema').classList.add('hidden'); mostraNotificaConferma("Problematica registrata con successo!"); if(document.getElementById('screen-ritorni').classList.contains('active')) renderTabellaProblematiche(); }
async function salvaSoluzione(e) { e.preventDefault(); if(isReadOnly) return alert("Sola Lettura"); const id_prob = parseInt(document.getElementById('sol-problema').value); if(isNaN(id_prob)) return alert("Nessun problema selezionato."); soluzioni.push({ id: calcolaProssimoId(soluzioni), id_problema: id_prob, data: document.getElementById('sol-data').value, azione: document.getElementById('sol-azione').value, esito: document.getElementById('sol-esito').value }); await syncData(); mostraNotificaConferma("Intervento registrato con successo!"); e.target.reset(); apriDettaglioProblema(id_prob); if(document.getElementById('screen-ritorni').classList.contains('active')) renderTabellaProblematiche(); }

window.onload = async () => {
    document.getElementById('input-inizio').value = new Date().toISOString().split('T')[0]; document.getElementById('input-fine').value = new Date().toISOString().split('T')[0]; document.getElementById('segnala-prob-data').value = new Date().toISOString().split('T')[0]; document.getElementById('sol-data').value = new Date().toISOString().split('T')[0];
    initTimeline(); initMiniTimeline(); initMap(); setupAutocomplete(); setupDragAndDrop(); impostaMappaOggi(); await controllaFileAllAvvio();
};
// ==========================================
// INTRO: TERRA IN ROTAZIONE RAPIDA -> LOGO
// ==========================================
// ==========================================
// INTRO: TERRA SFERICA 3D REALE -> LOGO
// ==========================================
// ==========================================
// INTRO: TERRA SFERICA 3D REALE E ORBITE HD
// ==========================================
function avviaIntroAnimata() {
    const canvas = document.getElementById('earth-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const earthBox = document.getElementById('earth-container');
    const shockwave = document.getElementById('shockwave');
    const brand = document.getElementById('brand-reveal');
    const overlay = document.getElementById('intro-overlay');

    let rotation = 0;
    let speed = 0.005;
    let startTime = performance.now();
    let animId;

    // Centro e raggio del globo aggiornati per il nuovo canvas 500x500
	const CX = 250;
	const CY = 250;
    const R = 120; // Raggio della Terra (lascia 80px di spazio per le orbite)

    // --- VARIABILI PER TEXTURE MAPPING 3D ---
    let textureData = null;
    let tempCanvas = document.createElement('canvas');
    tempCanvas.width = R * 2;
    tempCanvas.height = R * 2;
    let tempCtx = tempCanvas.getContext('2d');

    function generateTexture() {
        const osc = document.createElement('canvas');
        osc.width = 1024; osc.height = 512;
        const octx = osc.getContext('2d');
        if (typeof WORLD_GEOJSON !== 'undefined') {
            octx.fillStyle = '#ffffff'; 
            function projectFlat(lon, lat) {
                return { x: ((lon + 180) / 360) * 1024, y: ((90 - lat) / 180) * 512 };
            }
            WORLD_GEOJSON.features.forEach(f => {
                if (f.geometry.type === 'Polygon') drawPoly(f.geometry.coordinates[0]);
                else if (f.geometry.type === 'MultiPolygon') f.geometry.coordinates.forEach(poly => drawPoly(poly[0]));
            });
            function drawPoly(coords) {
                octx.beginPath();
                coords.forEach((c, i) => {
                    let p = projectFlat(c[0], c[1]);
                    if (i === 0) octx.moveTo(p.x, p.y); else octx.lineTo(p.x, p.y);
                });
                octx.fill();
            }
        }
        textureData = octx.getImageData(0, 0, 1024, 512).data;
    }

    // --- FUNZIONI DI DISEGNO HD ---
    
	function drawMoon(zCheck) {
        let moonAngle = rotation * 0.3; 
        let z = Math.sin(moonAngle);
        if ((zCheck === 'back' && z >= 0) || (zCheck === 'front' && z < 0)) return;

        let moonX = CX + Math.cos(moonAngle) * 172;
        let moonY = CY + Math.sin(moonAngle) * 65; 
        
        ctx.save(); // Isola completamente lo stato del canvas per la Luna
        
        // Corpo della Luna
        ctx.beginPath(); 
        ctx.fillStyle = '#64748b'; 
        ctx.arc(moonX, moonY, 15, 0, Math.PI * 2); 
        ctx.fill();
        
        // Cratere principale
        ctx.beginPath(); 
        ctx.fillStyle = '#475569'; 
        ctx.arc(moonX - 5, moonY - 4, 4.5, 0, Math.PI * 2); 
        ctx.fill();

        // Secondo cratere
        ctx.beginPath(); 
        ctx.arc(moonX + 6, moonY + 5, 2.5, 0, Math.PI * 2); 
        ctx.fill();

        ctx.restore(); // Ripristina lo stato precedente ed elimina ogni traccia residua
    }

    function drawSatellite(satAngle, tiltX, tiltY, zCheck) {
        let z = Math.sin(satAngle);
        if ((zCheck === 'back' && z >= 0) || (zCheck === 'front' && z < 0)) return;
        
        let alpha = zCheck === 'back' ? Math.max(0.1, 1 + z) : 1;
        let satX = CX + Math.cos(satAngle) * tiltX;
        let satY = CY + Math.sin(satAngle) * tiltY;
        
        ctx.save(); // Isola lo stato
        ctx.translate(satX, satY);
        ctx.rotate(Math.cos(satAngle) * 0.15);
        
        // Pannelli Solari HD
        ctx.beginPath();
        ctx.fillStyle = `rgba(14, 165, 233, ${alpha})`;
        ctx.fillRect(-16, -5, 10, 10);
        ctx.fillRect(6, -5, 10, 10);
        
        // Griglie Pannelli Solari
        ctx.beginPath(); // Azzera sempre il percorso prima di uno stroke
        ctx.strokeStyle = `rgba(248, 250, 252, ${alpha * 0.6})`;
        ctx.lineWidth = 0.5;
        ctx.moveTo(-11, -5); ctx.lineTo(-11, 5);
        ctx.moveTo(-16, 0); ctx.lineTo(-6, 0);
        ctx.moveTo(11, -5); ctx.lineTo(11, 5);
        ctx.moveTo(6, 0); ctx.lineTo(16, 0);
        ctx.stroke();
        
        // Corpo Centrale
        ctx.beginPath();
        ctx.fillStyle = `rgba(241, 245, 249, ${alpha})`;
        ctx.fillRect(-6, -4, 12, 8);
        
        // Antenna Parabolica
        ctx.beginPath();
        ctx.arc(0, -4, 5, Math.PI, 0);
        ctx.fillStyle = `rgba(203, 213, 225, ${alpha})`;
        ctx.fill();
        
        // Lente / Sensore
        ctx.beginPath();
        ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
        ctx.arc(0, 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore(); // Chiude e ripulisce il contesto
    }

    function drawAircraft(orbitProgress, tilt, scale, direction, zCheck) {
        let angle = (orbitProgress * direction) % (Math.PI * 2);
        let z = Math.sin(angle); 
        if ((zCheck === 'back' && z >= 0) || (zCheck === 'front' && z < 0)) return;
        
        let alpha = zCheck === 'back' ? Math.max(0.1, 1 + z) : 1;
        
        let x = CX + Math.cos(angle) * 140; // Orbita aerea (appena sopra atmosfera)
        let y = CY + Math.sin(angle) * tilt;
        let dx = -Math.sin(angle) * 140;
        let dy = Math.cos(angle) * tilt;
        let heading = Math.atan2(dy * direction, dx * direction);
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading);
        
        // Scia di condensazione realistica (Contrail)
        ctx.beginPath();
        ctx.moveTo(-4 * scale, 0); ctx.lineTo(-40 * scale, 0);
        let grad = ctx.createLinearGradient(-4 * scale, 0, -40 * scale, 0);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.8})`);
        grad.addColorStop(1, `rgba(255, 255, 255, 0)`);
        ctx.strokeStyle = grad; ctx.lineWidth = 1.5; ctx.stroke();

        // Struttura Aereo HD
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        
        // Fusoliera
        ctx.beginPath(); 
        ctx.ellipse(1 * scale, 0, 10 * scale, 2.2 * scale, 0, 0, Math.PI*2); 
        ctx.fill();
        
        // Ali principali
        ctx.beginPath(); 
        ctx.moveTo(3 * scale, 0);
        ctx.lineTo(-4 * scale, -9 * scale); ctx.lineTo(-6 * scale, -9 * scale);
        ctx.lineTo(-1 * scale, 0);
        ctx.lineTo(-6 * scale, 9 * scale); ctx.lineTo(-4 * scale, 9 * scale);
        ctx.closePath(); 
        ctx.fill();
        
        // Stabilizzatori Coda
        ctx.beginPath(); 
        ctx.moveTo(-6 * scale, 0);
        ctx.lineTo(-9 * scale, -4 * scale); ctx.lineTo(-10 * scale, -4 * scale);
        ctx.lineTo(-8 * scale, 0);
        ctx.lineTo(-10 * scale, 4 * scale); ctx.lineTo(-9 * scale, 4 * scale);
        ctx.closePath(); 
        ctx.fill();
        
        // Cabina di pilotaggio (Vetro azzurro scuro)
        ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`;
        ctx.beginPath(); 
        ctx.ellipse(7 * scale, 0, 2 * scale, 1 * scale, 0, 0, Math.PI*2); 
        ctx.fill();
        
        // Beacon Rosso lampeggiante
        if (zCheck === 'front' && Math.floor(performance.now() / 150) % 2 === 0) {
            ctx.fillStyle = `rgba(227, 6, 19, ${alpha})`;
            ctx.beginPath(); ctx.arc(-2 * scale, -4 * scale, 1.5, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
    }

    // --- LOOP DI RENDER PRINCIPALE ---
function drawScene() {
        if (!textureData) generateTexture();

        // 1. RESET TOTALE DEL BUFFER E DEI TRACCIATI
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Ripristina la matrice di trasformazione standard
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Pulisce l'intero canvas geometrico
        ctx.beginPath(); // Svuota la coda dei tracciati per evitare l'accumulo di geometrie
        ctx.restore();

        // 2. LIVELLO POSTERIORE (Z < 0)
        drawMoon('back');
        drawSatellite(rotation * 0.7, 210, 85, 'back');
        drawSatellite(-rotation * 0.9 + 2, 190, 120, 'back');
        drawAircraft(rotation * 1.1, 45, 0.9, 1, 'back');
        drawAircraft(rotation * 0.9 + 3.14, -35, 0.8, -1, 'back');

        // 3. CORPO TERRA
        const oceanGrad = ctx.createRadialGradient(CX - 35, CY - 35, 20, CX, CY, R);
        oceanGrad.addColorStop(0, '#1e3a8a');
        oceanGrad.addColorStop(0.7, '#0f172a');
        oceanGrad.addColorStop(1, '#020617');
        
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = oceanGrad;
        ctx.arc(CX, CY, R, 0, Math.PI * 2); 
        ctx.fill();
        ctx.clip(); // Maschera per il globo

        // Reticolo
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
        ctx.lineWidth = 1;
        for (let lat = -60; lat <= 60; lat += 30) {
            let y = CY - (lat / 90) * (R * 0.8);
            ctx.arc(CX, y - (R * 0.45), R * Math.cos(lat * Math.PI / 180), 0, Math.PI * 2);
        }
        ctx.stroke();

        // Pixel Shader 3D (Continenti)
        let imgData = tempCtx.createImageData(R * 2, R * 2);
        let data = imgData.data;
        let rotOffset = rotation * 1.5; 

        for (let y = 0; y < R * 2; y++) {
            for (let x = 0; x < R * 2; x++) {
                let cx = x - R; 
                let cy = y - R;
                let r2 = cx * cx + cy * cy;
                if (r2 <= R * R) {
                    let z = Math.sqrt(R * R - r2);
                    let nx = cx / R; 
                    let ny = cy / R; 
                    let nz = z / R;
                    
                    let lat = Math.asin(ny); 
                    let lon = Math.atan2(nx, nz) + rotOffset;
                    
                    let lonNorm = ((lon + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
                    let tx = Math.floor((lonNorm / (Math.PI * 2)) * 1024);
                    let ty = Math.floor(((lat + Math.PI / 2) / Math.PI) * 512);
                    if (ty < 0) ty = 0; else if (ty > 511) ty = 511;
                    
                    let idx = (ty * 1024 + tx) * 4;
                    if (textureData[idx + 3] > 128) {
                        let shading = 0.2 + (nz * 0.8);
                        let outIdx = (y * (R * 2) + x) * 4;
                        data[outIdx] = 16 * shading;      
                        data[outIdx + 1] = 185 * shading;   
                        data[outIdx + 2] = 129 * shading;   
                        data[outIdx + 3] = 230;             
                    }
                }
            }
        }
        tempCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(tempCanvas, CX - R, CY - R);

        // Ombra sferica
        const innerShadow = ctx.createRadialGradient(CX - 40, CY - 40, 20, CX, CY, R);
        innerShadow.addColorStop(0, 'rgba(0,0,0,0)');
        innerShadow.addColorStop(0.8, 'rgba(0,0,0,0.5)');
        innerShadow.addColorStop(1, 'rgba(0,0,0,0.95)');
        ctx.beginPath();
        ctx.fillStyle = innerShadow;
        ctx.arc(CX, CY, R, 0, Math.PI * 2); 
        ctx.fill();
        ctx.restore(); // Rimuove il clip del globo

        // Bagliore atmosferico esterno
        ctx.save();
        const atmosphere = ctx.createRadialGradient(CX, CY, R - 2, CX, CY, R + 25);
        atmosphere.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
        atmosphere.addColorStop(0.3, 'rgba(56, 189, 248, 0.15)');
        atmosphere.addColorStop(1, 'rgba(125, 211, 252, 0)');
        ctx.beginPath();
        ctx.fillStyle = atmosphere;
        ctx.arc(CX, CY, R + 25, 0, Math.PI * 2); 
        ctx.fill();
        ctx.restore();

        // 4. LIVELLO ANTERIORE (Z >= 0)
        drawMoon('front');
        drawAircraft(rotation * 1.1, 45, 0.9, 1, 'front');
        drawAircraft(rotation * 0.9 + 3.14, -35, 0.8, -1, 'front');
        drawSatellite(rotation * 0.7, 210, 85, 'front');
        drawSatellite(-rotation * 0.9 + 2, 190, 120, 'front');
    }
	
    function animate(time) {
        const elapsed = (time - startTime) / 1000;

        if (elapsed < 2.2) {
            speed += 0.0002; 
            rotation += speed;
            drawScene();
            animId = requestAnimationFrame(animate);
        } else if (elapsed >= 2.2 && elapsed < 2.9) {
            rotation += speed * 2;
            drawScene();
            earthBox.style.transform = 'scale(0.01) rotate(360deg)';
            earthBox.style.opacity = '0';
            
            if (!shockwave.classList.contains('active')) shockwave.classList.add('active');
            animId = requestAnimationFrame(animate);
        } else if (elapsed >= 2.9) {
            cancelAnimationFrame(animId);
            brand.classList.add('visible');
            
            setTimeout(() => {
                overlay.classList.add('fade-out');
                setTimeout(() => { overlay.remove(); }, 700);
            }, 2500); 
        }
    }

    animId = requestAnimationFrame(animate);
}

// Innesca l'animazione all'avvio
window.addEventListener('DOMContentLoaded', () => {
    avviaIntroAnimata();
});


function mostraNotificaConferma(messaggio) {
    let toast = document.getElementById('fsm-toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'fsm-toast-notification';
        toast.className = 'fixed top-6 right-6 z-[9999] bg-emerald-600 text-white font-extrabold text-sm px-5 py-3 rounded-xl border-2 border-black shadow-[0_4px_0_0_#000] flex items-center gap-2 transition-all duration-300 opacity-0 pointer-events-none transform -translate-y-2';
        document.body.appendChild(toast);
    }
    
    toast.innerHTML = `<svg class="w-5 h-5 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> <span>${messaggio}</span>`;
    
    toast.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
    
    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'pointer-events-none', '-translate-y-2');
    }, 3000);
}