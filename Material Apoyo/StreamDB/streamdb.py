# Tab DATA EXTRACTION
import psycopg2
import csv
import os
from datetime import date, timedelta
import configparser
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from tkcalendar import DateEntry
import threading
import subprocess # Para abrir la carpeta
import unicodedata
import sys
import customtkinter as ctk


def get_db_params():
    """Lee la configuración de la base de datos desde config.ini."""
    config = configparser.ConfigParser()
    # Usamos una ruta absoluta para asegurar que PyInstaller encuentre el archivo
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    config_path = os.path.join(base_path, 'config.ini')
    
    if not os.path.exists(config_path):
        raise FileNotFoundError("No se encontró el archivo config.ini.")
        
    config.read(config_path)
    if 'database' not in config:
        raise configparser.NoSectionError('database')
        
    return dict(config['database'])

def get_app_version():
    """Lee la versión desde version.txt."""
    try:
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        version_path = os.path.join(base_path, 'version.txt')
        with open(version_path, 'r') as f:
            return f.read().strip()
    except Exception:
        return "?.?.?"

def get_build_date():
    """Lee la fecha de build desde build_date.txt."""
    try:
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        date_path = os.path.join(base_path, 'build_date.txt')
        with open(date_path, 'r') as f:
            return f.read().strip()
    except Exception:
        return None

# Carpeta de salida
carpeta_salida = "Sesiones_Lander"
os.makedirs(carpeta_salida, exist_ok=True)

def format_duration(seconds):
    """Convierte segundos en formato HH:MM:SS."""
    if seconds is None:
        return "00:00:00"
    return str(timedelta(seconds=int(seconds)))

def slugify(value):
    """Normaliza un string, convierte a ASCII, quita caracteres no-alfanuméricos y convierte espacios a guiones bajos."""
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = "".join(c for c in value if c.isalnum() or c in (' ', '_')).strip()
    return value.replace(' ', '_')

def load_user_settings():
    """Carga la configuración del usuario desde user_settings.ini."""
    settings_parser = configparser.ConfigParser()
    settings_path = 'user_settings.ini'
    today_str = date.today().isoformat()
    
    defaults = {
        'last_start_date': today_str,
        'last_end_date': today_str,
        'include_anonymous': 'true',
        'clean_folder': 'false'
    }

    if not os.path.exists(settings_path):
        return defaults

    try:
        settings_parser.read(settings_path)
        settings = dict(settings_parser.items('UserSettings'))
        # Validar fechas para evitar errores si el archivo está corrupto
        date.fromisoformat(settings.get('last_start_date', today_str))
        date.fromisoformat(settings.get('last_end_date', today_str))
        return {**defaults, **settings} # Mezcla con defaults por si faltan claves
    except (configparser.Error, ValueError):
        return defaults # Si el archivo es inválido, usa los valores por defecto

def save_user_settings(start_date, end_date, include_anonymous, clean_folder):
    """Guarda la configuración del usuario en user_settings.ini."""
    settings_parser = configparser.ConfigParser()
    settings_parser['UserSettings'] = {
        'last_start_date': start_date.isoformat(),
        'last_end_date': end_date.isoformat(),
        'include_anonymous': str(include_anonymous).lower(),
        'clean_folder': str(clean_folder).lower()
    }
    with open('user_settings.ini', 'w') as configfile:
        settings_parser.write(configfile)

def check_connection_and_count(fecha_inicio, fecha_fin, log_callback, progress_callback, include_anonymous):
    """
    Verifica la conexión con la BD y cuenta los archivos disponibles
    para el rango de fechas sin descargar nada.
    """
    conn = None
    params = [fecha_inicio, fecha_fin]
    progress_callback(0)
    try:
        conn_params = get_db_params()
        log_callback(f"\nConectando a la base de datos en {conn_params['host']}...\n")
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()
        
        log_callback("✅ Conexión exitosa a la base de datos.\n")
        
        query_base = """
            SELECT COUNT(*) as total
            FROM sessions 
            WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
        """
        
        if not include_anonymous:
            query_base += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"
        
        cursor.execute(query_base, params)
        total_count = cursor.fetchone()[0]
        
        log_callback(f"✅ Se encontraron {total_count} conducciones disponibles para descargar.\n")
        
        # Mostrar también información de primeros y últimos registros
        if total_count > 0:
            query_dates = """
                SELECT MIN(CAST(dtcreation AS DATE)), MAX(CAST(dtcreation AS DATE))
                FROM sessions 
                WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
            """
            if not include_anonymous:
                query_dates += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"
            
            cursor.execute(query_dates, params)
            min_date, max_date = cursor.fetchone()
            log_callback(f"📅 Rango de fechas: {min_date} a {max_date}")
        
        progress_callback(100)
        
    except FileNotFoundError as e:
        log_callback(f"\n❌ Error de configuración: {e}")
    except psycopg2.OperationalError as e:
        log_callback(f"\n❌ Error de conexión: {e}\nVerifica la conexión y que el firewall no esté bloqueando el puerto.")
    except configparser.NoSectionError:
        log_callback("\n❌ Error: No se encontró la sección [database] en config.ini.")
    except Exception as e:
        log_callback(f"\n❌ Ocurrió un error inesperado: {e}")
    finally:
        if conn:
            conn.close()
            log_callback("\nConexión a la base de datos cerrada.")

def run_extraction(fecha_inicio, fecha_fin, log_callback, progress_callback, include_anonymous, log_error_callback=None, alert_callback=None):
    """
    Conecta a la BD y extrae los datos de las sesiones para el rango de fechas.
    Usa log_callback para reportar el progreso a la GUI.
    """
    conn = None
    params = [fecha_inicio, fecha_fin]
    progress_callback(0) # Inicia la barra de progreso en 0
    try:
        conn_params = get_db_params()
        log_callback(f"Conectando a la base de datos en {conn_params['host']}...\n")
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()

        query_base = """
            SELECT id, sstudentname, dtcreation, 
                   sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
                   idexercise, idaula
            FROM sessions 
            WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN %s AND %s
        """

        if not include_anonymous:
            query_base += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')"
        
        query_sesiones = query_base + " ORDER BY dtcreation DESC;"

        log_callback(f"Buscando sesiones entre {fecha_inicio} y {fecha_fin}...")
        cursor.execute(query_sesiones, params)
        sesiones = cursor.fetchall()

        if not sesiones:
            log_callback("\nNo se encontraron conducciones para las fechas seleccionadas.")
            progress_callback(100) # Completa la barra si no hay nada que hacer
            return
        
        log_callback(f"Descargando {len(sesiones)} conduccion(es)...\n")

        # Bucle principal para procesar sesiones
        for i, sesion in enumerate(sesiones):
            id_sesion, nombre_alumno, fecha, instructor, duracion, id_ejercicio, id_aula = sesion
            nombre_alumno_limpio = slugify(nombre_alumno)
            fecha_str = fecha.strftime("%Y-%m-%d")
            nombre_archivo = f"{carpeta_salida}/ID{id_sesion}_{nombre_alumno_limpio}_{fecha_str}.csv"

            log_callback(f"({i+1}/{len(sesiones)}) {os.path.basename(nombre_archivo)}")

            # Actualizar la barra de progreso
            progress_value = (i + 1) / len(sesiones) * 100
            progress_callback(progress_value)

            with open(nombre_archivo, mode='w', newline='', encoding='utf-8', errors='replace') as archivo:
                escritor = csv.writer(archivo, delimiter=';')
                
                # --- SECCIÓN DE INFORME DE SESIÓN ---
                escritor.writerow(['Informe de sesión', ''])
                escritor.writerow([])

                # Lección, Unidad y Ejercicio — réplica exacta del query de header.php
                # edunit → Lección, lesson → Unidad, exercise → Ejercicio (igual que el PHP)
                leccion, unidad, ejercicio = "N/A", "N/A", "N/A"
                try:
                    cursor.execute("""
                        SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
                        FROM sessions,
                             exercises,
                             lessons, idxexerciseslessons,
                             edunits, idxlessonsedunits
                        WHERE sessions.id = %s
                          AND sessions.idexercise = exercises.id
                          AND idxexerciseslessons.idexercise = exercises.id
                          AND idxexerciseslessons.idlesson = lessons.id
                          AND idxlessonsedunits.idlesson = lessons.id
                          AND idxlessonsedunits.idedunit = edunits.id
                    """, (id_sesion,))
                    info_ejercicio = cursor.fetchone()
                    if info_ejercicio:
                        leccion, unidad, ejercicio = info_ejercicio[0], info_ejercicio[1], info_ejercicio[2]
                    else:
                        # Fallback parsing of sessions.sname
                        cursor.execute("SELECT sname FROM sessions WHERE id = %s", (id_sesion,))
                        sname_row = cursor.fetchone()
                        if sname_row and sname_row[0]:
                            parts = [p.strip() for p in sname_row[0].split('\n') if p.strip()]
                            if len(parts) >= 3:
                                leccion, unidad, ejercicio = parts[0], parts[1], parts[2]
                            elif len(parts) == 2:
                                leccion, unidad = parts[0], parts[1]
                            elif len(parts) == 1:
                                leccion = parts[0]
                except Exception:
                    conn.rollback()

                escritor.writerow(['Lección', 'Unidad', 'Ejercicio'])
                escritor.writerow([leccion, unidad, ejercicio])
                escritor.writerow([])
                escritor.writerow(['FECHA', 'CONDUCTOR', 'INSTRUCTOR', 'DURACIÓN']); escritor.writerow([fecha.strftime("%Y-%m-%d"), instructor, nombre_alumno or "-", format_duration(duracion)]); escritor.writerow([])

                # --- Condiciones iniciales ---
                escritor.writerow([])
                escritor.writerow(['Condiciones iniciales', ''])
                escritor.writerow([])
                try:
                    cursor.execute("""
                        SELECT
                            substring(sessionsextradata.sdescription from '[^:]+'),
                            sessionsextradata.svalue
                        FROM idxsessionsextradatasessions, sessionsextradata
                        WHERE idxsessionsextradatasessions.idsessionsextradata = sessionsextradata.id
                          AND idxsessionsextradatasessions.idsession = %s
                          AND idxsessionsextradatasessions.IdAulaSession = %s
                    """, (id_sesion, id_aula))
                    condiciones = cursor.fetchall()
                    if condiciones:
                        for descripcion, valor in condiciones:
                            escritor.writerow([descripcion + ':', valor])
                except Exception:
                    conn.rollback()
                escritor.writerow([])

                # Comentarios, Palabras clave, Notas del instructor
                comentarios = ""
                try:
                    cursor.execute("""
                        SELECT exercises.scomments
                        FROM sessions, exercises
                        WHERE sessions.idexercise = exercises.id
                          AND sessions.id = %s
                    """, (id_sesion,))
                    row_comments = cursor.fetchone()
                    if row_comments and row_comments[0]:
                        comentarios = row_comments[0]
                except Exception:
                    conn.rollback()

                escritor.writerow(['Comentarios', ''])
                escritor.writerow([comentarios])
                escritor.writerow([])

                # --- Palabras clave del ejercicio ---
                palabras_clave = ""
                try:
                    cursor.execute("""
                        SELECT exercises.stags
                        FROM sessions, exercises
                        WHERE sessions.idexercise = exercises.id
                          AND sessions.id = %s
                    """, (id_sesion,))
                    row_tags = cursor.fetchone()
                    if row_tags and row_tags[0]:
                        palabras_clave = row_tags[0]
                except Exception:
                    conn.rollback()

                escritor.writerow(['Palabras clave del ejercicio', ''])
                escritor.writerow([palabras_clave])
                escritor.writerow([])

                # --- Notas del instructor ---
                notas_instructor = ""
                try:
                    cursor.execute("""
                        SELECT sessions.sinstructornotes
                        FROM sessions
                        WHERE sessions.id = %s
                    """, (id_sesion,))
                    row_notes = cursor.fetchone()
                    if row_notes and row_notes[0]:
                        notas_instructor = row_notes[0]
                except Exception:
                    conn.rollback()

                escritor.writerow(['Notas del instructor', ''])
                escritor.writerow([notas_instructor])
                escritor.writerow([])

                # --- Marcas ---
                escritor.writerow([])
                escritor.writerow(['Marcas', ''])
                escritor.writerow([])
                try:
                    cursor.execute("""
                        SELECT marks.ncicle*sessions.dcicleperiod/1000.0 AS tiempo,
                                marks.stipo,
                                marks.scomment
                        FROM sessions, marks, idxmarkssessions
                        WHERE sessions.id = %s
                          AND sessions.IdAula = %s
                          AND idxmarkssessions.idsession = sessions.id
                          AND idxmarkssessions.idmark = marks.id
                        ORDER BY marks.ncicle ASC
                    """, (id_sesion, id_aula))
                    for tiempo, tipo, comentario in cursor.fetchall():
                        escritor.writerow([format_duration(tiempo), tipo, comentario])
                except Exception:
                    conn.rollback()
                escritor.writerow([])

                # --- Resumen de marcas ---
                escritor.writerow([])
                escritor.writerow(['Resumen de marcas', ''])
                escritor.writerow([])
                try:
                    cursor.execute("""
                        SELECT marks.stipo, marks.scomment, COUNT(marks.id)
                        FROM marks, idxmarkssessions, sessions
                        WHERE idxmarkssessions.idsession = sessions.id
                          AND idxmarkssessions.idmark = marks.id
                          AND sessions.id = %s
                          AND sessions.IdAula = %s
                          AND sessions.ncicles*sessions.dcicleperiod > 0
                        GROUP BY marks.stipo, marks.scomment
                        ORDER BY marks.stipo, COUNT(marks.id) DESC
                    """, (id_sesion, id_aula))
                    resumen_rows = cursor.fetchall()
                    
                    from collections import defaultdict
                    resumen_por_tipo = defaultdict(list)
                    for tipo, comentario, cantidad in resumen_rows:
                        resumen_por_tipo[tipo].append((comentario, cantidad))
                    
                    tipos_ordenados = [
                        ('ERROR', 'Errores'),
                        ('BREAKDOWN', 'Averias'),
                        ('START EVENT', 'Incidencias'),
                        ('MARK', 'Marcas'),
                        ('WEATHER', 'Eventos de clima'),
                        ('ILLUMINATION', 'Eventos de iluminacion'),
                        ('TRAFFIC', 'Eventos de trafico'),
                        ('START COMM', 'Comunicaciones'),
                        ('ENDING', 'Desenlaces'),
                        ('INFO', 'Mensajes de informacion'),
                        ('STUDENT MARK', 'Marcas de alumno'),
                        ('MESSAGE', 'Mensajes'),
                        ('TRAIN_LOAD', 'Evento de carga de tren'),
                        ('TRAFFIC_CONDS', 'Evento de condiciones de trafico'),
                        ('PULSADOR', 'Pulsador')
                    ]
                    
                    tiene_marcas = False
                    for tipo_db, tipo_es in tipos_ordenados:
                        if tipo_db in resumen_por_tipo:
                            tiene_marcas = True
                            escritor.writerow([tipo_es, ''])
                            for comentario, cantidad in resumen_por_tipo[tipo_db]:
                                escritor.writerow([comentario, cantidad])
                            escritor.writerow([])
                    
                    if not tiene_marcas:
                        escritor.writerow(['La sesion no contiene marcas'])
                        escritor.writerow([])
                except Exception:
                    conn.rollback()
                escritor.writerow([])

                # --- Indicadores genéricos ---
                escritor.writerow([])
                escritor.writerow(['Indicadores genéricos', ''])
                escritor.writerow([])
                try:
                    cursor.execute("""
                        SELECT
                            genericindics.sdescription,
                            substring(genericindics.svalue from '[0-9.:]+') AS value,
                            substring(genericindics.svalue from '[^0-9.:].*') AS unit
                        FROM idxgenindicssessions, genericindics
                        WHERE idxgenindicssessions.idgenindics = genericindics.id
                          AND idxgenindicssessions.idsession = %s
                    """, (id_sesion,))
                    for descripcion, valor, unidad in cursor.fetchall():
                        escritor.writerow([descripcion, valor or '', unidad or ''])
                except Exception:
                    conn.rollback()

        log_callback("\n¡Proceso completado! Los archivos han sido guardados.")

    except FileNotFoundError as e:
        log_callback(f"\n❌ Error de configuración: {e}")
    except psycopg2.OperationalError as e:
        log_callback(f"\n❌ Error de conexión: {e}\nVerifica la conexión y que el firewall no esté bloqueando el puerto.")
    except configparser.NoSectionError:
        log_callback("\n❌ Error: No se encontró la sección [database] en config.ini.")
    except Exception as e:
        log_callback(f"\n❌ Ocurrió un error inesperado: {e}")
    finally:
        if conn:
            conn.close()
            log_callback("\nConexión a la base de datos cerrada.")

class DataApp(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.root = self
        
        # Cargar configuración de usuario
        user_settings = load_user_settings()

        # Layout principal
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)
        
        main_frame = ctk.CTkFrame(self, fg_color="transparent")
        main_frame.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        main_frame.grid_columnconfigure(0, weight=0)
        main_frame.grid_columnconfigure(1, weight=1)
        main_frame.grid_rowconfigure(0, weight=1)
        
        # --- Panel Izquierdo ---
        left_panel = ctk.CTkFrame(main_frame, corner_radius=10)
        left_panel.grid(row=0, column=0, sticky='nsew', padx=(0, 20))
        left_panel.grid_columnconfigure(0, weight=1)
        
        # Fechas
        ctk.CTkLabel(left_panel, text="Fechas", font=ctk.CTkFont(weight="bold")).grid(row=0, column=0, pady=(15, 10), padx=20, sticky="w")
        
        ctk.CTkLabel(left_panel, text="Fecha de Inicio:").grid(row=1, column=0, sticky="w", padx=20)
        
        inicio_frame = ctk.CTkFrame(left_panel, fg_color="transparent")
        inicio_frame.grid(row=2, column=0, sticky="ew", padx=20, pady=(0, 10))
        self.fecha_inicio_entry = DateEntry(inicio_frame, width=12, background='#1f538d', foreground='white', borderwidth=0, date_pattern='y-mm-dd')
        self.fecha_inicio_entry.set_date(user_settings['last_start_date'])
        self.fecha_inicio_entry.pack(side=tk.LEFT, padx=(0, 10))
        ctk.CTkButton(inicio_frame, text="Hoy", width=60, command=self.set_today_start).pack(side=tk.LEFT)

        ctk.CTkLabel(left_panel, text="Fecha de Fin:").grid(row=3, column=0, sticky="w", padx=20)
        
        fin_frame = ctk.CTkFrame(left_panel, fg_color="transparent")
        fin_frame.grid(row=4, column=0, sticky="ew", padx=20, pady=(0, 15))
        self.fecha_fin_entry = DateEntry(fin_frame, width=12, background='#1f538d', foreground='white', borderwidth=0, date_pattern='y-mm-dd')
        self.fecha_fin_entry.set_date(user_settings['last_end_date'])
        self.fecha_fin_entry.pack(side=tk.LEFT, padx=(0, 10))
        ctk.CTkButton(fin_frame, text="Hoy", width=60, command=self.set_today_end).pack(side=tk.LEFT)
        
        # Opciones
        ctk.CTkLabel(left_panel, text="Opciones", font=ctk.CTkFont(weight="bold")).grid(row=5, column=0, pady=(10, 10), padx=20, sticky="w")
        
        self.include_anonymous_var = tk.BooleanVar(value=(user_settings['include_anonymous'] == 'true'))
        ctk.CTkCheckBox(left_panel, text="Incluir anónimos", variable=self.include_anonymous_var).grid(row=6, column=0, sticky="w", padx=20, pady=5)
        
        self.clean_folder_var = tk.BooleanVar(value=(user_settings['clean_folder'] == 'true'))
        ctk.CTkCheckBox(left_panel, text="Limpiar carpeta antes de extraer", variable=self.clean_folder_var).grid(row=7, column=0, sticky="w", padx=20, pady=5)
        
        # Acciones
        ctk.CTkLabel(left_panel, text="Acciones", font=ctk.CTkFont(weight="bold")).grid(row=8, column=0, pady=(15, 10), padx=20, sticky="w")
        
        self.check_button = ctk.CTkButton(left_panel, text="Verificar Conexión", command=self.check_connection_thread)
        self.check_button.grid(row=9, column=0, sticky="ew", padx=20, pady=5)
        
        self.start_button = ctk.CTkButton(left_panel, text="Iniciar Extracción", command=self.start_extraction_thread)
        self.start_button.grid(row=10, column=0, sticky="ew", padx=20, pady=5)
        
        self.open_folder_button = ctk.CTkButton(left_panel, text="Abrir Carpeta", command=self.open_download_folder, state="enable")
        self.open_folder_button.grid(row=11, column=0, sticky="ew", padx=20, pady=(5, 20))
        
        # --- Panel Derecho ---
        right_panel = ctk.CTkFrame(main_frame, fg_color="transparent")
        right_panel.grid(row=0, column=1, sticky='nsew')
        right_panel.grid_columnconfigure(0, weight=1)
        right_panel.grid_rowconfigure(2, weight=1)
        
        ctk.CTkLabel(right_panel, text="Progreso y Registro", font=ctk.CTkFont(weight="bold")).grid(row=0, column=0, sticky="w", pady=(0, 10))
        
        self.progress_bar = ctk.CTkProgressBar(right_panel)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        
        self.log_text = ctk.CTkTextbox(right_panel, font=("Consolas", 13), state="disabled", corner_radius=8)
        self.log_text.grid(row=2, column=0, sticky="nsew")

    def set_today_start(self):
        """Establece la fecha de inicio a hoy."""
        self.fecha_inicio_entry.set_date(date.today())

    def set_today_end(self):
        """Establece la fecha de fin a hoy."""
        self.fecha_fin_entry.set_date(date.today())

    def log(self, message):
        """Añade un mensaje al área de log de forma segura desde cualquier hilo."""
        self.root.after(0, self._log_message, message)

    def _log_message(self, message):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def log_error(self, message):
        """Añade un mensaje de error (rojo) al log de forma segura desde cualquier hilo."""
        self.root.after(0, self._log_error_message, message)

    def _log_error_message(self, message):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", "[ERROR] " + message + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def show_damaged_alert(self, sesiones_danadas):
        """Muestra una ventana de alerta con las sesiones omitidas."""
        lines = [f"  • ID {s[0]} | {s[1]} | {s[2].strftime('%Y-%m-%d') if hasattr(s[2], 'strftime') else s[2]}" for s in sesiones_danadas]
        detail = "\n".join(lines)
        messagebox.showwarning(
            "Sesiones con datos incompletos",
            f"{len(sesiones_danadas)} conduccion(es) fueron omitidas por tener datos de ejercicio/leccion/unidad corruptos o inexistentes en la base de datos:\n\n{detail}\n\nRevisa el LOG para más detalles."
        )

    def update_progress(self, value):
        """Actualiza la barra de progreso de forma segura desde cualquier hilo."""
        self.root.after(0, self._update_progress_bar, value)

    def _update_progress_bar(self, value):
        if value > 0:
            self.progress_bar.set(value / 100.0)
        else:
            self.progress_bar.set(0)

    def open_download_folder(self):
        """Abre la carpeta de descargas en el explorador de archivos del sistema."""
        path = os.path.abspath(carpeta_salida)
        try:
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as e:
            self.log(f"❌ Error al abrir la carpeta: {e}")

    def clean_download_folder(self):
        """Elimina todos los archivos de la carpeta de descargas."""
        path = os.path.abspath(carpeta_salida)
        if not os.path.isdir(path):
            self.log(f"La carpeta '{path}' no existe, no se necesita limpieza.")
            os.makedirs(path, exist_ok=True)
            return True

        self.log(f"Limpiando la carpeta de descargas: {path}...\n")
        file_count = 0
        for filename in os.listdir(path):
            file_path = os.path.join(path, filename)
            try:
                if os.path.isfile(file_path) or os.path.islink(file_path):
                    os.unlink(file_path)
                    file_count += 1
            except Exception as e:
                self.log(f"❌ No se pudo eliminar {file_path}. Razón: {e}")
        self.log(f"Limpieza completada. Se eliminaron {file_count} archivos.\n")

    def start_extraction_thread(self):
        """Inicia el proceso de extracción en un hilo separado."""
        self.start_button.configure(state="disabled")
        self.check_button.configure(state="disabled")
        self.open_folder_button.configure(state="disabled")
        self.log_text.configure(state="normal")
        # Limpiar log y barra de progreso
        self.progress_bar.set(0)
        self.log_text.delete('1.0', "end")
        self.log_text.configure(state="disabled")

        fecha_inicio = self.fecha_inicio_entry.get_date()
        fecha_fin = self.fecha_fin_entry.get_date()
        include_anonymous = self.include_anonymous_var.get()
        clean_folder = self.clean_folder_var.get()

        # Guardar configuración actual
        save_user_settings(fecha_inicio, fecha_fin, include_anonymous, clean_folder)

        # Limpiar carpeta si la opción está marcada
        if clean_folder:
            if messagebox.askyesno("Confirmar Limpieza", 
                                   f"¿Estás seguro de que deseas eliminar todos los archivos de la carpeta '{carpeta_salida}'? Esta acción no se puede deshacer."):
                self.clean_download_folder()
            else:
                self.log("Limpieza cancelada por el usuario.")
                self.start_button.configure(state="normal")
                self.check_button.configure(state="normal")
                return

        if fecha_inicio > fecha_fin:
            self.log("La fecha de inicio no puede ser posterior a la fecha de fin.")
            self.start_button.configure(state="normal")
            self.check_button.configure(state="normal")
            return

        thread = threading.Thread(target=self.run_extraction_task, args=(fecha_inicio, fecha_fin, include_anonymous), daemon=True)
        thread.daemon = True
        thread.start()

    def run_extraction_task(self, fecha_inicio, fecha_fin, include_anonymous):
        """Tarea que se ejecuta en el hilo para no bloquear la GUI."""
        run_extraction(
            fecha_inicio, fecha_fin,
            self.log, self.update_progress, include_anonymous,
            log_error_callback=self.log_error,
            alert_callback=lambda d: self.root.after(0, self.show_damaged_alert, d)
        )
        self.root.after(0, self.on_extraction_complete)

    def check_connection_thread(self):
        """Inicia la verificación de conexión en un hilo separado."""
        self.check_button.configure(state="disabled")
        self.start_button.configure(state="disabled")
        self.log_text.configure(state="normal")
        # Limpiar log y barra de progreso
        self.progress_bar.set(0)
        self.log_text.delete('1.0', "end")
        self.log_text.configure(state="disabled")

        fecha_inicio = self.fecha_inicio_entry.get_date()
        fecha_fin = self.fecha_fin_entry.get_date()
        include_anonymous = self.include_anonymous_var.get()

        if fecha_inicio > fecha_fin:
            self.log("La fecha de inicio no puede ser posterior a la fecha de fin.")
            self.check_button.configure(state="normal")
            self.start_button.configure(state="normal")
            return

        thread = threading.Thread(target=self.run_check_connection_task, args=(fecha_inicio, fecha_fin, include_anonymous), daemon=True)
        thread.daemon = True
        thread.start()

    def run_check_connection_task(self, fecha_inicio, fecha_fin, include_anonymous):
        """Tarea que se ejecuta en el hilo para verificar conexión."""
        check_connection_and_count(fecha_inicio, fecha_fin, self.log, self.update_progress, include_anonymous)
        self.root.after(0, self.on_check_complete)

    def on_check_complete(self):
        """Se ejecuta cuando la verificación termina para reactivar los botones."""
        self.check_button.configure(state="normal")
        self.start_button.configure(state="normal")

    def on_extraction_complete(self):
        """Se ejecuta cuando la extracción termina para reactivar el botón."""
        self.start_button.configure(state="normal")
        self.check_button.configure(state="normal")
        if not self.open_folder_button.winfo_ismapped():
            self.open_folder_button.grid()
        self.open_folder_button.configure(state="normal") # Activar al finalizar