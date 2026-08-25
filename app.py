import streamlit as st
import pandas as pd
import datetime
import os
import io
import plotly.express as px

FILE_DATI = 'missioni.json'

COLONNE_DEFAULT = ['Tecnico', 'Destinazione', 'Inizio', 'Fine', 'lat', 'lon', 'Esito_Report']

# --- GESTIONE DATI (JSON) ---
def carica_dati():
    if os.path.exists(FILE_DATI):
        try:
            df = pd.read_json(FILE_DATI, orient='records')
            if not df.empty and 'Inizio' in df.columns:
                df['Inizio'] = pd.to_datetime(df['Inizio']).dt.date
                df['Fine'] = pd.to_datetime(df['Fine']).dt.date
                return df
        except Exception:
            pass
    return pd.DataFrame(columns=COLONNE_DEFAULT)

def salva_dati(df):
    df.to_json(FILE_DATI, orient='records', date_format='iso')

# --- INIZIALIZZAZIONE SESSIONE ---
if 'missioni' not in st.session_state:
    st.session_state.missioni = carica_dati()

# --- LOGICA DI CONFLITTO ---
def check_conflitto(tecnico, data_inizio, data_fine):
    df = st.session_state.missioni
    if df.empty:
        return False
    storico = df[df['Tecnico'] == tecnico]
    for _, row in storico.iterrows():
        if (data_inizio <= row['Fine']) and (data_fine >= row['Inizio']):
            return True
    return False

# --- FUNZIONE EXCEL ---
def genera_excel(df):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Piano_Trasferte')
    return output.getvalue()

st.set_page_config(page_title="Planner Trasferte", layout="wide")
st.title("Gestione Trasferte e Pianificazione Risorse")

# --- INTERFACCIA PIANIFICAZIONE ---
st.header("1. Pianifica Nuova Missione")
with st.form("form_pianificazione"):
    col1, col2 = st.columns(2)
    tecnico = col1.text_input("Nome Tecnico", "Mario Rossi")
    destinazione = col2.text_input("Destinazione (Città/Paese)", "Monaco, Germania")
    
    col3, col4 = st.columns(2)
    inizio = col3.date_input("Data Inizio", datetime.date.today())
    fine = col4.date_input("Data Fine", datetime.date.today() + datetime.timedelta(days=5))
    
    col5, col6 = st.columns(2)
    lat = col5.number_input("Latitudine", value=48.1351)
    lon = col6.number_input("Longitudine", value=11.5820)
    
    submit = st.form_submit_button("Assegna Trasferta")
    
    if submit:
        if fine < inizio:
            st.error("Errore: La data di fine precede l'inizio.")
        elif check_conflitto(tecnico, inizio, fine):
            st.error(f"⚠️ Conflitto! {tecnico} ha già un impegno in queste date.")
        else:
            nuova_missione = pd.DataFrame([{
                'Tecnico': tecnico, 'Destinazione': destinazione, 
                'Inizio': inizio, 'Fine': fine, 'lat': lat, 'lon': lon, 'Esito_Report': 'In attesa'
            }])
            st.session_state.missioni = pd.concat([st.session_state.missioni, nuova_missione], ignore_index=True)
            salva_dati(st.session_state.missioni)
            st.success("Trasferta validata e registrata!")
            st.rerun()

# --- REPORT E VISUALIZZAZIONI ---
st.header("2. Situazione Attuale")
df_corrente = st.session_state.missioni

if not df_corrente.empty:
    st.dataframe(df_corrente, use_container_width=True)
    
    # Download Excel
    st.download_button(
        label="📥 Esporta in Excel",
        data=genera_excel(df_corrente),
        file_name="report_trasferte.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    
    # Diagramma di Gantt
    st.subheader("Pianificazione Temporale (Gantt)")
    df_gantt = df_corrente.copy()
    df_gantt['Inizio'] = pd.to_datetime(df_gantt['Inizio'])
    df_gantt['Fine_Gantt'] = pd.to_datetime(df_gantt['Fine']) + pd.Timedelta(days=1)
    
    fig = px.timeline(
        df_gantt, 
        x_start="Inizio", 
        x_end="Fine_Gantt", 
        y="Tecnico", 
        color="Destinazione",
        title="Timeline Allocazioni Personale"
    )
    fig.update_yaxes(autorange="reversed")
    st.plotly_chart(fig, use_container_width=True)
    
    # Mappa
    st.subheader("Mappa Geografica Trasferte")
    st.map(df_corrente[['lat', 'lon']])
else:
    st.info("Nessuna missione inserita. Usa il modulo in alto per iniziare.")
