import streamlit as st
import pandas as pd
import datetime
import os
import io
import plotly.express as px
from geopy.geocoders import Nominatim
import json

FILE_MISSIONI = 'missioni.json'
FILE_TECNICI = 'tecnici.json'
COLONNE_DEFAULT = ['Tecnico', 'Destinazione', 'Scopo', 'Inizio', 'Fine', 'lat', 'lon', 'Esito_Report']

st.set_page_config(page_title="Gestione Trasferte FSM", layout="wide")
geolocator = Nominatim(user_agent="planner_team_aziendale")

# --- GESTIONE DATI ---
def carica_tecnici():
    if os.path.exists(FILE_TECNICI):
        with open(FILE_TECNICI, 'r') as f:
            return json.load(f)
    return ["Mario Rossi", "Giuseppe Verdi"] # Default

def salva_tecnici(tecnici_list):
    with open(FILE_TECNICI, 'w') as f:
        json.dump(tecnici_list, f)

def carica_missioni():
    if os.path.exists(FILE_MISSIONI):
        try:
            df = pd.read_json(FILE_MISSIONI, orient='records')
            if not df.empty:
                df['Inizio'] = pd.to_datetime(df['Inizio']).dt.date
                df['Fine'] = pd.to_datetime(df['Fine']).dt.date
                if 'Scopo' not in df.columns: df['Scopo'] = "N/D"
                return df
        except Exception: pass
    return pd.DataFrame(columns=COLONNE_DEFAULT)

def salva_missioni(df):
    df.to_json(FILE_MISSIONI, orient='records', date_format='iso')

# Inizializzazione Sessione
if 'tecnici' not in st.session_state: st.session_state.tecnici = carica_tecnici()
if 'missioni' not in st.session_state: st.session_state.missioni = carica_missioni()

# --- FUNZIONI EXCEL ---
def genera_excel(df):
    # Rimuove lat e lon prima dell'export
    df_export = df.drop(columns=['lat', 'lon'], errors='ignore')
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_export.to_excel(writer, index=False, sheet_name='Piano_Trasferte')
    return output.getvalue()

# --- BARRA LATERALE: GESTIONE TECNICI & IMPORT ---
with st.sidebar:
    st.header("👥 Gestione Team")
    nuovo_tecnico = st.text_input("Aggiungi nuovo tecnico")
    if st.button("Aggiungi Tecnico") and nuovo_tecnico:
        if nuovo_tecnico not in st.session_state.tecnici:
            st.session_state.tecnici.append(nuovo_tecnico)
            salva_tecnici(st.session_state.tecnici)
            st.success(f"{nuovo_tecnico} aggiunto!")
            st.rerun()
            
    st.subheader("Tecnici Attuali (Seleziona per rimuovere)")
    tecnico_da_rimuovere = st.selectbox("Seleziona tecnico", ["Nessuno"] + st.session_state.tecnici)
    if st.button("Rimuovi Tecnico") and tecnico_da_rimuovere != "Nessuno":
        st.session_state.tecnici.remove(tecnico_da_rimuovere)
        salva_tecnici(st.session_state.tecnici)
        st.warning(f"{tecnico_da_rimuovere} rimosso.")
        st.rerun()

    st.divider()
    st.header("📂 Importa Dati")
    file_caricato = st.file_uploader("Carica Excel storico", type=['xlsx'])
    if file_caricato is not None:
        if st.button("Importa Excel"):
            df_import = pd.read_excel(file_caricato)
            # Aggiunge colonne mancanti
            for col in COLONNE_DEFAULT:
                if col not in df_import.columns:
                    df_import[col] = 0.0 if col in ['lat', 'lon'] else 'N/D'
            st.session_state.missioni = pd.concat([st.session_state.missioni, df_import], ignore_index=True)
            salva_missioni(st.session_state.missioni)
            st.success("Dati importati con successo!")
            st.rerun()

# --- CORPO PRINCIPALE (TAB) ---
tab_pianifica, tab_dashboard, tab_gestione = st.tabs(["✍️ Pianifica", "📊 Dashboard & Mappa", "⚙️ Modifica Dati"])

# 1. TAB PIANIFICAZIONE
with tab_pianifica:
    st.header("Pianifica Nuova Missione")
    
    # Crea una lista delle destinazioni storiche per simulare l'autocompletamento
    destinazioni_storiche = st.session_state.missioni['Destinazione'].dropna().unique().tolist() if not st.session_state.missioni.empty else []
    
    with st.form("form_pianificazione"):
        col1, col2 = st.columns(2)
        tecnico = col1.selectbox("Nome Tecnico (Autocompletamento)", st.session_state.tecnici)
        
        # Scelta tra destinazione recente o nuova
        usa_recente = col2.checkbox("Usa una destinazione già salvata")
        if usa_recente and destinazioni_storiche:
            destinazione = col2.selectbox("Scegli destinazione", destinazioni_storiche)
        else:
            destinazione = col2.text_input("Inserisci Nuova Destinazione (es. Roma, Italia)", "Milano, Italia")
            
        scopo = st.text_input("Scopo della Missione", "es. Manutenzione ordinaria")
        
        col3, col4 = st.columns(2)
        inizio = col3.date_input("Data Inizio", datetime.date.today())
        fine = col4.date_input("Data Fine", datetime.date.today() + datetime.timedelta(days=3))
        
        submit = st.form_submit_button("Assegna Trasferta")
        
        if submit:
            # Controllo Conflitti
            conflitto = False
            storico = st.session_state.missioni[st.session_state.missioni['Tecnico'] == tecnico]
            for _, row in storico.iterrows():
                if (inizio <= row['Fine']) and (fine >= row['Inizio']):
                    conflitto = True
                    break
                    
            if fine < inizio:
                st.error("Errore: La fine precede l'inizio.")
            elif conflitto:
                st.error(f"⚠️ Conflitto! {tecnico} ha già un impegno in queste date.")
            else:
                with st.spinner("Geolocalizzazione..."):
                    try:
                        loc = geolocator.geocode(destinazione)
                        lat, lon = (loc.latitude, loc.longitude) if loc else (0.0, 0.0)
                    except: lat, lon = (0.0, 0.0)
                    
                nuova = pd.DataFrame([{'Tecnico': tecnico, 'Destinazione': destinazione, 'Scopo': scopo,
                                       'Inizio': inizio, 'Fine': fine, 'lat': lat, 'lon': lon, 'Esito_Report': 'In attesa'}])
                st.session_state.missioni = pd.concat([st.session_state.missioni, nuova], ignore_index=True)
                salva_missioni(st.session_state.missioni)
                st.success("Trasferta aggiunta!")
                st.rerun()

# 2. TAB DASHBOARD
with tab_dashboard:
    df_corrente = st.session_state.missioni
    if not df_corrente.empty:
        col_export, col_spazio = st.columns([2, 8])
        col_export.download_button("📥 Esporta Excel", data=genera_excel(df_corrente), file_name="trasferte.xlsx")
        
        st.divider()
        
        # --- TIMELINE GANTT CON VISTE ---
        st.subheader("Timeline Allocazioni")
        vista_tempo = st.radio("Seleziona dettaglio temporale:", ["Settimana", "Mese", "Trimestre", "Anno"], horizontal=True)
        
        df_gantt = df_corrente.copy()
        df_gantt['Inizio'] = pd.to_datetime(df_gantt['Inizio'])
        df_gantt['Fine_Gantt'] = pd.to_datetime(df_gantt['Fine']) + pd.Timedelta(days=1)
        
        fig_gantt = px.timeline(df_gantt, x_start="Inizio", x_end="Fine_Gantt", y="Tecnico", 
                                color="Destinazione", hover_data=["Scopo"])
        fig_gantt.update_yaxes(autorange="reversed")
        
        # Imposta le linee verticali in base alla vista selezionata
        if vista_tempo == "Settimana":
            dtick_val = 86400000 * 7 # Millisecondi in una settimana
            tick_fmt = "%d %b %Y"
        elif vista_tempo == "Mese":
            dtick_val = "M1"
            tick_fmt = "%b %Y"
        elif vista_tempo == "Trimestre":
            dtick_val = "M3"
            tick_fmt = "Q%q %Y"
        else: # Anno
            dtick_val = "M12"
            tick_fmt = "%Y"
            
        fig_gantt.update_xaxes(showgrid=True, gridwidth=1, gridcolor='gray', dtick=dtick_val, tickformat=tick_fmt)
        st.plotly_chart(fig_gantt, use_container_width=True)
        
        st.divider()
        
        # --- MAPPA CON LEGENDA ---
        st.subheader("Mappa Geografica (Colore per Tecnico)")
        df_mappa = df_corrente[(df_corrente['lat'] != 0.0) & (df_corrente['lon'] != 0.0)]
        if not df_mappa.empty:
            fig_map = px.scatter_mapbox(df_mappa, lat="lat", lon="lon", color="Tecnico", 
                                        hover_name="Destinazione", hover_data=["Scopo", "Inizio"],
                                        zoom=3, mapbox_style="open-street-map", size_max=15)
            # Aumenta la dimensione dei marker per visibilità
            fig_map.update_traces(marker=dict(size=12, opacity=0.8))
            fig_map.update_layout(margin={"r":0,"t":0,"l":0,"b":0})
            st.plotly_chart(fig_map, use_container_width=True)
        else:
            st.info("Nessuna coordinata valida per popolare la mappa.")
    else:
        st.info("Nessuna missione inserita.")

# 3. TAB GESTIONE (MODIFICA / CANCELLA)
with tab_gestione:
    st.header("Modifica o Cancella Trasferte")
    st.markdown("Usa la tabella sottostante per modificare le date, cambiare gli esiti, o selezionare le righe (a sinistra) e premere `Canc` sulla tastiera per eliminarle.")
    
    if not st.session_state.missioni.empty:
        # data_editor permette di modificare e cancellare dinamicamente
        df_modificato = st.data_editor(
            st.session_state.missioni, 
            num_rows="dynamic", # Permette aggiunte e cancellazioni
            use_container_width=True,
            column_config={
                "lat": None, "lon": None # Nasconde queste colonne dalla vista editabile
            }
        )
        
        if st.button("💾 Salva Modifiche al Database"):
            st.session_state.missioni = df_modificato
            salva_missioni(st.session_state.missioni)
            st.success("Modifiche salvate con successo!")
            st.rerun()
    else:
        st.info("Nessuna missione da modificare.")
