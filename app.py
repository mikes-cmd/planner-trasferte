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
# Impostiamo la lingua italiana per il geolocator
geolocator = Nominatim(user_agent="planner_team_aziendale")

# --- GESTIONE DATI LOCALI ---
def carica_tecnici():
    if os.path.exists(FILE_TECNICI):
        with open(FILE_TECNICI, 'r') as f:
            return json.load(f)
    return ["Mario Rossi", "Giuseppe Verdi"] 

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

if 'tecnici' not in st.session_state: st.session_state.tecnici = carica_tecnici()
if 'missioni' not in st.session_state: st.session_state.missioni = carica_missioni()

# --- FUNZIONI EXCEL E VALIDAZIONE ---
def genera_excel(df):
    df_export = df.drop(columns=['lat', 'lon'], errors='ignore')
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_export.to_excel(writer, index=False, sheet_name='Piano_Trasferte')
    return output.getvalue()

def valida_consistenza_dataframe(df):
    """Controlla l'intero dataframe per date invertite o sovrapposizioni"""
    for index, row in df.iterrows():
        if row['Fine'] < row['Inizio']:
            return False, f"La data di fine precede l'inizio per {row['Tecnico']}."
        # Cerca conflitti escludendo la riga stessa (tramite indice)
        storico = df[(df['Tecnico'] == row['Tecnico']) & (df.index != index)]
        for _, r_storico in storico.iterrows():
            if (row['Inizio'] <= r_storico['Fine']) and (row['Fine'] >= r_storico['Inizio']):
                return False, f"Conflitto rilevato per {row['Tecnico']} a {row['Destinazione']}."
    return True, ""

# --- STRUTTURA A SCHEDE ---
tabs = st.tabs(["✍️ Pianifica", "📊 Dashboard", "🗺️ Mappa", "⚙️ Modifica Dati", "👥 Gestione Team", "💾 Import/Export Dati"])
tab_pianifica, tab_dashboard, tab_mappa, tab_modifica, tab_team, tab_dati = tabs

# --- 1. SCHEDA PIANIFICA ---
with tab_pianifica:
    st.header("Pianifica Nuova Missione")
    
    col_form, col_calendario = st.columns([1, 1])
    
    with col_form:
        with st.form("form_pianificazione"):
            tecnico = st.selectbox("Nome Tecnico", st.session_state.tecnici)
            destinazione = st.text_input("Destinazione (Città, Paese)", "Milano, Italia")
            scopo = st.text_input("Scopo della Missione", "Manutenzione ordinaria")
            
            c1, c2 = st.columns(2)
            inizio = c1.date_input("Data Inizio", datetime.date.today())
            fine = c2.date_input("Data Fine", datetime.date.today() + datetime.timedelta(days=3))
            
            submit = st.form_submit_button("Assegna Trasferta")
    
    # Mini-Calendario per il tecnico selezionato
    with col_calendario:
        st.subheader(f"Disponibilità: {tecnico}")
        df_tec = st.session_state.missioni[st.session_state.missioni['Tecnico'] == tecnico].copy()
        if not df_tec.empty:
            df_tec['Inizio'] = pd.to_datetime(df_tec['Inizio'])
            df_tec['Fine_Gantt'] = pd.to_datetime(df_tec['Fine']) + pd.Timedelta(days=1)
            fig_mini = px.timeline(df_tec, x_start="Inizio", x_end="Fine_Gantt", y="Tecnico", color="Destinazione", height=250)
            fig_mini.update_yaxes(visible=False) # Nasconde il nome asse Y per spazio
            st.plotly_chart(fig_mini, use_container_width=True)
        else:
            st.success(f"{tecnico} non ha attualmente trasferte pianificate.")
            
    if submit:
        # 1. Controllo date logiche
        if fine < inizio:
            st.error("Errore: La fine precede l'inizio.")
        else:
    # 2. Controllo sovrapposizioni (Aggiornato per evitare il TypeError)
            conflitto = False
            for _, row in df_tec.iterrows():
                # Converte esplicitamente in data standard per poterle confrontare con gli input di Streamlit
                row_inizio = pd.to_datetime(row['Inizio']).date()
                row_fine = pd.to_datetime(row['Fine']).date()
                
                if (inizio <= row_fine) and (fine >= row_inizio):
                    conflitto = True
                    break
            
            if conflitto:
                st.error("⚠️ Conflitto! Il tecnico è già impegnato in queste date (vedi calendario a lato).")
            else:
                # 3. Controllo Smart della Destinazione
                with st.spinner("Verifica coerenza destinazione..."):
                    try:
                        loc = geolocator.geocode(destinazione, language='it')
                        if loc is None:
                            st.error(f"❌ Destinazione '{destinazione}' non trovata. Inserisci una città reale valida.")
                            st.stop()
                        lat, lon = loc.latitude, loc.longitude
                    except:
                        st.error("Errore nei servizi di mappa. Riprova tra poco.")
                        st.stop()
                        
                nuova = pd.DataFrame([{'Tecnico': tecnico, 'Destinazione': destinazione, 'Scopo': scopo,
                                       'Inizio': inizio, 'Fine': fine, 'lat': lat, 'lon': lon, 'Esito_Report': 'In attesa'}])
                st.session_state.missioni = pd.concat([st.session_state.missioni, nuova], ignore_index=True)
                salva_missioni(st.session_state.missioni)
                st.success("Trasferta validata e assegnata!")
                st.rerun()

# --- 2. SCHEDA DASHBOARD (SOLO TIMELINE) ---
with tab_dashboard:
    st.header("Timeline Allocazioni")
    df_corrente = st.session_state.missioni
    if not df_corrente.empty:
        vista_tempo = st.radio("Dettaglio temporale:", ["Settimana", "Mese", "Trimestre", "Anno"], horizontal=True)
        
        df_gantt = df_corrente.copy()
        df_gantt['Inizio'] = pd.to_datetime(df_gantt['Inizio'])
        df_gantt['Fine_Gantt'] = pd.to_datetime(df_gantt['Fine']) + pd.Timedelta(days=1)
        
        fig_gantt = px.timeline(df_gantt, x_start="Inizio", x_end="Fine_Gantt", y="Tecnico", 
                                color="Destinazione", hover_data=["Scopo"])
        fig_gantt.update_yaxes(autorange="reversed")
        
        # Correzione del controllo griglia temporale di Plotly
        if vista_tempo == "Settimana":
            fig_gantt.update_xaxes(dtick=604800000, tickformat="%d %b") # 7 giorni in ms
        elif vista_tempo == "Mese":
            fig_gantt.update_xaxes(dtick="M1", tickformat="%b %Y")
        elif vista_tempo == "Trimestre":
            fig_gantt.update_xaxes(dtick="M3", tickformat="Q%q %Y")
        else: # Anno
            fig_gantt.update_xaxes(dtick="M12", tickformat="%Y")
            
        fig_gantt.update_xaxes(showgrid=True, gridwidth=1, gridcolor='gray')
        st.plotly_chart(fig_gantt, use_container_width=True)
    else:
        st.info("Nessuna missione inserita.")

# --- 3. SCHEDA MAPPA (POSIZIONE ATTUALE) ---
with tab_mappa:
    st.header("Posizione Attuale dei Tecnici")
    df_corrente = st.session_state.missioni
    oggi = datetime.date.today()
    st.write(f"Situazione alla data: **{oggi.strftime('%d/%m/%Y')}**")
    
    if not df_corrente.empty:
        # Filtra solo le trasferte in corso oggi
        df_oggi = df_corrente[(df_corrente['Inizio'] <= oggi) & (df_corrente['Fine'] >= oggi)]
        df_mappa = df_oggi[(df_oggi['lat'] != 0.0) & (df_oggi['lon'] != 0.0)]
        
        if not df_mappa.empty:
            # carto-positron evita le lingue locali (es. Arabo) privilegiando caratteri latini
            fig_map = px.scatter_mapbox(df_mappa, lat="lat", lon="lon", color="Tecnico", 
                                        hover_name="Destinazione", hover_data=["Scopo", "Fine"],
                                        zoom=3, mapbox_style="carto-positron", size_max=15)
            fig_map.update_traces(marker=dict(size=14, opacity=0.9))
            fig_map.update_layout(margin={"r":0,"t":0,"l":0,"b":0})
            st.plotly_chart(fig_map, use_container_width=True)
        else:
            st.info("Nessun tecnico è attualmente in trasferta in data odierna.")
    else:
        st.info("Nessun dato a sistema.")

# --- 4. SCHEDA MODIFICA DATI ---
with tab_modifica:
    st.header("Modifica o Cancella Trasferte")
    if not st.session_state.missioni.empty:
        df_modificato = st.data_editor(
            st.session_state.missioni, 
            num_rows="dynamic",
            use_container_width=True,
            column_config={"lat": None, "lon": None}
        )
        
        if st.button("💾 Valida e Salva Modifiche"):
            valido, messaggio = valida_consistenza_dataframe(df_modificato)
            if valido:
                st.session_state.missioni = df_modificato
                salva_missioni(st.session_state.missioni)
                st.success("Tutte le modifiche sono coerenti e sono state salvate!")
                st.rerun()
            else:
                st.error(f"❌ Impossibile salvare. {messaggio}")
    else:
        st.info("Nessuna missione da modificare.")

# --- 5. SCHEDA GESTIONE TEAM ---
with tab_team:
    st.header("👥 Gestione Risorse")
    col1, col2 = st.columns(2)
    with col1:
        nuovo_tecnico = st.text_input("Aggiungi nuovo tecnico")
        if st.button("Aggiungi Tecnico") and nuovo_tecnico:
            if nuovo_tecnico not in st.session_state.tecnici:
                st.session_state.tecnici.append(nuovo_tecnico)
                salva_tecnici(st.session_state.tecnici)
                st.success(f"{nuovo_tecnico} aggiunto!")
                st.rerun()
    with col2:
        tecnico_da_rimuovere = st.selectbox("Seleziona tecnico da rimuovere", ["Nessuno"] + st.session_state.tecnici)
        if st.button("Rimuovi Tecnico") and tecnico_da_rimuovere != "Nessuno":
            st.session_state.tecnici.remove(tecnico_da_rimuovere)
            salva_tecnici(st.session_state.tecnici)
            st.warning(f"{tecnico_da_rimuovere} rimosso.")
            st.rerun()

# --- 6. SCHEDA IMPORT/EXPORT DATI ---
with tab_dati:
    st.header("💾 Importa e Esporta Excel")
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("Esporta Dati")
        if not st.session_state.missioni.empty:
            st.download_button(
                label="📥 Scarica Excel",
                data=genera_excel(st.session_state.missioni),
                file_name="trasferte.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
        else:
            st.write("Nessun dato da esportare.")
            
    with col2:
        st.subheader("Importa Dati Storici")
        file_caricato = st.file_uploader("Carica Excel (.xlsx)", type=['xlsx'])
        if file_caricato is not None:
            if st.button("Importa"):
                df_import = pd.read_excel(file_caricato)
                for col in COLONNE_DEFAULT:
                    if col not in df_import.columns:
                        df_import[col] = 0.0 if col in ['lat', 'lon'] else 'N/D'
                st.session_state.missioni = pd.concat([st.session_state.missioni, df_import], ignore_index=True)
                salva_missioni(st.session_state.missioni)
                st.success("Dati importati con successo!")
                st.rerun()
