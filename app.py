import streamlit as st
import pandas as pd
import datetime
import os
import io
import plotly.express as px
from geopy.geocoders import Nominatim

FILE_DATI = 'missioni.json'
COLONNE_DEFAULT = ['Tecnico', 'Destinazione', 'Scopo', 'Inizio', 'Fine', 'lat', 'lon', 'Esito_Report']

# --- DATI DI BASE ---
# Inserisci qui l'elenco dei tuoi 20 collaboratori
LISTA_TECNICI = [
    "Mario Rossi", "Giuseppe Verdi", "Andrea Bianchi", "Francesca Neri", 
    "Luca Colombo", "Elena Ricci", "Marco Esposito", "Sofia Romano"
]

# --- INIZIALIZZAZIONE GEOLOCALIZZATORE ---
# Usiamo Nominatim di OpenStreetMap per convertire il testo in coordinate
geolocator = Nominatim(user_agent="planner_team_aziendale")

# --- GESTIONE DATI (JSON) ---
def carica_dati():
    if os.path.exists(FILE_DATI):
        try:
            df = pd.read_json(FILE_DATI, orient='records')
            if not df.empty and 'Inizio' in df.columns:
                df['Inizio'] = pd.to_datetime(df['Inizio']).dt.date
                df['Fine'] = pd.to_datetime(df['Fine']).dt.date
                # Garantisce la retrocompatibilità se ci sono vecchi salvataggi senza la colonna 'Scopo'
                if 'Scopo' not in df.columns:
                    df['Scopo'] = "N/D"
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
    # 1. Campo Tecnico Intelligente (Selectbox con ricerca)
    tecnico = col1.selectbox("Nome Tecnico", LISTA_TECNICI)
    # 2. Campo Destinazione senza coordinate manuali
    destinazione = col2.text_input("Destinazione (Città, Paese)", "Roma, Italia")
    
    # 3. Nuovo Campo Scopo
    scopo = st.text_input("Scopo della Missione", "es. Integrazione sensori Elettro-ottici, SAT, Manutenzione...")
    
    col3, col4 = st.columns(2)
    inizio = col3.date_input("Data Inizio", datetime.date.today())
    fine = col4.date_input("Data Fine", datetime.date.today() + datetime.timedelta(days=5))
    
    submit = st.form_submit_button("Assegna Trasferta")
    
    if submit:
        if fine < inizio:
            st.error("Errore: La data di fine precede l'inizio.")
        elif check_conflitto(tecnico, inizio, fine):
            st.error(f"⚠️ Conflitto! {tecnico} ha già un impegno in queste date.")
        else:
            with st.spinner("Geolocalizzazione della destinazione in corso..."):
                try:
                    # Calcolo automatico di lat e lon
                    location = geolocator.geocode(destinazione)
                    if location:
                        lat, lon = location.latitude, location.longitude
                    else:
                        lat, lon = 0.0, 0.0
                        st.warning(f"Non sono riuscito a trovare le coordinate esatte per '{destinazione}'. Sulla mappa apparirà in coordinate 0,0.")
                except Exception:
                    lat, lon = 0.0, 0.0
                    st.warning("Servizio di geolocalizzazione temporaneamente non disponibile.")

            nuova_missione = pd.DataFrame([{
                'Tecnico': tecnico, 'Destinazione': destinazione, 'Scopo': scopo,
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
    # Riorganizziamo le colonne per nascondere lat e lon dalla vista tabella
    colonne_visibili = ['Tecnico', 'Destinazione', 'Scopo', 'Inizio', 'Fine', 'Esito_Report']
    st.dataframe(df_corrente[colonne_visibili], use_container_width=True)
    
    st.download_button(
        label="📥 Esporta in Excel",
        data=genera_excel(df_corrente),
        file_name="report_trasferte.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    
    st.subheader("Pianificazione Temporale (Gantt)")
    df_gantt = df_corrente.copy()
    df_gantt['Inizio'] = pd.to_datetime(df_gantt['Inizio'])
    df_gantt['Fine_Gantt'] = pd.to_datetime(df_gantt['Fine']) + pd.Timedelta(days=1)
    
    # Nel Gantt facciamo apparire anche lo Scopo quando passi il mouse (hover_data)
    fig = px.timeline(
        df_gantt, 
        x_start="Inizio", 
        x_end="Fine_Gantt", 
        y="Tecnico", 
        color="Destinazione",
        hover_data=["Scopo"],
        title="Timeline Allocazioni Personale"
    )
    fig.update_yaxes(autorange="reversed")
    st.plotly_chart(fig, use_container_width=True)
    
    st.subheader("Mappa Geografica Trasferte")
    st.map(df_corrente[['lat', 'lon']])
else:
    st.info("Nessuna missione inserita. Usa il modulo in alto per iniziare.")
